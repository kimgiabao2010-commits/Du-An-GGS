import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { ASQMessage } from '../types/index.js';

export class ASQWebSocketClient {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private stopped = false;
    private timer?: ReturnType<typeof setTimeout>;
    private callbacks = new Map<string, ((data: any) => void)[]>();

    constructor(private url: string, private token: string, private maxReconnectAttempts = 5) {}

    public connect(): void {
        this.stopped = false;
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        const ws = new WebSocket(this.url, { headers: { Authorization: 'Bearer ' + this.token }, maxPayload: 65536 });
        this.ws = ws;
        ws.on('open', () => { this.reconnectAttempts = 0; this.emit('system:connected', {}); });
        ws.on('message', data => {
            try {
                const parsed = JSON.parse(data.toString());
                if (parsed && typeof parsed.type === 'string') this.emit('message', parsed);
                else if (typeof parsed?.event === 'string') this.emit(parsed.event, parsed.payload);
            } catch { this.emit('system:error', { error: 'Invalid server frame' }); }
        });
        ws.on('error', () => this.emit('system:error', { error: 'Connection failed' }));
        ws.on('close', (code) => {
            if (this.ws === ws) this.ws = null;
            if (this.stopped || code === 1008 || this.timer) return;
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.emit('system:error', { error: 'Max reconnect attempts reached' }); return;
            }
            const delay = 1000 * 2 ** this.reconnectAttempts++;
            this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, delay);
        });
    }

    public subscribe(event: string, callback: (data: any) => void): void {
        this.callbacks.set(event, [...(this.callbacks.get(event) ?? []), callback]);
    }

    public publish(event: string, payload: any): void {
        this.send({ event, payload });
    }

    public publishMessage(msg: Partial<ASQMessage>): void {
        this.send({ message_id: randomUUID(), incident_id: 'GLOBAL_INCIDENT', source: 'UNKNOWN',
            target: 'STANDALONE', type: 'EVENT', permission: [], signature: '', timestamp: Date.now(),
            payload: {}, ...msg });
    }

    private send(message: unknown): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not connected');
        this.ws.send(JSON.stringify(message));
    }

    private emit(event: string, data: any): void {
        this.callbacks.get(event)?.forEach(cb => cb(data));
    }

    public disconnect(): void {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        this.ws?.close();
    }
}
