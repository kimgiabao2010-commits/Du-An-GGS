import { ASQWebSocketClient, TokenSigner, taskVerifierFromEnvironment, withGssSpan, currentTraceparent, initializeTracing } from '@asq/sdk';
import { ControlledExecutor } from './controlled-executor.js';

export class CliWorkerDaemon {
    private wsClient: ASQWebSocketClient;
    private executor: ControlledExecutor;
    private halted=false;
    constructor(url = process.env.ASQ_WS_URL ?? 'ws://127.0.0.1:4000', token = process.env.ASQ_WORKER_TOKEN ?? '') {
        initializeTracing();
        if (!token) throw new Error('ASQ_WORKER_TOKEN required');
        this.wsClient = new ASQWebSocketClient(url, token, 5, { workerId: 'cli-worker-agent', directory: process.env.GSS_WORKER_SPOOL_DIR,
          readiness:()=>this.halted?'HALTED':'READY' });
        const verifier = taskVerifierFromEnvironment();
        if (!verifier && process.env.GSS_RUNTIME_ENV === 'staging') throw new Error('Staging requires a verify-only task key');
        this.executor = new ControlledExecutor(verifier ?? new TokenSigner());
        this.wsClient.subscribe('message', async data => {
            if (data.type === 'COMMAND' && data.source === 'STANDALONE' && data.payload?.action === 'system_halt') {
                this.halted=true;this.executor.halt(); return;
            }
            if (data.type !== 'TASK' || data.source !== 'STANDALONE') return;
            if (this.wsClient.hasPendingResult(data.payload?.taskId)) return;
            if (!await this.wsClient.acceptTask(data.incident_id, data.payload?.taskId)) return;
            await withGssSpan('gss.worker.execute', { 'gss.task_id': data.payload?.taskId, 'gss.target': 'cli' }, async () => {
            const result = await this.executor.execute(data.payload);
            try {
                this.wsClient.publishResult(data.incident_id, { ...result, action: data.payload?.action,
                        traceparent: currentTraceparent(), content: result.status + ': ' + result.output });
            } catch { console.error('[CLI] Result journal failed; no delivery success claimed.'); }
            }, data.payload?.traceparent);
        });
    }
    public run(): void { this.wsClient.connect(); }
    public stop(): void { this.halted=true;this.executor.halt(); this.wsClient.disconnect(); }
}
