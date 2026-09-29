import { createHash, randomUUID } from 'node:crypto';
import {
  RESULT_SCHEMA_VERSION, TASK_SCHEMA_VERSION, TokenSigner, WsCommandServer, isIdeInvestigationRecord,
  isInvestigationEvidence, isInvestigationVerdict,
  type ArtifactSignature, type CapabilityAction, type CaseState, type GssResultContract, type GssTaskContract,
  type ModelUsageRecord, type NextStepProposal, type ObservationPack, type RuntimeStatusPayload, type TaskStatus,
} from '@asq/sdk';
import {
  FilesystemArtifactStore, PostgresRuntimeStore, type CommitObservationResult, type RuntimeStore,
} from '@asq/persistence';
import { LlmRouter, type RouterDecision } from './agent/llm-router.js';
import { controlPlaneClientFromEnvironment, type ControlPlaneTaskClient } from './control-plane-client.js';

interface Router { routePrompt(prompt: string): Promise<RouterDecision | { agent: string; instruction: string; action?: CapabilityAction; parameters?: Record<string, unknown> }> }

interface PendingTask {
  caseId: string;
  agentId: string;
  task: GssTaskContract;
  runId?: string;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const capabilityRegistry: Record<CapabilityAction, { target: 'cli' | 'ide' | 'siem'; instruction?: string }> = {
  inspect_hostname: { target: 'cli', instruction: 'hostname' },
  inspect_system: { target: 'cli', instruction: 'systeminfo' },
  inspect_network_config: { target: 'cli', instruction: 'ipconfig /all' },
  inspect_network_connections: { target: 'cli', instruction: 'netstat -ano' },
  analyze_code: { target: 'ide' },
  search_code: { target: 'ide' },
  search_siem: { target: 'siem' },
};

function legacyAction(decision: { agent: string; instruction: string }): CapabilityAction | null {
  if (decision.agent === 'ide') return 'analyze_code';
  const entry = Object.entries(capabilityRegistry).find(([, value]) => value.instruction === decision.instruction);
  return entry?.[0] as CapabilityAction | undefined ?? null;
}

function packOutput(
  caseId: string,
  taskId: string,
  factNamespace: CapabilityAction,
  output: string,
  evidenceRefs: string[],
  rawArtifactRef?: string,
): ObservationPack {
  const nonEmpty = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const summary = (nonEmpty.slice(0, 8).join('\n') || 'Worker returned no textual observation').slice(0, 1600);
  return {
    observationId: `OBS-${randomUUID()}`,
    caseId,
    taskId,
    summary,
    facts: nonEmpty.slice(0, 12).map((value, index) => ({ key: `${factNamespace}.line_${index + 1}`, value: value.slice(0, 500) })),
    evidenceRefs,
    rawArtifactRef,
    originalBytes: Buffer.byteLength(output, 'utf8'),
    packedBytes: Buffer.byteLength(summary, 'utf8'),
    createdAt: new Date().toISOString(),
  };
}

function nextStepProposal(task: GssTaskContract, payload: Record<string, any>): NextStepProposal {
  const cliSequence: Partial<Record<CapabilityAction, CapabilityAction>> = {
    inspect_hostname: 'inspect_system',
    inspect_system: 'inspect_network_config',
    inspect_network_config: 'inspect_network_connections',
  };
  const cliNext = cliSequence[task.action];
  if (cliNext) {
    return {
      kind: 'DISPATCH',
      reasonCode: 'READ_ONLY_RECON_SEQUENCE',
      rationale: 'Continue the bounded read-only host investigation with the next allowlisted observation.',
      action: { target: 'cli', action: cliNext, parameters: {}, riskLevel: 'read_only' },
    };
  }
  if (task.action === 'search_code') {
    return {
      kind: 'DISPATCH',
      reasonCode: 'CODE_ANALYSIS_FOLLOW_UP',
      rationale: 'Analyze the allowlisted repository scope after the read-only search observation.',
      action: { target: 'ide', action: 'analyze_code', parameters: task.parameters, riskLevel: 'read_only' },
    };
  }
  if (task.action === 'search_siem') {
    const verdict = String(payload.verdict?.verdict ?? 'INSUFFICIENT_EVIDENCE');
    if (verdict === 'INSUFFICIENT_EVIDENCE') {
      return { kind: 'BLOCKED', reasonCode: 'INSUFFICIENT_SIEM_EVIDENCE', rationale: 'SIEM evidence was insufficient for a deterministic verdict.' };
    }
    return { kind: 'FINALIZE', reasonCode: 'DETERMINISTIC_SIEM_VERDICT', rationale: `The verified SIEM adapter produced verdict ${verdict}.` };
  }
  return {
    kind: 'FINALIZE',
    reasonCode: 'BOUNDED_READ_ONLY_SEQUENCE_COMPLETE',
    rationale: 'The bounded read-only investigation sequence completed with verified evidence.',
  };
}

export class CentralCommandOrchestrator {
  private server: WsCommandServer;
  private halted = false;
  private planning = 0;
  private pending = new Map<string, PendingTask>();
  private readonly outboxClaimOwner = `command-center-${randomUUID()}`;
  private readonly controlPlane: ControlPlaneTaskClient | null = controlPlaneClientFromEnvironment();
  private outboxTimer?: ReturnType<typeof setInterval>;
  private drainingOutbox = false;

