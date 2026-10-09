import { ASQWebSocketClient, correlateEvidence, taskVerifierFromEnvironment, taskAuthorizationHash, isGssTaskContract, withGssSpan, currentTraceparent, initializeTracing } from '@asq/sdk';
import type { GssTaskContract, IndicatorType, InvestigationRequest, SiemAdapter } from '@asq/sdk';
import { ChronicleAdapter, SiemAdapterError } from './chronicle-adapter.js';

export class SiemWorkerDaemon {
  private wsClient: ASQWebSocketClient;
  private halted = false;
  private active = 0;
  private controllers = new Set<AbortController>();
  private taskVerifier = taskVerifierFromEnvironment();
  constructor(
    adapter: SiemAdapter = ChronicleAdapter.fromEnvironment(),
    url = process.env.ASQ_WS_URL ?? 'ws://127.0.0.1:4000',
    token = process.env.ASQ_SIEM_TOKEN ?? '',
  ) {
    initializeTracing();
    if (!token) throw new Error('ASQ_SIEM_TOKEN required');
    if (!this.taskVerifier && process.env.GSS_RUNTIME_ENV === 'staging') throw new Error('Staging requires a verify-only task key');
    this.wsClient = new ASQWebSocketClient(url, token, 5, { workerId: 'siem-worker-agent', directory: process.env.GSS_WORKER_SPOOL_DIR,
      readiness:()=>this.halted?'HALTED':this.active>=2?'BUSY':'READY' });
    this.wsClient.subscribe('message', async data => {
      if (data.type === 'COMMAND' && data.source === 'STANDALONE' && data.payload?.action === 'system_halt') {
        this.halted = true; for (const controller of this.controllers) controller.abort(); return;
      }
      if (data.type !== 'TASK' || data.source !== 'STANDALONE') return;
      if (this.halted || this.active >= 2) return;
      const task = data.payload as GssTaskContract;
      if (!isGssTaskContract(task) || task.target !== 'siem' || task.action !== 'search_siem') return;
      if (this.taskVerifier) {
        const claims = this.taskVerifier.verify(data.payload.token);
        if (!claims || claims.agentId !== 'siem-worker-agent' || claims.incidentId !== task.caseId || claims.taskId !== task.taskId ||
          !claims.permissions.includes('EXECUTE_READ_ONLY') || claims.taskHash !== taskAuthorizationHash(task)) return;
      }
      if (this.wsClient.hasPendingResult(task.taskId)) return;
      if (!await this.wsClient.acceptTask(data.incident_id, task.taskId)) return;
      if (this.halted || this.active >= 2) return;
      this.active++;
      const controller=new AbortController();this.controllers.add(controller);
      try {
      await withGssSpan('gss.worker.execute', { 'gss.task_id': task.taskId, 'gss.target': 'siem' }, async () => {
      const started = Date.now();
      try {
        const parameters = task.parameters ?? {};
        const request: InvestigationRequest = {
          incidentId: task.caseId, taskId: task.taskId, idempotencyKey: task.idempotencyKey,
          requestedBy: 'standalone',
          indicator: { type: String(parameters.indicatorType) as IndicatorType, value: String(parameters.indicatorValue ?? '') },
          timeRange: { start: String(parameters.startTime ?? ''), end: String(parameters.endTime ?? '') },
          limit: typeof parameters.limit === 'number' ? parameters.limit : undefined,
        };
        const evidence = await adapter.investigate(request,controller.signal);
        if (this.halted) return; // Halted provider output cannot become evidence.
        const verdict = correlateEvidence(evidence);
        this.publish(data.incident_id, { taskId: task.taskId, status: 'SUCCESS', output: JSON.stringify(evidence),
          evidence, verdict, durationMs: Date.now() - started, traceparent: currentTraceparent() });
      } catch (error) {
        if (this.halted) return;
        const code = error instanceof SiemAdapterError ? error.code : 'UPSTREAM_FAILURE';
        const message = error instanceof Error ? error.message : 'Unknown SIEM failure';
        this.publish(data.incident_id, { taskId: task.taskId, status: code === 'INVALID_QUERY' || code === 'AUTH_DENIED' || code === 'UNCONFIGURED' ? 'BLOCKED' : 'FAILED',
          output: `${code}: ${message}`, failure: { code, message }, durationMs: Date.now() - started, traceparent: currentTraceparent() });
      }
      }, task.traceparent);
      } finally { this.active--; this.controllers.delete(controller); }
    });
  }
  private publish(incidentId: string, payload: Record<string, unknown>): void {
    try { this.wsClient.publishResult(incidentId, payload); }
    catch { console.error('[SIEM] Result journal failed; no delivery success claimed.'); }
  }
  run(): void { this.wsClient.connect(); }
  stop(): void { this.halted = true;for(const controller of this.controllers) controller.abort();this.wsClient.disconnect(); }
}
