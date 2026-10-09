import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { TokenSigner, type TokenPayload } from '../security/token-signer.js';
import { createServer as createSecureServer,type Server } from 'node:https';
import { serviceTlsOptions } from '../security/service-tls.js';
import { WorkloadPeerPolicy,assertWorkerWorkload,type WorkloadIdentity } from '../security/workload-policy.js';

export interface CommandServerOptions {
    signer?: TokenSigner;
    host?: string;
    allowedOrigin?: string;
    peerAuthorizer?: (peer:WorkloadIdentity)=>Promise<void>;
}

export class WsCommandServer extends EventEmitter {
    private wss: WebSocketServer;
    private clients = new Map<string, WebSocket>();
    private connections = new Map<string, WebSocket>();
    private signer: TokenSigner;
    private secureServer?: Server;
    private validators=new WeakMap<WebSocket,()=>boolean>();
    private authorizers=new WeakMap<WebSocket,()=>Promise<boolean>>();
    private durableBinding=false;

    constructor(port: number, options: CommandServerOptions = {}) {
        super();
        this.signer = options.signer ?? new TokenSigner();
        const tls = serviceTlsOptions();
        const peerPolicy=new WorkloadPeerPolicy();
        if(peerPolicy.enabled && !tls)throw new Error('Workload binding requires mTLS');
        const requireDurable=process.env.GSS_RUNTIME_ENV==='staging' || process.env.GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION==='true';
        if(requireDurable && (!peerPolicy.enabled || !options.peerAuthorizer))throw new Error('Durable workload revocation authority required');
        this.durableBinding=peerPolicy.enabled && Boolean(options.peerAuthorizer);
        const authorizePeer=async(peer:WorkloadIdentity)=>{
            if(!options.peerAuthorizer)return;
            let timer:ReturnType<typeof setTimeout>|undefined;
            try {await Promise.race([options.peerAuthorizer(peer),new Promise<never>((_,reject)=>{
                timer=setTimeout(()=>reject(new Error('Workload authority timeout')),3000);timer.unref?.();
            })]);}finally{if(timer)clearTimeout(timer);}
        };
        let pendingAuthorizations=0;
        if (!tls && !['localhost','127.0.0.1','::1'].includes(options.host ?? '127.0.0.1')) throw new Error('Plaintext server must remain loopback');
        if (tls) {
            this.secureServer = createSecureServer({...tls,requestCert:true,rejectUnauthorized:true,handshakeTimeout:5000});
            this.secureServer.maxConnections=200;
            this.secureServer.on('error',error=>this.emit('server:error',error));
        }
        this.wss = new WebSocketServer({
            ...(this.secureServer ? { server:this.secureServer } : { port,host:options.host ?? '127.0.0.1' }),maxPayload:65536,
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
                if (!claims || !['CISO_Admin', 'SECURITY_ADMIN', 'CLI_DAEMON', 'IDE_AGENT', 'SIEM'].includes(claims.role)) {
                    done(false, 401, 'Authentication required'); return;
                }
                if(pendingAuthorizations>=64){done(false,503,'Authorization capacity');return;}
                pendingAuthorizations++;
                void (async()=>{
                    try {
                        const peer=peerPolicy.authenticate(info.req.socket);
                        if(peer){assertWorkerWorkload(peer,claims);await authorizePeer(peer);}
                        (info.req as any).asqIdentity = claims;done(true);
                    }catch{done(false,403,'Workload identity denied');}
                    finally{pendingAuthorizations--;}
                })();
            }
        });
        this.wss.on('error', error => this.emit('server:error', error));
        this.secureServer?.listen(port,options.host ?? '127.0.0.1');
        this.wss.on('connection', (ws, request) => {
            const identity = (request as any).asqIdentity as TokenPayload;
            const clientKey = ['CISO_Admin', 'SECURITY_ADMIN'].includes(identity.role) && this.clients.has(identity.agentId)
                ? identity.agentId + ':' + randomUUID() : identity.agentId;
            if (this.clients.has(clientKey) || this.clients.size>=100) { ws.close(1008, 'Duplicate identity or capacity'); return; }
            const connectionId=randomUUID();
            this.clients.set(clientKey, ws);
            this.connections.set(connectionId,ws);
            const validate=()=>{
                if(Date.now()>=identity.expiresAt){ws.close(1008,'Expired session');return false;}
                try {const peer=peerPolicy.authenticate(request.socket);if(peer)assertWorkerWorkload(peer,identity);return true;}
                catch{ws.close(1008,'Workload identity denied');return false;}
            };
            this.validators.set(ws,validate);
            const authorize=async()=>{
                if(!validate() || ws.readyState!==WebSocket.OPEN)return false;
                try {
                    const peer=peerPolicy.authenticate(request.socket);if(peer)await authorizePeer(peer);
                    return validate() && ws.readyState===WebSocket.OPEN;
                }catch{ws.close(1008,'Workload authority denied or unavailable');return false;}
            };
            this.authorizers.set(ws,authorize);
            let timerChecking=false;
            const peerTimer=peerPolicy.enabled?setInterval(()=>{
                if(timerChecking)return;timerChecking=true;void authorize().finally(()=>{timerChecking=false;});
            },2000):undefined;peerTimer?.unref?.();
            const expiry = setTimeout(() => ws.close(1008, 'Expired session'), Math.max(1, identity.expiresAt - Date.now()));
            const seen = new Set<string>();
            let windowStart = Date.now(), count = 0;
            let queued=0,frameChain=Promise.resolve();
            ws.on('error', () => {});
            ws.on('message', buffer => {
                if (Date.now() - windowStart >= 1000) { count = 0; windowStart = Date.now(); }
                if (++count > 50) { ws.close(1008, 'Rate limit'); return; }
                if(queued>=8){ws.close(1008,'Authorization backlog limit');return;}
                queued++;
                frameChain=frameChain.then(async()=>{
                if(!await authorize())return;
                try {
                    const data = JSON.parse(buffer.toString());
                    if (!data || !['COMMAND', 'EVIDENCE', 'RESULT', 'STATUS', 'TASK_ACCEPTED','HEARTBEAT'].includes(data.type) ||
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
                    if (data.type === 'COMMAND' && (!['CISO_Admin', 'SECURITY_ADMIN'].includes(identity.role) ||
                        !identity.permissions.includes('CONTROL'))) { ws.close(1008, 'Permission denied'); return; }
                    // Trusted identity is written last: frame fields cannot overwrite it.
                    this.emit('message', { ...data, agentId: identity.agentId, source: identity.role, identity, connectionId });
                } catch { ws.close(1008, 'Malformed message'); }
                }).catch(()=>{ws.close(1008,'Workload authority denied');}).finally(()=>{queued--;});
            });
            ws.on('close', () => {
                clearTimeout(expiry);
                if(peerTimer)clearInterval(peerTimer);
                if (this.clients.get(clientKey) === ws) this.clients.delete(clientKey);
                this.connections.delete(connectionId);
                this.emit('worker:disconnected',{agentId:identity.agentId,identity,connectionId});
            });
            this.emit('worker:connected',{agentId:identity.agentId,identity,connectionId});
        });
    }

