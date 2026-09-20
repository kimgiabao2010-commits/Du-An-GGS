import { createHash, randomUUID } from 'node:crypto';
import {
  RESULT_SCHEMA_VERSION, TASK_SCHEMA_VERSION, TokenSigner, WsCommandServer,
  type CapabilityAction, type CaseState, type GssResultContract, type GssTaskContract,
  type ObservationPack, type RuntimeStatusPayload, type TaskStatus,
} from '@asq/sdk';
import { FilesystemArtifactStore, PostgresRuntimeStore, type RuntimeStore } from '@asq/persistence';
import { LlmRouter, type RouterDecision } from './agent/llm-router.js';

interface Router { routePrompt(prompt: string): Promise<RouterDecision | { agent: string; instruction: string; action?: CapabilityAction; parameters?: Record<string, unknown> }> }

interface PendingTask {
  caseId: string;
  agentId: string;
  task: GssTaskContract;
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

function packOutput(caseId: string, taskId: string, output: string, evidenceRefs: string[], rawArtifactRef?: string): ObservationPack {
  const nonEmpty = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const summary = (nonEmpty.slice(0, 8).join('\n') || 'Worker returned no textual observation').slice(0, 1600);
  return {
    observationId: `OBS-${randomUUID()}`,
    caseId,
    taskId,
    summary,
    facts: nonEmpty.slice(0, 12).map((value, index) => ({ key: `line_${index + 1}`, value: value.slice(0, 500) })),
    evidenceRefs,
    rawArtifactRef,
    originalBytes: Buffer.byteLength(output, 'utf8'),
    packedBytes: Buffer.byteLength(summary, 'utf8'),
    createdAt: new Date().toISOString(),
  };
}

export class CentralCommandOrchestrator {
  private server: WsCommandServer;
  private halted = false;
  private planning = 0;
  private pending = new Map<string, PendingTask>();

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
    return this.server.ready();
  }

