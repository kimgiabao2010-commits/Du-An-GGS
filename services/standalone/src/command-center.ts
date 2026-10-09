import { createHash, randomUUID } from 'node:crypto';
import {
  RESULT_SCHEMA_VERSION, TASK_SCHEMA_VERSION, TokenSigner, WsCommandServer, isIdeInvestigationRecord,
  isInvestigationEvidence, isInvestigationVerdict,
  withGssSpan, currentTraceId, currentTraceparent, validTraceparent, initializeTracing,
  type ArtifactSignature, type CapabilityAction, type CaseState, type GssResultContract, type GssTaskContract,
  type ModelUsageRecord, type NextStepProposal, type ObservationPack, type RuntimeStatusPayload, type TaskStatus,
  type WorkerDeliveryRecord, type ResultSubmission,
  type ModelCallGate,
} from '@asq/sdk';
import {
  artifactStoreFromEnvironment, type ArtifactStore, type CommitObservationResult,
  type CommandIntake,
} from '@asq/persistence';
import { LlmRouter, type RouterDecision } from './agent/llm-router.js';
import { controlPlaneClientFromEnvironment, type ControlPlaneTaskClient } from './control-plane-client.js';

interface Router { routePrompt(prompt: string, gate?: ModelCallGate): Promise<RouterDecision | { agent: string; instruction: string; action?: CapabilityAction; parameters?: Record<string, unknown> }> }

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
  private closing=false;
  private planning = 0;
  private pending = new Map<string, PendingTask>();
  private readonly outboxClaimOwner = `command-center-${randomUUID()}`;
  private outboxTimer?: ReturnType<typeof setInterval>;
  private drainingOutbox = false;
  private processingResults = new Set<string>();
  private recoveringResults = false;
  private recoveringIntakes = false;
  private acceptingTasks = new Set<string>();
  private workerRegistrations=new Map<string,Promise<boolean>>();
  private workerHeartbeats=new Set<string>();
  private workerClosures=new Set<Promise<void>>();

  constructor(
    port = 4000,
    private router: Router = new LlmRouter(),
    private signer = new TokenSigner(),
    private readonly controlPlane: ControlPlaneTaskClient = controlPlaneClientFromEnvironment(),
    private artifacts: ArtifactStore = artifactStoreFromEnvironment(),
  ) {
    initializeTracing();
    this.server = new WsCommandServer(port, { signer, allowedOrigin: process.env.ASQ_WEB_ORIGIN,
      ...(this.controlPlane.checkWorkload?{peerAuthorizer:peer=>this.controlPlane.checkWorkload!(peer)}:{}) });
    this.server.on('worker:connected',msg=>{
      if (process.env.GSS_REQUIRE_WORKER_PRESENCE!=='true' && process.env.GSS_RUNTIME_ENV!=='staging') return;
      const input=this.workerConnection(msg);
      if (!input || !this.controlPlane.registerWorker) return;
      const registration=this.controlPlane.registerWorker(input).then(()=>true,()=>{
        console.error('[CommandCenter] Worker presence registration failed safely.');return false;
      });
      this.workerRegistrations.set(msg.connectionId,registration);
    });
    this.server.on('worker:disconnected',msg=>{
      const input=this.workerConnection(msg),registration=this.workerRegistrations.get(msg.connectionId);
      this.workerRegistrations.delete(msg.connectionId);
      if (!input || !registration || !this.controlPlane.disconnectWorker) return;
      const closure=registration.then(async registered=>{if(registered) await this.controlPlane.disconnectWorker!(input);})
        .catch(()=>{console.error('[CommandCenter] Disconnect observation unavailable; lease expiry remains authoritative.');});
      this.workerClosures.add(closure);void closure.finally(()=>this.workerClosures.delete(closure));
    });
    this.server.on('message', msg => { void this.handle(msg).catch(error => {
      console.error('[CommandCenter] Request failed safely:', error instanceof Error ? error.message : 'unknown error');
      this.status('ERROR', 'Request failed safely. No unverified success was emitted.', msg?.incident_id);
    }); });
  }

  public async ready(): Promise<number> {
    await this.controlPlane.ready();
    if (this.controlPlane.runtimeState) this.halted = (await this.controlPlane.runtimeState()).halted;
    const port = await this.server.ready();
    {
      this.outboxTimer = setInterval(() => { void this.recoverWorkerResults(); void this.recoverIntakes(); void this.drainOutbox(); }, 1_000);
      this.outboxTimer.unref?.();
    }
    return port;
  }

  public async close(): Promise<void> {
    this.closing=true;
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    for (const task of this.pending.values()) clearTimeout(task.timer);
    this.pending.clear();
    await this.server.close();
    await Promise.allSettled([...this.workerClosures]);

  }

  private async handle(msg: any): Promise<void> {
    const pending = this.pending.get(msg.payload?.taskId);
    const claimedParent = msg.payload?.traceparent;
    const parent = validTraceparent(claimedParent) && pending?.task.traceparent &&
      claimedParent.split('-')[1] === pending.task.traceparent.split('-')[1] ? claimedParent : pending?.task.traceparent;
    return withGssSpan(pending ? 'gss.result.receive' : 'gss.investigation', {}, () => this.handleMessage(msg), parent);
  }

  private async handleMessage(msg: any): Promise<void> {
    if (msg.type === 'HEARTBEAT') return this.observeWorkerHeartbeat(msg);
    if (msg.type === 'TASK_ACCEPTED') return this.acceptWorkerTask(msg);
    if (msg.type === 'RESULT' || msg.type === 'EVIDENCE') return this.handleWorkerResult(msg);
    if (msg.type !== 'COMMAND' || !['CISO_Admin', 'SECURITY_ADMIN'].includes(msg.identity?.role) || !msg.identity.permissions.includes('CONTROL')) return;

    if (msg.payload.action === 'trigger_killswitch') {
      if (this.controlPlane.halt) await this.controlPlane.halt(String(msg.agentId), 'Operator kill-switch');
      this.halted = true;
      await this.server.broadcastAuthorized({ source: 'STANDALONE', target: 'BROADCAST', type: 'COMMAND', payload: { action: 'system_halt' } });
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        await this.controlPlane.updateTask(pending.task.taskId, 'CANCELLED', pending.agentId);
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
    if (this.controlPlane.receiveIntake) {
      const receipt = await this.controlPlane.receiveIntake({ commandId: msg.message_id, caseId, actorId, content: prompt });
      this.status(receipt.replay ? 'DUPLICATE' : 'RECEIVED', receipt.replay ? 'Request already persisted.' : 'Request durably accepted for triage.', caseId);
      await this.recoverIntakes();
      return;
    }
    let runId: string | undefined;
    await this.controlPlane.ensureCase(caseId, actorId);
    runId = (await this.controlPlane.ensureInvestigationRun(caseId, actorId)).runId;
    await this.controlPlane.appendMessage(caseId, 'USER', prompt, { requestMessageId: msg.message_id });
    await this.controlPlane.transitionCase(caseId, 'TRIAGING');
    this.status('RECEIVED', 'Request accepted for triage.', caseId, { caseId, caseState: 'TRIAGING' });

    this.planning++;
    let decision: Awaited<ReturnType<Router['routePrompt']>>;
    const usageId='CMD-'+msg.message_id;
    try { decision = await withGssSpan('gss.model.route', {}, () => this.router.routePrompt(prompt,this.modelGate(caseId,usageId))); }
    finally { this.planning--; }
    if (this.halted) return;

    const modelUsage = 'modelUsage' in decision ? decision.modelUsage : undefined;
    if (modelUsage) {
      const record: ModelUsageRecord = { schemaVersion: 'gss.model-usage.v1', usageId, caseId,
        traceId: currentTraceId(), ...modelUsage, createdAt: new Date().toISOString() };
      await this.controlPlane.recordModelUsage(record);
    }

    if (!['cli', 'ide', 'siem'].includes(decision.agent)) {
      const state = decision.agent === 'chat' ? 'CHAT' : 'ERROR';
      await this.controlPlane.appendMessage(caseId, decision.agent === 'chat' ? 'ASSISTANT' : 'SYSTEM', decision.instruction);
      await this.controlPlane.transitionCase(caseId, decision.agent === 'chat' ? 'RESPONDING' : 'TRIAGING');
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
      traceparent: currentTraceparent(),
    };
    const created = await this.controlPlane.createTask(task, actorId, { runId });
    if (!created.created) {
      this.status('DUPLICATE', 'This request has already created a task.', caseId, { caseId, taskId, task });
      return;
    }
    await this.controlPlane.transitionCase(caseId, 'COLLECTING_EVIDENCE');

    await this.drainOutbox();
  }

  private applyRemoteHalt(): void {
    this.halted = true;
    void this.server.broadcastAuthorized({ source: 'STANDALONE', target: 'BROADCAST', type: 'COMMAND', payload: { action: 'system_halt' } });
    for (const item of this.pending.values()) clearTimeout(item.timer);
    this.pending.clear();
  }

  private async acceptWorkerTask(msg: any): Promise<void> {
    const role = ({ 'cli-worker-agent': 'CLI_DAEMON', 'ide-worker-agent': 'IDE_AGENT', 'siem-worker-agent': 'SIEM' } as Record<string,string>)[msg.agentId];
    const { taskId, executionId } = msg.payload ?? {};
    if (!role || msg.identity?.role !== role || !msg.identity?.permissions?.includes('REPORT') ||
        typeof taskId !== 'string' || typeof executionId !== 'string' || this.acceptingTasks.has(taskId)) return;
    this.acceptingTasks.add(taskId);
    try {
      const receipt = this.controlPlane.acceptTask ? await this.controlPlane.acceptTask(taskId, msg.incident_id, msg.agentId, executionId, msg.connectionId) : { accepted: true };
      await this.server.sendToConnectionAuthorized(msg.connectionId, { source: 'STANDALONE', target: role, type: 'TASK_ACCEPTED_ACK',
        incident_id: msg.incident_id, payload: { taskId, executionId, ...receipt } });
    } finally { this.acceptingTasks.delete(taskId); }
  }

  private workerConnection(msg:any) {
    const role=({'cli-worker-agent':'CLI_DAEMON','ide-worker-agent':'IDE_AGENT','siem-worker-agent':'SIEM'} as Record<string,string>)[msg.agentId];
    if (!role || msg.identity?.role!==role || !msg.identity?.permissions?.includes('REPORT')) return undefined;
    return {workerId:msg.agentId as string,role,connectionId:msg.connectionId as string,observerId:this.outboxClaimOwner};
  }
  private async observeWorkerHeartbeat(msg:any):Promise<void> {
    const input=this.workerConnection(msg),registration=this.workerRegistrations.get(msg.connectionId);
    if (!input || !registration || !this.controlPlane.heartbeatWorker || this.workerHeartbeats.has(msg.connectionId)) return;
    this.workerHeartbeats.add(msg.connectionId);
    let committed=false;
    try {
      if (!await registration) return;
      await this.controlPlane.heartbeatWorker({...input,executionId:msg.payload.executionId,
        sequence:msg.payload.sequence,readiness:msg.payload.readiness});
      committed=true;
    } catch {console.error('[CommandCenter] Worker heartbeat denied or unavailable.');}
    finally {
      this.workerHeartbeats.delete(msg.connectionId);
      await this.server.sendToConnectionAuthorized(msg.connectionId,{source:'STANDALONE',type:'HEARTBEAT_ACK',
        payload:{executionId:msg.payload.executionId,sequence:msg.payload.sequence,committed}});
    }
  }

  private async recoverIntakes(): Promise<void> {
    if (this.closing || this.recoveringIntakes || this.halted || !this.controlPlane.claimIntakes || this.pending.size >= 100) return;
    this.recoveringIntakes = true;
    try {
      if (this.controlPlane.runtimeState && (await this.controlPlane.runtimeState()).halted) { this.applyRemoteHalt(); return; }
      const intakes = await this.controlPlane.claimIntakes(this.outboxClaimOwner);
      if(this.closing)return;
      await Promise.all(intakes.map(async intake => {
        try { await this.processIntake(intake); }
        catch { await this.controlPlane.releaseIntake?.(intake.commandId, this.outboxClaimOwner); }
      }));
    } catch { /* Authority unavailable: no model/task dispatch. Durable intake is retained. */ }
    finally { this.recoveringIntakes = false; }
  }

  private async processIntake(intake: CommandIntake): Promise<void> {
    const cp = this.controlPlane;
    const { caseId, actorId, commandId } = intake;
    const run = await cp.ensureInvestigationRun(caseId, actorId);
    let decision = intake.decision as Awaited<ReturnType<Router['routePrompt']>> | undefined;
    if (!decision) {
      decision = await withGssSpan('gss.model.route', {}, () => this.router.routePrompt(intake.content,this.modelGate(caseId,'CMD-'+commandId)));
      // Freeze the model output, never invent an observation from it.
      decision = Object.assign(decision, { __runId: run.runId, __createdAt: run.createdAt });
      await cp.saveIntakeDecision!(commandId, this.outboxClaimOwner, JSON.parse(JSON.stringify(decision)));
    }
    if (this.halted) return;
    const usage = 'modelUsage' in decision ? decision.modelUsage : undefined;
    if (usage) await cp.recordModelUsage({ schemaVersion: 'gss.model-usage.v1', usageId: 'CMD-' + commandId,
      caseId, traceId: currentTraceId(), ...usage, createdAt: run.createdAt });
    if (!['cli','ide','siem'].includes(decision.agent)) {
      const state = decision.agent === 'chat' ? 'RESPONDING' : 'TRIAGING';
      await cp.finishIntake!(commandId, this.outboxClaimOwner, decision.instruction, state);
      this.status(decision.agent === 'chat' ? 'CHAT' : 'ERROR', decision.instruction, caseId, { caseId, caseState: state });
      return;
    }
    const action = decision.action ?? legacyAction(decision);
    if (!action || !capabilityRegistry[action] || capabilityRegistry[action].target !== decision.agent) {
      await cp.finishIntake!(commandId, this.outboxClaimOwner, 'Requested capability denied.', 'TRIAGING'); return;
    }
    const task: GssTaskContract = { schemaVersion: TASK_SCHEMA_VERSION,
      taskId: 'CMD-' + createHash('sha256').update(commandId).digest('hex'), caseId, idempotencyKey: commandId,
      source: 'standalone', target: capabilityRegistry[action].target, action, parameters: decision.parameters ?? {},
      riskLevel: 'read_only', contextRefs: [], timeoutMs: 15000,
      createdAt: String((decision as unknown as Record<string,unknown>).__createdAt ?? run.createdAt), traceparent: currentTraceparent() };
    await cp.createTask(task, actorId, { runId: String((decision as unknown as Record<string,unknown>).__runId ?? run.runId) });
    await cp.finishIntake!(commandId, this.outboxClaimOwner, undefined, 'COLLECTING_EVIDENCE');
    await this.drainOutbox();
  }

  private modelGate(caseId:string,usageId:string):ModelCallGate | undefined {
    const cp=this.controlPlane;
    if(!cp.reserveModelCall || !cp.startModelCall) return undefined;
    return {
      reserve:input=>cp.reserveModelCall!({schemaVersion:'gss.model-reservation.v1',caseId,usageId,...input}),
      start:(id,attempt)=>cp.startModelCall!(id,attempt),
    };
  }

  private async handleWorkerResult(msg: any): Promise<void> {
    const taskId = msg.payload?.taskId;
    const expectedRole = ({ 'cli-worker-agent': 'CLI_DAEMON', 'ide-worker-agent': 'IDE_AGENT',
      'siem-worker-agent': 'SIEM' } as Record<string, string>)[msg.agentId];
    if (!expectedRole || msg.identity?.role !== expectedRole || !msg.identity.permissions?.includes('REPORT')) return;
    if (typeof taskId !== 'string' || this.processingResults.has(taskId)) return;
    this.processingResults.add(taskId);
    let delivery: WorkerDeliveryRecord | undefined;
    try {
      if (typeof msg.payload.deliveryId === 'string' && this.controlPlane.receiveWorkerDelivery) {
        if (!['CLI_DAEMON', 'IDE_AGENT', 'SIEM'].includes(msg.identity?.role)) return;
        const { deliveryId, ...payload } = msg.payload;
        delivery = await this.controlPlane.receiveWorkerDelivery({ schemaVersion: 'gss.worker-delivery.v1',
          deliveryId, workerId: msg.agentId, caseId: msg.incident_id, taskId, payload });
        if (delivery.committed) { this.acknowledgeResult(delivery); return; }
        if (delivery.retryAt && Date.parse(delivery.retryAt) > Date.now()) return;
      }
      await this.processWorkerResult(msg, delivery);
    } catch (error) {
      if (delivery) await this.controlPlane.deferWorkerDelivery?.(delivery.deliveryId).catch(() => {});
      throw error;
    } finally { this.processingResults.delete(taskId); }
  }

  private async recoverWorkerResults(): Promise<void> {
    if (this.closing || this.recoveringResults || !this.controlPlane.pendingWorkerDeliveries) return;
    this.recoveringResults = true;
    try {
      for (const delivery of await this.controlPlane.pendingWorkerDeliveries()) {
        if(this.closing)break;
        if (this.processingResults.has(delivery.taskId)) continue;
        this.processingResults.add(delivery.taskId);
        try {
          await withGssSpan('gss.result.recover', {}, () => this.processWorkerResult({ agentId: delivery.workerId,
            incident_id: delivery.caseId, payload: delivery.payload }, delivery), delivery.task.traceparent);
        } catch {
          await this.controlPlane.deferWorkerDelivery?.(delivery.deliveryId).catch(() => {});
          console.error('[CommandCenter] Durable result retry remains pending.');
        }
        finally { this.processingResults.delete(delivery.taskId); }
      }
    } catch { console.error('[CommandCenter] Durable result recovery unavailable.'); }
    finally { this.recoveringResults = false; }
  }

  private acknowledgeResult(delivery: WorkerDeliveryRecord): void {
    void this.server.sendToAgentAuthorized(delivery.workerId, { source: 'STANDALONE', type: 'RESULT_ACK',
      incident_id: delivery.caseId, payload: { deliveryId: delivery.deliveryId, taskId: delivery.taskId, committed: true } });
  }

  private async processWorkerResult(msg: any, delivery?: WorkerDeliveryRecord): Promise<void> {
    const taskId = msg.payload.taskId;
    const inMemory = this.pending.get(taskId);
    const pending = delivery ? { task: delivery.task, caseId: delivery.caseId, agentId: delivery.workerId,
      runId: delivery.runId, startedAt: Date.parse(delivery.startedAt), timer: inMemory?.timer } : inMemory;
    if (!pending || pending.agentId !== msg.agentId || pending.caseId !== msg.incident_id) return;
    if (pending.timer) clearTimeout(pending.timer);
    // Reliable results remain recoverable from PostgreSQL even if normalization/commit fails.
    if (delivery?.prepared) {
      const saved = delivery.prepared;
      await this.controlPlane.recordResult(saved.result, saved.observation, saved.loop, delivery.deliveryId);
      this.pending.delete(taskId); this.acknowledgeResult(delivery); await this.drainOutbox(); return;
    }
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
    const completedAt = delivery?.receivedAt ?? new Date().toISOString();
    const signatureRequired = process.env.GSS_REQUIRE_ARTIFACT_SIGNATURE === 'true';
    let artifactSignature: ArtifactSignature | undefined;
    let artifactSignatureState: 'SIGNED' | 'UNSIGNED_LOCAL' | 'SIGNING_FAILED' | 'REGISTRATION_FAILED' = 'UNSIGNED_LOCAL';
    if (artifact) {
      try {
        await this.controlPlane.registerArtifact({ caseId: pending.caseId, taskId, sha256: artifact.sha256,
          bytes: artifact.bytes, ref: artifact.ref, storageProvider: artifact.storageProvider ?? 'filesystem', mediaType: 'text/plain',
          ...(artifact.retentionUntil ? { retentionUntil: artifact.retentionUntil } : {}) });
      } catch (error) {
        artifactSignatureState = 'REGISTRATION_FAILED';
        status = 'FAILED';
        console.error('[CommandCenter] Artifact registration failed safely:', error instanceof Error ? error.message : 'unknown error');
      }
      if (artifactSignatureState !== 'REGISTRATION_FAILED') {
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
      }
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
        ...(status === 'COMPLETED' && siemEvidence ? { evidence: siemEvidence } : {}),
        ...(status === 'COMPLETED' && ideInvestigation ? { investigation: ideInvestigation } : {}),
        ...(status === 'COMPLETED' && siemVerdict ? { verdict: siemVerdict } : {}),
        ...(msg.payload?.failure ? { failure: msg.payload.failure } : {}) },
      evidenceRefs,
      errors: status === 'COMPLETED' ? [] : [{
        code: artifactSignatureState === 'REGISTRATION_FAILED' ? 'ARTIFACT_REGISTRATION_REQUIRED' :
          signatureRequired && artifactSignatureState === 'SIGNING_FAILED' ? 'ARTIFACT_SIGNATURE_REQUIRED' : workerStatus,
        message: artifactSignatureState === 'REGISTRATION_FAILED' ? 'Control Plane could not register immutable artifact metadata; evidence was rejected.' :
          signatureRequired && artifactSignatureState === 'SIGNING_FAILED' ? 'Control Plane could not sign the artifact; evidence was rejected.' : observation.summary,
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
    let submission: ResultSubmission = { result, ...(status === 'COMPLETED' ? { observation } : {}), ...(loop ? { loop } : {}) };
    if (delivery) {
      if (!this.controlPlane.prepareWorkerDelivery) throw new Error('Durable result preparation unavailable');
      submission = await this.controlPlane.prepareWorkerDelivery(delivery.deliveryId, submission);
    }
    const remoteResult = await this.controlPlane.recordResult(submission.result, submission.observation, submission.loop, delivery?.deliveryId);
    if (delivery) this.acknowledgeResult(delivery);
    const loopResult = remoteResult.loop;
    const durableLoop = loopResult && typeof loopResult === 'object' && 'decision' in loopResult
      ? loopResult as CommitObservationResult : undefined;
    const nextCaseState: CaseState = status !== 'COMPLETED' || durableLoop?.decision.kind === 'BLOCKED'
      ? 'INVESTIGATING' : durableLoop?.decision.kind === 'DISPATCH' ? 'COLLECTING_EVIDENCE' : 'ANALYZING';
    // Case/message lifecycle is written transactionally by the Control Plane result commit.
    this.status(status === 'COMPLETED' ? 'SUCCESS' : workerStatus === 'SUCCESS' ? status : workerStatus,
      status === 'COMPLETED' ? observation.summary : `Worker did not produce verified evidence: ${observation.summary}`,
      pending.caseId, { caseId: pending.caseId, taskId, result, observation, caseState: nextCaseState });
    if (durableLoop?.decision.kind === 'DISPATCH') {
      await this.drainOutbox();
    }
  }

  private async drainOutbox(): Promise<void> {
    if (this.closing || this.drainingOutbox || this.halted) return;
    this.drainingOutbox = true;
    try {
      if (this.controlPlane.runtimeState && (await this.controlPlane.runtimeState()).halted) {
        this.applyRemoteHalt(); return;
      }
      const initial = await this.controlPlane.claimInitialDispatches(this.outboxClaimOwner, 25);
      if(this.closing)return;
      for (const claim of initial) {
        if(this.closing)break;
        const capability = capabilityRegistry[claim.task.action];
        if (!capability || capability.target !== claim.task.target || claim.task.riskLevel !== 'read_only') {
          await this.controlPlane.releaseOutbox(claim.eventId, claim.claimOwner,
            'Initial capability denied', new Date(Date.now() + 60_000).toISOString());
          continue;
        }
        const agentId = `${claim.task.target}-worker-agent`;
        const instruction = capability.instruction ?? String(claim.task.parameters.question ??
          claim.task.parameters.query ?? claim.task.action);
        const delivered = await this.dispatchPreparedTask(claim.task, agentId, instruction, claim.runId);
        if (delivered && !this.controlPlane.acceptTask) await this.controlPlane.markOutboxPublished(claim.eventId, claim.claimOwner);
        else if (delivered) await this.controlPlane.releaseOutbox(claim.eventId, claim.claimOwner,
          'Waiting for durable worker acceptance', new Date(Date.now() + 5_000).toISOString());
        else await this.controlPlane.releaseOutbox(claim.eventId, claim.claimOwner,
          'Dispatch paused or worker offline', new Date(Date.now() + 5_000).toISOString());
      }
      if(this.closing)return;
      const claims = await this.controlPlane.claimPendingDispatches(this.outboxClaimOwner, 25);
      for (const claim of claims) {
        if(this.closing)break;
        await this.dispatchDecision(claim.loop, claim.claimOwner, claim.parentTaskId);
      }
    } catch (error) {
      console.error('[CommandCenter] Outbox recovery failed safely:', error instanceof Error ? error.message : 'unknown error');
    } finally {
      this.drainingOutbox = false;
    }
  }

  private async dispatchDecision(loop: CommitObservationResult, claimOwner: string, parentTaskId?: string): Promise<void> {
    return withGssSpan('gss.outbox.dispatch', {}, () => this.dispatchTracedDecision(loop, parentTaskId, claimOwner),
      loop.outbox.payload.traceparent ?? loop.run.traceparent);
  }

  private async dispatchTracedDecision(loop: CommitObservationResult, parentTaskId: string | undefined, claimOwner: string): Promise<void> {
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
      traceparent: currentTraceparent(),
    };
    const linkage = { runId: loop.run.runId, ...(parentTaskId ? { parentTaskId } : {}), actionFingerprint: action.fingerprint };
    await this.controlPlane.createTask(task, 'gss-planner', linkage);
    const agentId = action.target === 'cli' ? 'cli-worker-agent' : action.target === 'ide' ? 'ide-worker-agent' : 'siem-worker-agent';
    const instruction = capability.instruction ?? String(action.parameters.question ?? action.parameters.query ?? action.action);
    const delivered = await this.dispatchPreparedTask(task, agentId, instruction, loop.run.runId);
    if (delivered) {
      if (!this.controlPlane.acceptTask) await this.controlPlane.markOutboxPublished(loop.outbox.eventId, claimOwner);
      else await this.controlPlane.releaseOutbox(loop.outbox.eventId, claimOwner,
        'Waiting for durable worker acceptance', new Date(Date.now() + 5_000).toISOString());
    } else if (claimOwner) {
      await this.controlPlane.releaseOutbox(loop.outbox.eventId, claimOwner,
        `${agentId} was offline`, new Date(Date.now() + 5_000).toISOString());
    }
  }

  private async dispatchPreparedTask(task: GssTaskContract, agentId: string, instruction: string, runId?: string): Promise<boolean> {
    return withGssSpan('gss.task.dispatch', { 'gss.task_id': task.taskId, 'gss.action': task.action, 'gss.target': task.target },
      () => this.dispatchTracedTask(task, agentId, instruction, runId), task.traceparent);
  }

  private async dispatchTracedTask(task: GssTaskContract, agentId: string, instruction: string, runId?: string): Promise<boolean> {
    if (this.closing || this.halted || this.pending.has(task.taskId) || this.pending.size >= 100) return false;
    if (process.env.GSS_REQUIRE_WORKER_PRESENCE==='true' || process.env.GSS_RUNTIME_ENV==='staging') {
      if (!this.controlPlane.workerReady || !await this.controlPlane.workerReady(agentId)) return false;
    }
    task = { ...task, traceparent: currentTraceparent() };
    const workerPayload: Record<string, unknown> = { ...task, incidentId: task.caseId, instruction };
    if (process.env.GSS_TASK_PUBLIC_KEY_BASE64 && this.controlPlane.authorizeTask) workerPayload.token = await this.controlPlane.authorizeTask(task.taskId);
    else if (process.env.GSS_RUNTIME_ENV === 'staging') throw new Error('Staging task authorization requires Ed25519');
    else if (task.target === 'cli') workerPayload.token = this.signer.sign({
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
    // Persist before delivery so a fast result cannot be regressed by a late dispatch write.
    try { await this.controlPlane.updateTask(task.taskId, 'DISPATCHED', agentId); }
    catch (error) { clearTimeout(timer); this.pending.delete(task.taskId); throw error; }
    if (this.closing || this.halted) { clearTimeout(timer); this.pending.delete(task.taskId); return false; }
    const delivered = await this.server.sendToAgentAuthorized(agentId, {
      source: 'STANDALONE',
      target: task.target === 'cli' ? 'CLI_DAEMON' : task.target === 'ide' ? 'IDE_AGENT' : 'SIEM',
      type: 'TASK', incident_id: task.caseId, payload: workerPayload,
    });
    if (!delivered) {
      clearTimeout(timer);
      this.pending.delete(task.taskId);
      await this.controlPlane.updateTask(task.taskId, 'BLOCKED', agentId);
      this.status('OFFLINE', `${agentId} is not connected. Nothing was executed.`, task.caseId,
        { caseId: task.caseId, taskId: task.taskId, task, caseState: 'COLLECTING_EVIDENCE' });
      return false;
    }
    this.status('DISPATCHED', `Task ${task.taskId} was routed to ${agentId}.`, task.caseId,
      { caseId: task.caseId, taskId: task.taskId, task, caseState: 'COLLECTING_EVIDENCE' });
    return true;
  }

  private async timeoutTask(taskId: string): Promise<void> {
    const pending = this.pending.get(taskId);
    if (!pending) return;
    this.pending.delete(taskId);
    await this.controlPlane.updateTask(taskId, 'FAILED', pending.agentId);
    this.status('TIMEOUT', 'Worker did not return evidence before the bounded timeout.', pending.caseId,
      { caseId: pending.caseId, taskId, caseState: 'INVESTIGATING' });
  }

  private status(state: string, message: string, caseId = 'GLOBAL_INCIDENT', extra: Partial<RuntimeStatusPayload> = {}): void {
    void this.server.broadcastAuthorized({ source: 'STANDALONE', target: 'BROADCAST', type: 'STATUS', incident_id: caseId,
      payload: { action: 'ui_flash', source: state, message, ...extra } satisfies RuntimeStatusPayload });
  }
}