    public sendToAgent(agentId: string, payload: any): boolean {
        if(this.durableBinding)return false; // Sync callers must not bypass the authority round trip.
        const ws = this.clients.get(agentId);
        if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1048576 || !this.validators.get(ws)?.()) return false;
        ws.send(JSON.stringify(this.envelope(payload)));
        return true;
    }
    public sendToConnection(connectionId:string,payload:unknown):boolean {
        if(this.durableBinding)return false;
        const ws=this.connections.get(connectionId);
        if(!ws || ws.readyState!==WebSocket.OPEN || ws.bufferedAmount>1048576 || !this.validators.get(ws)?.()) return false;
        ws.send(JSON.stringify(this.envelope(payload)));return true;
    }

    public broadcast(payload: any): void {
        for (const id of this.clients.keys()) this.sendToAgent(id, payload);
    }
    public async sendToAgentAuthorized(agentId:string,payload:unknown):Promise<boolean> {
        return this.sendAuthorized(this.clients.get(agentId),payload);
    }
    public async sendToConnectionAuthorized(connectionId:string,payload:unknown):Promise<boolean> {
        return this.sendAuthorized(this.connections.get(connectionId),payload);
    }
    private async sendAuthorized(ws:WebSocket|undefined,payload:unknown):Promise<boolean> {
        if(!ws || ws.readyState!==WebSocket.OPEN || ws.bufferedAmount>1048576 || !await this.authorizers.get(ws)?.())return false;
        if(ws.readyState!==WebSocket.OPEN || ws.bufferedAmount>1048576)return false;
        ws.send(JSON.stringify(this.envelope(payload)));return true;
    }
    public async broadcastAuthorized(payload:unknown):Promise<void> {
        await Promise.all([...this.clients.keys()].map(id=>this.sendToAgentAuthorized(id,payload)));
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
        return new Promise((resolve, reject) => this.wss.close(err => {
            if (err) { reject(err); return; }
            if (this.secureServer) this.secureServer.close(error=>error ? reject(error) : resolve()); else resolve();
        }));
    }
}