  public async close(): Promise<void> {
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
        await this.store?.updateTask(pending.task.taskId, 'CANCELLED', pending.agentId);
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
    if (this.store) {
      await this.store.ensureCase(caseId, actorId);
      await this.store.appendMessage(caseId, 'USER', prompt, { requestMessageId: msg.message_id });
      await this.store.transitionCase(caseId, 'TRIAGING');
    }
    this.status('RECEIVED', 'Request accepted for triage.', caseId, { caseId, caseState: 'TRIAGING' });

    this.planning++;
    let decision: Awaited<ReturnType<Router['routePrompt']>>;
    try { decision = await this.router.routePrompt(prompt); }
    finally { this.planning--; }
    if (this.halted) return;

    if (!['cli', 'ide', 'siem'].includes(decision.agent)) {
      const state = decision.agent === 'chat' ? 'CHAT' : 'ERROR';
      await this.store?.appendMessage(caseId, decision.agent === 'chat' ? 'ASSISTANT' : 'SYSTEM', decision.instruction);
      await this.store?.transitionCase(caseId, decision.agent === 'chat' ? 'RESPONDING' : 'TRIAGING');
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
    if (this.store && !(await this.store.createTask(task, actorId)).created) {
      this.status('DUPLICATE', 'This request has already created a task.', caseId, { caseId, taskId, task });
      return;
    }
    await this.store?.transitionCase(caseId, 'COLLECTING_EVIDENCE');

    const agentId = decision.agent === 'cli' ? 'cli-worker-agent' : decision.agent === 'ide' ? 'ide-worker-agent' : 'siem-worker-agent';
    const workerPayload: Record<string, unknown> = { ...task, incidentId: caseId, instruction: capability.instruction ?? decision.instruction };
    if (decision.agent === 'cli') workerPayload.token = this.signer.sign({
      agentId,
      role: 'STANDALONE',
      permissions: ['EXECUTE_RECON'],
      timestamp: Date.now(),
      expiresAt: Date.now() + 60_000,
      taskId,
      incidentId: caseId,
      instructionHash: createHash('sha256').update(String(workerPayload.instruction)).digest('hex'),
    });

    const timer = setTimeout(() => { void this.timeoutTask(taskId); }, task.timeoutMs);
    this.pending.set(taskId, { caseId, agentId, task, startedAt: Date.now(), timer });
    const delivered = this.server.sendToAgent(agentId, {
      source: 'STANDALONE', target: decision.agent === 'cli' ? 'CLI_DAEMON' : decision.agent === 'ide' ? 'IDE_AGENT' : 'SIEM',
      type: 'TASK', incident_id: caseId, payload: workerPayload,
    });
    if (!delivered) {
      clearTimeout(timer);
      this.pending.delete(taskId);
      await this.store?.updateTask(taskId, 'BLOCKED', agentId);
      this.status('OFFLINE', `${agentId} is not connected. Nothing was executed.`, caseId, { caseId, taskId, task, caseState: 'COLLECTING_EVIDENCE' });
      return;
    }
    await this.store?.updateTask(taskId, 'DISPATCHED', agentId);
    this.status('DISPATCHED', `Task ${taskId} was routed to ${agentId}.`, caseId, { caseId, taskId, task, caseState: 'COLLECTING_EVIDENCE' });
  }

  private async handleWorkerResult(msg: any): Promise<void> {
    const taskId = msg.payload?.taskId;
    const pending = this.pending.get(taskId);
    if (!pending || pending.agentId !== msg.agentId || pending.caseId !== msg.incident_id) return;
    clearTimeout(pending.timer);
    this.pending.delete(taskId);

    const workerStatus = String(msg.payload.status ?? 'FAILED');
    const status: GssResultContract['status'] = workerStatus === 'SUCCESS' ? 'COMPLETED' :
      workerStatus === 'BLOCKED' || workerStatus === 'DENIED' ? 'BLOCKED' : workerStatus === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    const output = String(msg.payload.output ?? msg.payload.content ?? '');
    const artifact = output ? await this.artifacts.storeEvidence(pending.caseId, taskId, output) : undefined;
    const adapterEvidenceId = typeof msg.payload?.evidence?.evidenceId === 'string' ? msg.payload.evidence.evidenceId : undefined;
    const evidenceRefs = status === 'COMPLETED' ? [adapterEvidenceId, artifact ? `EVD-${artifact.sha256.slice(0, 16)}` : undefined]
      .filter((value): value is string => Boolean(value)) : [];
    const observation = packOutput(pending.caseId, taskId, output, evidenceRefs, artifact?.ref);
    const result: GssResultContract = {
      schemaVersion: RESULT_SCHEMA_VERSION,
      taskId,
      caseId: pending.caseId,
      executor: pending.task.target,
      status,
      result: { summary: observation.summary, action: pending.task.action, rawArtifactRef: artifact?.ref,
        sha256: artifact?.sha256, ...(msg.payload?.evidence ? { evidence: msg.payload.evidence } : {}),
        ...(msg.payload?.verdict ? { verdict: msg.payload.verdict } : {}),
        ...(msg.payload?.failure ? { failure: msg.payload.failure } : {}) },
      evidenceRefs,
      errors: status === 'COMPLETED' ? [] : [{ code: workerStatus, message: observation.summary }],
      metrics: { durationMs: Date.now() - pending.startedAt, outputBytes: artifact?.bytes ?? 0 },
      completedAt: new Date().toISOString(),
    };
    await this.store?.recordResult(result, observation);
    await this.store?.appendMessage(pending.caseId, 'WORKER', observation.summary, { taskId, evidenceRefs });
    await this.store?.transitionCase(pending.caseId, status === 'COMPLETED' ? 'ANALYZING' : 'INVESTIGATING');
    this.status(workerStatus, status === 'COMPLETED' ? observation.summary : `Worker did not produce verified evidence: ${observation.summary}`,
      pending.caseId, { caseId: pending.caseId, taskId, result, observation, caseState: status === 'COMPLETED' ? 'ANALYZING' : 'INVESTIGATING' });
  }

  private async timeoutTask(taskId: string): Promise<void> {
    const pending = this.pending.get(taskId);
    if (!pending) return;
    this.pending.delete(taskId);
    await this.store?.updateTask(taskId, 'FAILED', pending.agentId);
    this.status('TIMEOUT', 'Worker did not return evidence before the bounded timeout.', pending.caseId,
      { caseId: pending.caseId, taskId, caseState: 'INVESTIGATING' });
  }

  private status(state: string, message: string, caseId = 'GLOBAL_INCIDENT', extra: Partial<RuntimeStatusPayload> = {}): void {
    this.server.broadcast({ source: 'STANDALONE', target: 'BROADCAST', type: 'STATUS', incident_id: caseId,
      payload: { action: 'ui_flash', source: state, message, ...extra } satisfies RuntimeStatusPayload });
  }
}
