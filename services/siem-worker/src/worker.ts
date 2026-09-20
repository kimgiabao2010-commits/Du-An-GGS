import { ASQWebSocketClient, correlateEvidence } from '@asq/sdk';
import type { GssTaskContract, IndicatorType, InvestigationRequest, SiemAdapter } from '@asq/sdk';
import { ChronicleAdapter, SiemAdapterError } from './chronicle-adapter.js';

export class SiemWorkerDaemon {
  private wsClient: ASQWebSocketClient;
  constructor(
    adapter: SiemAdapter = ChronicleAdapter.fromEnvironment(),
    url = process.env.ASQ_WS_URL ?? 'ws://127.0.0.1:4000',
    token = process.env.ASQ_SIEM_TOKEN ?? '',
  ) {
    if (!token) throw new Error('ASQ_SIEM_TOKEN required');
    this.wsClient = new ASQWebSocketClient(url, token);
    this.wsClient.subscribe('message', async data => {
      if (data.type !== 'TASK' || data.source !== 'STANDALONE') return;
      const task = data.payload as GssTaskContract;
      if (task.target !== 'siem' || task.action !== 'search_siem') return;
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
        const evidence = await adapter.investigate(request);
        const verdict = correlateEvidence(evidence);
        this.publish(data.incident_id, { taskId: task.taskId, status: 'SUCCESS', output: JSON.stringify(evidence),
          evidence, verdict, durationMs: Date.now() - started });
      } catch (error) {
        const code = error instanceof SiemAdapterError ? error.code : 'UPSTREAM_FAILURE';
        const message = error instanceof Error ? error.message : 'Unknown SIEM failure';
        this.publish(data.incident_id, { taskId: task.taskId, status: code === 'INVALID_QUERY' || code === 'AUTH_DENIED' || code === 'UNCONFIGURED' ? 'BLOCKED' : 'FAILED',
          output: `${code}: ${message}`, failure: { code, message }, durationMs: Date.now() - started });
      }
    });
  }
  private publish(incidentId: string, payload: Record<string, unknown>): void {
    try { this.wsClient.publishMessage({ source: 'SIEM', type: 'EVIDENCE', incident_id: incidentId, payload }); }
    catch { /* Lost delivery never becomes success. */ }
  }
  run(): void { this.wsClient.connect(); }
  stop(): void { this.wsClient.disconnect(); }
}