  constructor(
    port = 4000,
    private router: Router = new LlmRouter(),
    private signer = new TokenSigner(),
    private store: RuntimeStore | null = PostgresRuntimeStore.fromEnvironment(),
    private artifacts = new FilesystemArtifactStore(),
  ) {
    this.server = new WsCommandServer(port, { signer, allowedOrigin: process.env.ASQ_WEB_ORIGIN });
    this.server.on('message', msg => { void this.handle(msg).catch(error => {
      console.error('[CommandCenter] Request failed safely:', error instanceof Error ? error.message : 'unknown error');
      this.status('ERROR', 'Request failed safely. No unverified success was emitted.', msg?.incident_id);
    }); });
  }

  public async ready(): Promise<number> {
    if (this.store) await this.store.ready();
    const port = await this.server.ready();
    if (this.controlPlane || this.store?.claimPendingDispatches) {
      this.outboxTimer = setInterval(() => { void this.drainOutbox(); }, 1_000);
      this.outboxTimer.unref?.();
    }
    return port;
  }

  public async close(): Promise<void> {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    for (const task of this.pending.values()) clearTimeout(task.timer);
    this.pending.clear();
    await this.server.close();
    await this.store?.close();
  }

  private async handle(msg: any): Promise<void> {
    if (msg.type === 'RESULT' || msg.type === 'EVIDENCE') return this.handleWorkerResult(msg);
    if (msg.type !== 'COMMAND' || msg.identity?.role !== 'CISO_Admin' || !msg.identity.permissions.includes('CONTROL')) return;

    if (msg.payload.action === 'trigger_killswitch') {
      this.halted = true;
      this.server.broadcast({ source: 'STANDALONE', target: 'BROADCAST', type: 'COMMAND', payload: { action: 'system_halt' } });
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        if (this.controlPlane) await this.controlPlane.updateTask(pending.task.taskId, 'CANCELLED', pending.agentId);
        else await this.store?.updateTask(pending.task.taskId, 'CANCELLED', pending.agentId);
      }
      this.pending.clear();
      this.status('HALTED', 'Workers were asked to stop and new tasks are blocked.');
      return;
    }
    if (this.halted) { this.status('HALTED', 'The system is halted.'); return; }

    const prompt = msg.payload.action === 'commander_prompt' ? msg.payload.content : null;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16_000) return;
    if (this.pending.size >= 100 || this.planning >= 4) { this.status('BUSY', 'The control plane is at its bounded concurrency limit.'); return; }

    const caseId = String(msg.incident_id);
    const actorId = String(msg.agentId);
    let runId: string | undefined;
    if (this.store) {
      if (this.controlPlane) {
        await this.controlPlane.ensureCase(caseId, actorId);
        runId = (await this.controlPlane.ensureInvestigationRun(caseId, actorId)).runId;
        await this.controlPlane.appendMessage(caseId, 'USER', prompt, { requestMessageId: msg.message_id });
        await this.controlPlane.transitionCase(caseId, 'TRIAGING');
      } else {
        await this.store.ensureCase(caseId, actorId);
        runId = (await this.store.ensureInvestigationRun?.(caseId, actorId))?.runId;
        await this.store.appendMessage(caseId, 'USER', prompt, { requestMessageId: msg.message_id });
        await this.store.transitionCase(caseId, 'TRIAGING');
      }
    }
    this.status('RECEIVED', 'Request accepted for triage.', caseId, { caseId, caseState: 'TRIAGING' });

