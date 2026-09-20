import { ASQWebSocketClient, TokenSigner } from '@asq/sdk';
import { ControlledExecutor } from './controlled-executor.js';

export class CliWorkerDaemon {
    private wsClient: ASQWebSocketClient;
    private executor: ControlledExecutor;
    constructor(url = process.env.ASQ_WS_URL ?? 'ws://127.0.0.1:4000', token = process.env.ASQ_WORKER_TOKEN ?? '') {
        if (!token) throw new Error('ASQ_WORKER_TOKEN required');
        this.wsClient = new ASQWebSocketClient(url, token);
        this.executor = new ControlledExecutor(new TokenSigner());
        this.wsClient.subscribe('message', async data => {
            if (data.type === 'COMMAND' && data.source === 'STANDALONE' && data.payload?.action === 'system_halt') {
                this.executor.halt(); return;
            }
            if (data.type !== 'TASK' || data.source !== 'STANDALONE') return;
            const result = await this.executor.execute(data.payload);
            try {
                this.wsClient.publishMessage({ source: 'CLI_DAEMON', type: 'EVIDENCE',
                    incident_id: data.incident_id, payload: { ...result, action: data.payload?.action,
                        content: result.status + ': ' + result.output } });
            } catch { /* Connection closed: never reinterpret lost delivery as success. */ }
        });
    }
    public run(): void { this.wsClient.connect(); }
    public stop(): void { this.executor.halt(); this.wsClient.disconnect(); }
}
