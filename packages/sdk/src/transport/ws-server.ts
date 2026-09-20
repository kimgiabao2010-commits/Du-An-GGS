import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { TokenSigner, type TokenPayload } from '../security/token-signer.js';

export interface CommandServerOptions {
    signer?: TokenSigner;
    host?: string;
    allowedOrigin?: string;
}

export class WsCommandServer extends EventEmitter {
    private wss: WebSocketServer;
    private clients = new Map<string, WebSocket>();
    private signer: TokenSigner;

    constructor(port: number, options: CommandServerOptions = {}) {
        super();
        this.signer = options.signer ?? new TokenSigner();
        this.wss = new WebSocketServer({
            port, host: options.host ?? '127.0.0.1', maxPayload: 65536,
            verifyClient: (info, done) => {
                const origin = info.req.headers.origin;
                const allowedOrigins = (options.allowedOrigin ?? 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001')
                    .split(',').map(value => value.trim()).filter(Boolean);
                if (origin && !allowedOrigins.includes(origin)) {
                    done(false, 403, 'Origin denied'); return;
                }
                const bearer = info.req.headers.authorization?.replace(/^Bearer /, '');
                const cookie = info.req.headers.cookie?.split(';').map(v => v.trim())
                    .find(v => v.startsWith('asq-control-token='))?.slice('asq-control-token='.length);
                const claims = this.signer.verify(bearer ?? cookie ?? '');
                if (!claims || !['CISO_Admin', 'CLI_DAEMON', 'IDE_AGENT', 'SIEM'].includes(claims.role)) {
                    done(false, 401, 'Authentication required'); return;
                }
                (info.req as any).asqIdentity = claims;
                done(true);
            }
        });
        this.wss.on('error', error => this.emit('server:error', error));
        this.wss.on('connection', (ws, request) => {
            const identity = (request as any).asqIdentity as TokenPayload;
            const connectionId = identity.role === 'CISO_Admin' && this.clients.has(identity.agentId)
                ? identity.agentId + ':' + randomUUID() : identity.agentId;
            if (this.clients.has(connectionId)) { ws.close(1008, 'Duplicate identity'); return; }
            this.clients.set(connectionId, ws);
            const expiry = setTimeout(() => ws.close(1008, 'Expired session'), Math.max(1, identity.expiresAt - Date.now()));
            const seen = new Set<string>();
            let windowStart = Date.now(), count = 0;
            ws.on('error', () => {});
            ws.on('message', buffer => {
                if (Date.now() >= identity.expiresAt) { ws.close(1008, 'Expired session'); return; }
                if (Date.now() - windowStart >= 1000) { count = 0; windowStart = Date.now(); }
                if (++count > 50) { ws.close(1008, 'Rate limit'); return; }
                try {
                    const data = JSON.parse(buffer.toString());
                    if (!data || !['COMMAND', 'EVIDENCE', 'RESULT', 'STATUS'].includes(data.type) ||
                        typeof data.message_id !== 'string' || !data.message_id ||
                        typeof data.incident_id !== 'string' || !data.payload || typeof data.payload !== 'object' ||
                        !Number.isSafeInteger(data.timestamp) || Math.abs(Date.now() - data.timestamp) > 60000 ||
                        seen.has(data.message_id)) { ws.close(1008, 'Invalid or replayed message'); return; }
                    if (seen.size >= 10000) { ws.close(1008, 'Session message limit'); return; }
                    seen.add(data.message_id);
                    if (data.payload.action === 'register_agent') {
                        if (data.payload.agentId !== identity.agentId) ws.close(1008, 'Identity mismatch');
                        return;
                    }
                    if (data.type === 'COMMAND' && (identity.role !== 'CISO_Admin' ||
                        !identity.permissions.includes('CONTROL'))) { ws.close(1008, 'Permission denied'); return; }
                    // Trusted identity is written last: frame fields cannot overwrite it.
                    this.emit('message', { ...data, agentId: identity.agentId, source: identity.role, identity });
                } catch { ws.close(1008, 'Malformed message'); }
            });
            ws.on('close', () => {
                clearTimeout(expiry);
                if (this.clients.get(connectionId) === ws) this.clients.delete(connectionId);
            });
        });
    }

    public sendToAgent(agentId: string, payload: any): boolean {
        const ws = this.clients.get(agentId);
        if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1048576) return false;
        ws.send(JSON.stringify(this.envelope(payload)));
        return true;
    }

    public broadcast(payload: any): void {
        for (const id of this.clients.keys()) this.sendToAgent(id, payload);
    }

    private envelope(payload: any) {
        return { message_id: randomUUID(), incident_id: 'GLOBAL_INCIDENT', timestamp: Date.now(),
            permission: [], signature: '', ...payload };
    }

    public async ready(): Promise<number> {
        if (!this.wss.address()) await new Promise<void>((resolve, reject) => {
            this.wss.once('listening', resolve); this.wss.once('error', reject);
        });
        const address = this.wss.address();
        if (!address || typeof address === 'string') throw new Error('Server not listening');
        return address.port;
    }

    public close(): Promise<void> {
        for (const ws of this.clients.values()) ws.terminate();
        return new Promise((resolve, reject) => this.wss.close(err => err ? reject(err) : resolve()));
    }
}
