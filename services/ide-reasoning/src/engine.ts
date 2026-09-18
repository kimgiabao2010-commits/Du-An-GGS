import { ASQWebSocketClient } from '@asq/sdk';

export class IdeInvestigatorDaemon {
    private wsClient: ASQWebSocketClient;
    constructor(url = process.env.ASQ_WS_URL ?? 'ws://127.0.0.1:4000', token = process.env.ASQ_IDE_TOKEN ?? '') {
        if (!token) throw new Error('ASQ_IDE_TOKEN required');
        this.wsClient = new ASQWebSocketClient(url, token);
        this.wsClient.subscribe('message', data => {
            if (data.type !== 'TASK' || data.source !== 'STANDALONE') return;
            this.wsClient.publishMessage({ source: 'IDE_AGENT', type: 'RESULT', incident_id: data.incident_id,
                payload: { taskId: data.payload?.taskId, status: 'BLOCKED',
                    content: 'SIEM adapter chưa được cấu hình. Chưa truy vấn log; chưa có bằng chứng để kết luận.' } });
        });
    }
    public run(): void { this.wsClient.connect(); }
    public stop(): void { this.wsClient.disconnect(); }
}
