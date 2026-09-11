import { EventEmitter } from 'events';
export declare class WsCommandServer extends EventEmitter {
    private wss;
    private clients;
    constructor(port: number);
    /**
     * Gửi tin nhắn đích danh cho 1 Agent (IDE hoặc CLI)
     */
    sendToAgent(agentId: string, payload: any): boolean;
    /**
     * Broadcast tới tất cả Agent (bao gồm Web UI nếu có)
     */
    broadcast(payload: any): void;
}
//# sourceMappingURL=ws-server.d.ts.map