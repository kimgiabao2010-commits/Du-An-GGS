import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
export class ASQWebSocketClient {
    url;
    token;
    maxReconnectAttempts;
    ws = null;
    reconnectAttempts = 0;
    stopped = false;
    timer;
    callbacks = new Map();
    constructor(url, token, maxReconnectAttempts = 5) {
        this.url = url;
        this.token = token;
        this.maxReconnectAttempts = maxReconnectAttempts;
    }
    connect() {
        this.stopped = false;
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
            return;
        const ws = new WebSocket(this.url, { headers: { Authorization: 'Bearer ' + this.token }, maxPayload: 65536 });
        this.ws = ws;
        ws.on('open', () => { this.reconnectAttempts = 0; this.emit('system:connected', {}); });
        ws.on('message', data => {
            try {
                const parsed = JSON.parse(data.toString());
                if (parsed && typeof parsed.type === 'string')
                    this.emit('message', parsed);
                else if (typeof parsed?.event === 'string')
                    this.emit(parsed.event, parsed.payload);
            }
            catch {
                this.emit('system:error', { error: 'Invalid server frame' });
            }
        });
        ws.on('error', () => this.emit('system:error', { error: 'Connection failed' }));
        ws.on('close', (code) => {
            if (this.ws === ws)
                this.ws = null;
            if (this.stopped || code === 1008 || this.timer)
                return;
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.emit('system:error', { error: 'Max reconnect attempts reached' });
                return;
            }
            const delay = 1000 * 2 ** this.reconnectAttempts++;
            this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, delay);
        });
    }
    subscribe(event, callback) {
        this.callbacks.set(event, [...(this.callbacks.get(event) ?? []), callback]);
    }
    publish(event, payload) {
        this.send({ event, payload });
    }
    publishMessage(msg) {
        this.send({ message_id: randomUUID(), incident_id: 'GLOBAL_INCIDENT', source: 'UNKNOWN',
            target: 'STANDALONE', type: 'EVENT', permission: [], signature: '', timestamp: Date.now(),
            payload: {}, ...msg });
    }
    send(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            throw new Error('WebSocket is not connected');
        this.ws.send(JSON.stringify(message));
    }
    emit(event, data) {
        this.callbacks.get(event)?.forEach(cb => cb(data));
    }
    disconnect() {
        this.stopped = true;
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = undefined;
        this.ws?.close();
    }
}
//# sourceMappingURL=ws-client.js.map