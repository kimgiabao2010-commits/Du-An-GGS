import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
export class WsCommandServer extends EventEmitter {
    wss;
    clients = new Map();
    constructor(port) {
        super();
        this.wss = new WebSocketServer({ port });
        this.wss.on('connection', (ws) => {
            console.log('[WsCommandServer] Client connected.');
            let currentAgentId = 'unknown';
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    // Xử lý đăng ký Agent
                    if (data.type === 'register_agent') {
                        currentAgentId = data.agentId;
                        this.clients.set(currentAgentId, ws);
                        console.log(`[WsCommandServer] Đã đăng ký Agent kết nối: ${currentAgentId}`);
                        return;
                    }
                    // Phát sự kiện cho các module khác của Standalone tiếp nhận
                    this.emit('message', { agentId: currentAgentId, ...data });
                }
                catch (e) {
                    console.error('[WsCommandServer] Lỗi xử lý tin nhắn:', e);
                }
            });
            ws.on('close', () => {
                if (currentAgentId !== 'unknown') {
                    this.clients.delete(currentAgentId);
                    console.log(`[WsCommandServer] Agent ngắt kết nối: ${currentAgentId}`);
                }
            });
        });
        console.log(`[WsCommandServer] Server khởi động tại port ${port}`);
    }
    /**
     * Gửi tin nhắn đích danh cho 1 Agent (IDE hoặc CLI)
     */
    sendToAgent(agentId, payload) {
        const ws = this.clients.get(agentId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }
    /**
     * Broadcast tới tất cả Agent (bao gồm Web UI nếu có)
     */
    broadcast(payload) {
        const msg = JSON.stringify(payload);
        this.clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(msg);
            }
        });
    }
}
//# sourceMappingURL=ws-server.js.map