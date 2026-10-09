import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { ASQMessage } from '../types/index.js';
import { ReliableResultQueue } from './result-queue.js';
import { serviceTlsOptions,validateServiceUrl } from '../security/service-tls.js';

export class ASQWebSocketClient {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private stopped = false;
    private timer?: ReturnType<typeof setTimeout>;
    private callbacks = new Map<string, ((data: any) => void)[]>();
    private resultQueue?: ReliableResultQueue;
    private resultTimer?: ReturnType<typeof setInterval>;
    private lastSent = new Map<string, number>();
    private executionId = randomUUID();
    private taskAcceptances = new Map<string, { caseId: string; resolve: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
    private executingTasks = new Set<string>();
    private heartbeatTimer?:ReturnType<typeof setInterval>;
    private heartbeatSequence=0;
    private heartbeatCommittedAt=0;
    private workerReadiness?:()=> 'READY' | 'BUSY' | 'BLOCKED' | 'HALTED';
    private reliableWorker=false;

    constructor(private url: string, private token: string, private maxReconnectAttempts = 5,
      reliable?: { workerId: string; directory?: string; readiness?:()=> 'READY' | 'BUSY' | 'BLOCKED' | 'HALTED' }) {
      validateServiceUrl(url,true);
      if (reliable) {
        this.resultQueue = new ReliableResultQueue(reliable.workerId, reliable.directory);
        this.reliableWorker=true;this.workerReadiness=reliable.readiness;
      }
    }

    public connect(): void {
        this.stopped = false;
        if (this.resultQueue && !this.resultTimer) {
            this.resultTimer = setInterval(() => this.flushResults(), 1_000); this.resultTimer.unref?.();
        }
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        const tls = this.url.startsWith('wss:') ? serviceTlsOptions() : undefined;
        const ws = new WebSocket(this.url, { ...tls,rejectUnauthorized:true,headers: { Authorization: 'Bearer ' + this.token }, maxPayload: 65536 });
        this.ws = ws;
        ws.on('open', () => {
            if (!this.reliableWorker || (process.env.GSS_REQUIRE_WORKER_PRESENCE!=='true' && process.env.GSS_RUNTIME_ENV!=='staging')) this.reconnectAttempts=0;
            this.lastSent.clear();this.heartbeatCommittedAt=0;
            this.emit('system:connected', {}); this.flushResults();this.sendHeartbeat();
            if(this.reliableWorker) {this.heartbeatTimer=setInterval(()=>this.sendHeartbeat(),5000);this.heartbeatTimer.unref?.();}
        });
        ws.on('message', data => {
            try {
                const parsed = JSON.parse(data.toString());
                if (parsed?.type==='HEARTBEAT_ACK' && parsed.source==='STANDALONE' && parsed.payload?.executionId===this.executionId &&
                    parsed.payload.sequence===this.heartbeatSequence) {
                    if(parsed.payload.committed===true) {this.heartbeatCommittedAt=Date.now();this.reconnectAttempts=0;}
                    else ws.close(4001,'Presence unavailable');
                    return;
                }
                if (parsed?.type === 'TASK_ACCEPTED_ACK' && parsed.source === 'STANDALONE' && parsed.payload?.executionId === this.executionId) {
                    const entry = this.taskAcceptances.get(parsed.payload.taskId);
                    if (entry && entry.caseId === parsed.incident_id) {
                        clearTimeout(entry.timer); this.taskAcceptances.delete(parsed.payload.taskId);
                        if (parsed.payload.accepted === true) this.executingTasks.add(parsed.payload.taskId);
                        entry.resolve(parsed.payload.accepted === true);
                    }
                    return;
                }
                if (parsed?.type === 'RESULT_ACK' && parsed.source === 'STANDALONE' && parsed.payload?.committed === true) {
                    if (this.resultQueue?.acknowledge(parsed.payload.deliveryId, parsed.incident_id, parsed.payload.taskId)) {
                        this.lastSent.delete(parsed.payload.deliveryId);
                    }
                    return;
                }
                if (parsed && typeof parsed.type === 'string') this.emit('message', parsed);
                else if (typeof parsed?.event === 'string') this.emit(parsed.event, parsed.payload);
            } catch { this.emit('system:error', { error: 'Invalid server frame' }); }
        });
        ws.on('error', () => this.emit('system:error', { error: 'Connection failed' }));
        ws.on('close', (code) => {
            if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
            this.heartbeatTimer=undefined;this.heartbeatCommittedAt=0;
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

    public publishResult(caseId: string, payload: Record<string, unknown>): void {
        if (!this.resultQueue) throw new Error('Reliable result queue is not configured');
        if (Buffer.byteLength(JSON.stringify(payload)) > 48_000) {
            payload = { taskId: payload.taskId, status: 'FAILED',
                output: 'Worker result exceeded bounded transport payload; evidence was not accepted.',
                failure: { code: 'RESULT_OUTPUT_LIMIT', message: 'Transport payload limit exceeded' }, truncated: true };
        }
        this.resultQueue.enqueue(caseId, payload); this.executingTasks.delete(String(payload.taskId)); this.flushResults();
    }
    /** Authority must durably accept this execution session before any physical execution. */
    public async acceptTask(caseId: string, taskId: string): Promise<boolean> {
        if(this.reliableWorker && (process.env.GSS_REQUIRE_WORKER_PRESENCE==='true' || process.env.GSS_RUNTIME_ENV==='staging')) {
            const deadline=Date.now()+5000;
            while(!this.heartbeatCommittedAt && !this.stopped && this.ws?.readyState===WebSocket.OPEN && Date.now()<deadline) {
                await new Promise(resolve=>setTimeout(resolve,25));
            }
            if(!this.heartbeatCommittedAt || Date.now()-this.heartbeatCommittedAt>=15000) return false;
        }
        if (this.executingTasks.has(taskId) || this.taskAcceptances.has(taskId) || this.hasPendingResult(taskId)) return false;
        return new Promise(resolve => {
            const timer = setTimeout(() => { this.taskAcceptances.delete(taskId); resolve(false); }, 5000);
            this.taskAcceptances.set(taskId, { caseId, resolve, timer });
            try { this.publishMessage({ type: 'TASK_ACCEPTED', incident_id: caseId, payload: { taskId, executionId: this.executionId } }); }
            catch { clearTimeout(timer); this.taskAcceptances.delete(taskId); resolve(false); }
        });
    }
    public hasPendingResult(taskId: string): boolean {
        const pending = Boolean(this.resultQueue?.forTask(taskId));
        if (pending) this.flushResults(); return pending;
    }
    private flushResults(): void {
        if (this.stopped || this.ws?.readyState !== WebSocket.OPEN) return;
        let sent = 0;
        for (const record of this.resultQueue?.pending() ?? []) {
            if (sent >= 10 || Date.now() - (this.lastSent.get(record.deliveryId) ?? 0) < 2_000) continue;
            try {
                this.publishMessage({ type: 'RESULT', incident_id: record.caseId,
                    payload: { ...record.payload, deliveryId: record.deliveryId } });
                this.lastSent.set(record.deliveryId, Date.now()); sent++;
            } catch { break; } // The journal is retained until a commit ACK, including on reconnect exhaustion.
        }
    }

    private send(message: unknown): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not connected');
        this.ws.send(JSON.stringify(message));
    }
    private sendHeartbeat():void {
        if(!this.reliableWorker || this.stopped || this.ws?.readyState!==WebSocket.OPEN) return;
        try {this.publishMessage({type:'HEARTBEAT',payload:{executionId:this.executionId,sequence:++this.heartbeatSequence,
            readiness:this.workerReadiness?.() ?? 'READY'}});}catch{ /* No lease is claimed without a committed ACK. */ }
    }

    private emit(event: string, data: any): void {
        this.callbacks.get(event)?.forEach(cb => cb(data));
    }

    public disconnect(): void {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        if (this.resultTimer) clearInterval(this.resultTimer);
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer=undefined;this.heartbeatCommittedAt=0;
        this.resultTimer = undefined;
        this.timer = undefined;
        for (const item of this.taskAcceptances.values()) { clearTimeout(item.timer); item.resolve(false); }
        this.taskAcceptances.clear();
        this.ws?.close();
    }
}