    this.planning++;
    let decision: Awaited<ReturnType<Router['routePrompt']>>;
    try { decision = await this.router.routePrompt(prompt); }
    finally { this.planning--; }
    if (this.halted) return;

    const modelUsage = 'modelUsage' in decision ? decision.modelUsage : undefined;
    if (modelUsage) {
      const record: ModelUsageRecord = { schemaVersion: 'gss.model-usage.v1', usageId: randomUUID(), caseId,
        traceId: msg.message_id, ...modelUsage, createdAt: new Date().toISOString() };
      if (this.controlPlane) await this.controlPlane.recordModelUsage(record);
      else await this.store?.recordModelUsage?.(record);
    }

    if (!['cli', 'ide', 'siem'].includes(decision.agent)) {
      const state = decision.agent === 'chat' ? 'CHAT' : 'ERROR';
      if (this.controlPlane) {
        await this.controlPlane.appendMessage(caseId, decision.agent === 'chat' ? 'ASSISTANT' : 'SYSTEM', decision.instruction);
        await this.controlPlane.transitionCase(caseId, decision.agent === 'chat' ? 'RESPONDING' : 'TRIAGING');
      } else {
        await this.store?.appendMessage(caseId, decision.agent === 'chat' ? 'ASSISTANT' : 'SYSTEM', decision.instruction);
        await this.store?.transitionCase(caseId, decision.agent === 'chat' ? 'RESPONDING' : 'TRIAGING');
      }
      this.status(state, decision.instruction, caseId, { caseId, caseState: decision.agent === 'chat' ? 'RESPONDING' : 'TRIAGING' });
      return;
    }

    const action = decision.action ?? legacyAction(decision);
    if (!action || !capabilityRegistry[action] || capabilityRegistry[action].target !== decision.agent) {
      this.status('DENIED', 'The requested capability is not registered.', caseId, { caseId, caseState: 'TRIAGING' });
      return;
    }
    const capability = capabilityRegistry[action];
    const taskId = randomUUID();
    const task: GssTaskContract = {
      schemaVersion: TASK_SCHEMA_VERSION,
      taskId,
      caseId,
      idempotencyKey: msg.message_id,
      source: 'standalone',
      target: capability.target,
      action,
      parameters: decision.parameters ?? {},
      riskLevel: 'read_only',
      contextRefs: [],
      timeoutMs: 15_000,
      createdAt: new Date().toISOString(),
    };
    const created = this.controlPlane
      ? await this.controlPlane.createTask(task, actorId, { runId })
      : await this.store?.createTask(task, actorId, { runId }) ?? { created: true };
    if (!created.created) {
      this.status('DUPLICATE', 'This request has already created a task.', caseId, { caseId, taskId, task });
      return;
    }
    if (this.controlPlane) await this.controlPlane.transitionCase(caseId, 'COLLECTING_EVIDENCE');
    else await this.store?.transitionCase(caseId, 'COLLECTING_EVIDENCE');

