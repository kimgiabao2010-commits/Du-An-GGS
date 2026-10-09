import { ASQWebSocketClient, isGssTaskContract, taskVerifierFromEnvironment, taskAuthorizationHash, type GssTaskContract, withGssSpan, currentTraceparent, initializeTracing } from '@asq/sdk';
import { ReadonlyRepoInvestigator } from './readonly-investigator.js';
import { repoInvestigatorFromEnvironment } from './sandbox-investigator.js';

export class IdeInvestigatorDaemon {
  private wsClient: ASQWebSocketClient;
  private halted = false;
  private controllers = new Map<string, AbortController>();
  private seenTaskIds = new Set<string>();
  private taskVerifier = taskVerifierFromEnvironment();

  public constructor(
    url = process.env.ASQ_WS_URL ?? 'ws://127.0.0.1:4000',
    token = process.env.ASQ_IDE_TOKEN ?? '',
    private investigator: Pick<ReadonlyRepoInvestigator,'execute'> = repoInvestigatorFromEnvironment(),
  ) {
    initializeTracing();
    if (!token) throw new Error('ASQ_IDE_TOKEN required');
    if (!this.taskVerifier && process.env.GSS_RUNTIME_ENV === 'staging') throw new Error('Staging requires a verify-only task key');
    this.wsClient = new ASQWebSocketClient(url, token, 5, { workerId: 'ide-worker-agent', directory: process.env.GSS_WORKER_SPOOL_DIR,
      readiness:()=>this.halted?'HALTED':this.controllers.size>=2?'BUSY':'READY' });
    this.wsClient.subscribe('message', data => { void this.handle(data); });
  }

  private async handle(data: any): Promise<void> {
    if (data.type === 'COMMAND' && data.source === 'STANDALONE' && data.payload?.action === 'system_halt') {
      this.halted = true;
      for (const controller of this.controllers.values()) controller.abort();
      return;
    }
    if (data.type !== 'TASK' || data.source !== 'STANDALONE') return;
    const task = data.payload as GssTaskContract;
    if (!isGssTaskContract(task) || task.target !== 'ide' || !['search_code', 'analyze_code'].includes(task.action)) return;
    if (this.taskVerifier) {
      const claims = this.taskVerifier.verify(data.payload.token);
      if (!claims || claims.agentId !== 'ide-worker-agent' || claims.incidentId !== task.caseId || claims.taskId !== task.taskId ||
        !claims.permissions.includes('EXECUTE_READ_ONLY') || claims.taskHash !== taskAuthorizationHash(task)) return;
    }
    if (this.wsClient.hasPendingResult(task.taskId)) return;
    if (!await this.wsClient.acceptTask(data.incident_id, task.taskId)) return;
    if (this.halted || this.seenTaskIds.has(task.taskId)) {
      this.publish(data.incident_id, {
        taskId: task.taskId,
        status: 'BLOCKED',
        output: 'IDE worker is halted or task was replayed.',
        failure: { code: this.halted ? 'HALTED' : 'REPLAYED_TASK', message: 'IDE task was not executed.' },
      });
      return;
    }
    if (this.controllers.size >= 2) {
      this.publish(data.incident_id, {
        taskId: task.taskId,
        status: 'BLOCKED',
        output: 'IDE worker concurrency limit reached.',
        failure: { code: 'CONCURRENCY_LIMIT', message: 'IDE task was not executed.' },
      });
      return;
    }
    this.seenTaskIds.add(task.taskId);
    if (this.seenTaskIds.size > 10_000) this.seenTaskIds.delete(this.seenTaskIds.values().next().value!);
    const controller = new AbortController();
    this.controllers.set(task.taskId, controller);
    try {
      await withGssSpan('gss.worker.execute', { 'gss.task_id': task.taskId, 'gss.target': 'ide' }, async () => {
        const result = await this.investigator.execute(task, controller.signal);
        this.publish(data.incident_id, { ...result, action: task.action, content: result.output, traceparent: currentTraceparent() });
      }, task.traceparent);
    } catch {
      this.publish(data.incident_id,{taskId:task.taskId,status:'FAILED',output:'IDE investigation failed safely; no evidence accepted.',
        failure:{code:'INVESTIGATION_FAILED',message:'Execution did not produce validated evidence.'}});
    } finally {
      this.controllers.delete(task.taskId);
    }
  }

  private publish(incidentId: string, payload: Record<string, unknown>): void {
    try {
      this.wsClient.publishResult(incidentId, payload);
    } catch { console.error('[IDE] Result journal failed; no delivery success claimed.'); }
  }

  public run(): void { this.wsClient.connect(); }
  public connect(): Promise<void> {
    return new Promise(resolve => {
      let connected = false;
      this.wsClient.subscribe('system:connected', () => {
        if (!connected) { connected = true; resolve(); }
      });
      this.run();
    });
  }
  public stop(): void {
    this.halted = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.wsClient.disconnect();
  }
}
