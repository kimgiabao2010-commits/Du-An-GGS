import { WebSocket } from 'ws';
export class ASQWebSocketClient {
    ws = null;
    url;
    token;
    reconnectAttempts = 0;
    maxReconnectAttempts;
    callbacks = new Map();
    constructor(url, token, maxReconnectAttempts = 5) {
        this.url = url;
        this.token = token;
        this.maxReconnectAttempts = maxReconnectAttempts;
    }
    connect() {
        const headers = { Authorization: `Bearer ${this.token}` };
        this.ws = new WebSocket(this.url, { headers });
        this.ws.on('open', () => {
            this.reconnectAttempts = 0;
            this.emit('system:connected', { status: 'Connected to ASQ C2' });
        });
        this.ws.on('message', (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                this.emit(parsed.event, parsed.payload);
            }
            catch (e) {
                // Drop malformed frame
            }
        });
        this.ws.on('close', () => this.handleDisconnect());
        this.ws.on('error', () => this.handleDisconnect());
    }
    handleDisconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.pow(2, this.reconnectAttempts) * 1000;
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), delay);
        }
        else {
            this.emit('system:error', { error: 'Max reconnect attempts reached' });
        }
    }
    subscribe(event, callback) {
        const cbs = this.callbacks.get(event) || [];
        cbs.push(callback);
        this.callbacks.set(event, cbs);
    }
    publish(event, payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ event, payload }));
        }
        else {
            throw new Error('WebSocket is not connected');
        }
    }
    emit(event, data) {
        const cbs = this.callbacks.get(event);
        if (cbs) {
            cbs.forEach(cb => cb(data));
        }
    }
    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}
//# sourceMappingURL=ws-client.js.map