    const agentId = decision.agent === 'cli' ? 'cli-worker-agent' : decision.agent === 'ide' ? 'ide-worker-agent' : 'siem-worker-agent';
    await this.dispatchPreparedTask(task, agentId, capability.instruction ?? decision.instruction, runId);
  }

  private async handleWorkerResult(msg: any): Promise<void> {
    const taskId = msg.payload?.taskId;
    const pending = this.pending.get(taskId);
    if (!pending || pending.agentId !== msg.agentId || pending.caseId !== msg.incident_id) return;
    clearTimeout(pending.timer);
    this.pending.delete(taskId);

    const reportedWorkerStatus = String(msg.payload.status ?? 'FAILED');
    const ideInvestigation = pending.task.target === 'ide' && isIdeInvestigationRecord(msg.payload?.investigation) &&
      msg.payload.investigation.taskId === taskId && msg.payload.investigation.caseId === pending.caseId &&
      msg.payload.investigation.action === pending.task.action ? msg.payload.investigation : undefined;
    const siemEvidence = pending.task.target === 'siem' && isInvestigationEvidence(msg.payload?.evidence,
      { taskId, incidentId: pending.caseId }) ? msg.payload.evidence : undefined;
    const siemVerdict = siemEvidence && isInvestigationVerdict(msg.payload?.verdict,
      { taskId, incidentId: pending.caseId, evidenceId: siemEvidence.evidenceId }) ? msg.payload.verdict : undefined;
    const invalidIdeResult = pending.task.target === 'ide' && reportedWorkerStatus === 'SUCCESS' && !ideInvestigation;
    const invalidSiemResult = pending.task.target === 'siem' && reportedWorkerStatus === 'SUCCESS' && (!siemEvidence || !siemVerdict);
    const workerStatus = invalidIdeResult || invalidSiemResult ? 'INVALID_RESULT' : reportedWorkerStatus;
    let status: GssResultContract['status'] = workerStatus === 'SUCCESS' ? 'COMPLETED' :
      workerStatus === 'BLOCKED' || workerStatus === 'DENIED' ? 'BLOCKED' : workerStatus === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    const output = String(msg.payload.output ?? msg.payload.content ?? '');
    const artifact = output ? await this.artifacts.storeEvidence(pending.caseId, taskId, output) : undefined;
    const completedAt = new Date().toISOString();
    const signatureRequired = process.env.GSS_REQUIRE_ARTIFACT_SIGNATURE === 'true';
    let artifactSignature: ArtifactSignature | undefined;
    let artifactSignatureState: 'SIGNED' | 'UNSIGNED_LOCAL' | 'SIGNING_FAILED' = 'UNSIGNED_LOCAL';
    if (artifact && this.controlPlane) {
      try {
        artifactSignature = await this.controlPlane.signArtifact({
          artifactHash: artifact.sha256, caseId: pending.caseId, taskId, createdAt: completedAt,
        });
        artifactSignatureState = 'SIGNED';
      } catch (error) {
        artifactSignatureState = 'SIGNING_FAILED';
        if (signatureRequired) status = 'FAILED';
        console.error('[CommandCenter] Artifact signing failed safely:', error instanceof Error ? error.message : 'unknown error');
      }
    } else if (artifact && signatureRequired) {
      artifactSignatureState = 'SIGNING_FAILED';
      status = 'FAILED';
    }
    const adapterEvidenceId = siemEvidence?.evidenceId;
    const evidenceRefs = status === 'COMPLETED' ? [adapterEvidenceId, artifact ? `EVD-${artifact.sha256.slice(0, 16)}` : undefined]
      .filter((value): value is string => Boolean(value)) : [];
    const observation = packOutput(pending.caseId, taskId, pending.task.action, output, evidenceRefs, artifact?.ref);
    const result: GssResultContract = {
      schemaVersion: RESULT_SCHEMA_VERSION,
      taskId,
      caseId: pending.caseId,
      executor: pending.task.target,
      status,
      result: { summary: observation.summary, action: pending.task.action, rawArtifactRef: artifact?.ref,
        sha256: artifact?.sha256, artifactSignatureState, ...(artifactSignature ? { artifactSignature } : {}),
        ...(siemEvidence ? { evidence: siemEvidence } : {}),
        ...(ideInvestigation ? { investigation: ideInvestigation } : {}),
        ...(siemVerdict ? { verdict: siemVerdict } : {}),
        ...(msg.payload?.failure ? { failure: msg.payload.failure } : {}) },
      evidenceRefs,
      errors: status === 'COMPLETED' ? [] : [{
        code: signatureRequired && artifactSignatureState === 'SIGNING_FAILED' ? 'ARTIFACT_SIGNATURE_REQUIRED' : workerStatus,
        message: signatureRequired && artifactSignatureState === 'SIGNING_FAILED'
          ? 'Control Plane could not sign the artifact; evidence was rejected.' : observation.summary,
      }],
      metrics: { durationMs: Date.now() - pending.startedAt, outputBytes: artifact?.bytes ?? 0 },
      completedAt,
    };
    const proposal = status === 'COMPLETED' ? nextStepProposal(pending.task, result.result) : undefined;
    const loop = status === 'COMPLETED' && pending.runId && proposal ? {
        runId: pending.runId,
        source: pending.task.target,
        ...(artifact?.sha256 ? { artifactHash: artifact.sha256 } : {}),
        proposal,
      } : undefined;
    const remoteResult = this.controlPlane ? await this.controlPlane.recordResult(result, observation, loop) : undefined;
    const loopResult = this.controlPlane ? remoteResult?.loop : await this.store?.recordResult(result, observation, loop);
    if (this.controlPlane) await this.controlPlane.appendMessage(pending.caseId, 'WORKER', observation.summary, { taskId, evidenceRefs });
    else await this.store?.appendMessage(pending.caseId, 'WORKER', observation.summary, { taskId, evidenceRefs });
    const durableLoop = loopResult && typeof loopResult === 'object' && 'decision' in loopResult
      ? loopResult as CommitObservationResult : undefined;
    const nextCaseState: CaseState = status !== 'COMPLETED' || durableLoop?.decision.kind === 'BLOCKED'
      ? 'INVESTIGATING' : durableLoop?.decision.kind === 'DISPATCH' ? 'COLLECTING_EVIDENCE' : 'ANALYZING';
    if (this.controlPlane) await this.controlPlane.transitionCase(pending.caseId, nextCaseState);
    else await this.store?.transitionCase(pending.caseId, nextCaseState);
    this.status(workerStatus, status === 'COMPLETED' ? observation.summary : `Worker did not produce verified evidence: ${observation.summary}`,
      pending.caseId, { caseId: pending.caseId, taskId, result, observation, caseState: nextCaseState });
    if (durableLoop?.decision.kind === 'DISPATCH') {
      if (this.controlPlane || this.store?.claimPendingDispatches) await this.drainOutbox();
      else await this.dispatchDecision(durableLoop, pending.task.taskId);
    }
  }

  private async drainOutbox(): Promise<void> {
    if ((!this.controlPlane && !this.store?.claimPendingDispatches) || this.drainingOutbox || this.halted) return;
    this.drainingOutbox = true;
    try {
      const claims = this.controlPlane
        ? await this.controlPlane.claimPendingDispatches(this.outboxClaimOwner, 25)
        : await this.store!.claimPendingDispatches!(this.outboxClaimOwner, 25);
      for (const claim of claims) await this.dispatchDecision(claim.loop, claim.parentTaskId, claim.claimOwner);
    } catch (error) {
      console.error('[CommandCenter] Outbox recovery failed safely:', error instanceof Error ? error.message : 'unknown error');
    } finally {
      this.drainingOutbox = false;
    }
  }

  private async dispatchDecision(loop: CommitObservationResult, parentTaskId?: string, claimOwner?: string): Promise<void> {
    const action = loop.decision.action;
    if (!action) return;
    const capability = capabilityRegistry[action.action];
    if (!capability || capability.target !== action.target || action.riskLevel !== 'read_only') {
      this.status('DENIED', 'The planned follow-up capability is not allowed.', loop.run.caseId,
        { caseId: loop.run.caseId, caseState: 'INVESTIGATING' });
      return;
    }
    const taskId = `TSK-${loop.decision.decisionId.slice(4)}`;
    const task: GssTaskContract = {
      schemaVersion: TASK_SCHEMA_VERSION,
      taskId,
      caseId: loop.run.caseId,
      idempotencyKey: `decision:${loop.decision.decisionId}`,
      source: 'standalone',
      target: action.target,
      action: action.action,
      parameters: action.parameters,
      riskLevel: 'read_only',
      contextRefs: loop.frontier.evidenceRefs,
      timeoutMs: 15_000,
      createdAt: loop.decision.createdAt,
    };
    const linkage = { runId: loop.run.runId, ...(parentTaskId ? { parentTaskId } : {}), actionFingerprint: action.fingerprint };
    if (this.controlPlane) await this.controlPlane.createTask(task, 'gss-planner', linkage);
    else await this.store?.createTask(task, 'gss-planner', linkage);
    const agentId = action.target === 'cli' ? 'cli-worker-agent' : action.target === 'ide' ? 'ide-worker-agent' : 'siem-worker-agent';
    const instruction = capability.instruction ?? String(action.parameters.question ?? action.parameters.query ?? action.action);
    const delivered = await this.dispatchPreparedTask(task, agentId, instruction, loop.run.runId);
    if (delivered) {
      if (this.controlPlane) await this.controlPlane.markOutboxPublished(loop.outbox.eventId, claimOwner);
      else await this.store?.markOutboxPublished?.(loop.outbox.eventId, claimOwner);
    } else if (claimOwner) {
      if (this.controlPlane) await this.controlPlane.releaseOutbox(loop.outbox.eventId, claimOwner,
        `${agentId} was offline`, new Date(Date.now() + 5_000).toISOString());
      else await this.store?.releaseOutbox?.(loop.outbox.eventId, claimOwner,
        `${agentId} was offline`, new Date(Date.now() + 5_000).toISOString());
    }
  }

  private async dispatchPreparedTask(task: GssTaskContract, agentId: string, instruction: string, runId?: string): Promise<boolean> {
    const workerPayload: Record<string, unknown> = { ...task, incidentId: task.caseId, instruction };
    if (task.target === 'cli') workerPayload.token = this.signer.sign({
      agentId,
      role: 'STANDALONE',
      permissions: ['EXECUTE_RECON'],
      timestamp: Date.now(),
      expiresAt: Date.now() + 60_000,
      taskId: task.taskId,
      incidentId: task.caseId,
      instructionHash: createHash('sha256').update(instruction).digest('hex'),
    });
    const timer = setTimeout(() => { void this.timeoutTask(task.taskId); }, task.timeoutMs);
    this.pending.set(task.taskId, { caseId: task.caseId, agentId, task, ...(runId ? { runId } : {}), startedAt: Date.now(), timer });
    const delivered = this.server.sendToAgent(agentId, {
      source: 'STANDALONE',
      target: task.target === 'cli' ? 'CLI_DAEMON' : task.target === 'ide' ? 'IDE_AGENT' : 'SIEM',
      type: 'TASK', incident_id: task.caseId, payload: workerPayload,
    });
    if (!delivered) {
      clearTimeout(timer);
      this.pending.delete(task.taskId);
      if (this.controlPlane) await this.controlPlane.updateTask(task.taskId, 'BLOCKED', agentId);
      else await this.store?.updateTask(task.taskId, 'BLOCKED', agentId);
      this.status('OFFLINE', `${agentId} is not connected. Nothing was executed.`, task.caseId,
        { caseId: task.caseId, taskId: task.taskId, task, caseState: 'COLLECTING_EVIDENCE' });
      return false;
    }
    if (this.controlPlane) await this.controlPlane.updateTask(task.taskId, 'DISPATCHED', agentId);
    else await this.store?.updateTask(task.taskId, 'DISPATCHED', agentId);
    this.status('DISPATCHED', `Task ${task.taskId} was routed to ${agentId}.`, task.caseId,
      { caseId: task.caseId, taskId: task.taskId, task, caseState: 'COLLECTING_EVIDENCE' });
    return true;
  }

  private async timeoutTask(taskId: string): Promise<void> {
    const pending = this.pending.get(taskId);
    if (!pending) return;
    this.pending.delete(taskId);
    if (this.controlPlane) await this.controlPlane.updateTask(taskId, 'FAILED', pending.agentId);
    else await this.store?.updateTask(taskId, 'FAILED', pending.agentId);
    this.status('TIMEOUT', 'Worker did not return evidence before the bounded timeout.', pending.caseId,
      { caseId: pending.caseId, taskId, caseState: 'INVESTIGATING' });
  }

  private status(state: string, message: string, caseId = 'GLOBAL_INCIDENT', extra: Partial<RuntimeStatusPayload> = {}): void {
    this.server.broadcast({ source: 'STANDALONE', target: 'BROADCAST', type: 'STATUS', incident_id: caseId,
      payload: { action: 'ui_flash', source: state, message, ...extra } satisfies RuntimeStatusPayload });
  }
}
