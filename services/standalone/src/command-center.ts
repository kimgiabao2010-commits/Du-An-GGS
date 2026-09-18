import { randomUUID, createHash } from 'node:crypto';
import { WsCommandServer, TokenSigner } from '@asq/sdk';
import { LlmRouter } from './agent/llm-router.js';

interface Router { routePrompt(prompt: string): Promise<{ agent: string; instruction: string }> }
export class CentralCommandOrchestrator {
    private server: WsCommandServer;
    private signer: TokenSigner;
    private halted = false;
    private planning = 0;
    private pending = new Map<string, { incidentId: string; agent: string; timer: ReturnType<typeof setTimeout> }>();

    constructor(port = 4000, private router: Router = new LlmRouter(), signer = new TokenSigner()) {
        this.signer = signer;
        this.server = new WsCommandServer(port, { signer, allowedOrigin: process.env.ASQ_WEB_ORIGIN });
        this.server.on('message', msg => { void this.handle(msg).catch(() => this.status('ERROR', 'Request failed')); });
    }

    public ready(): Promise<number> { return this.server.ready(); }
    public async close(): Promise<void> {
        for (const task of this.pending.values()) clearTimeout(task.timer);
        this.pending.clear();
        await this.server.close();
    }

    private async handle(msg: any): Promise<void> {
        const { type, payload } = msg;
        if (type === 'RESULT' || type === 'EVIDENCE') {
            const task = this.pending.get(payload.taskId);
            if (!task || task.agent !== msg.agentId || task.incidentId !== msg.incident_id) return;
            clearTimeout(task.timer); this.pending.delete(payload.taskId);
            this.status(payload.status ?? 'FAILED', String(payload.content ?? 'No evidence'), msg.incident_id);
            return;
        }
        if (type !== 'COMMAND' || msg.identity?.role !== 'CISO_Admin' ||
            !msg.identity.permissions.includes('CONTROL')) return;
        if (payload.action === 'trigger_killswitch') {
            this.halted = true;
            this.server.broadcast({ source: 'STANDALONE', target: 'BROADCAST', type: 'COMMAND',
                payload: { action: 'system_halt' } });
            for (const task of this.pending.values()) clearTimeout(task.timer);
            this.pending.clear();
            this.status('HALTED', 'Đã yêu cầu dừng worker và chặn task mới.'); return;
        }
        if (this.halted) { this.status('HALTED', 'Hệ thống đang dừng.'); return; }
        if (payload.action !== 'commander_prompt' || typeof payload.content !== 'string' ||
            payload.content.length > 16000 || !payload.content.trim()) return;
        if (this.pending.size >= 100 || this.planning >= 4) { this.status('BUSY', 'Too many pending tasks'); return; }
        this.planning++;
        let decision: { agent: string; instruction: string };
        try { decision = await this.router.routePrompt(payload.content); }
        finally { this.planning--; }
        // Recheck after the asynchronous model call: halt must also stop in-flight planning.
        if (this.halted) return;
        if (!['cli', 'ide'].includes(decision.agent)) { this.status(decision.agent, decision.instruction); return; }
        const taskId = randomUUID(), incidentId = msg.incident_id;
        const agent = decision.agent === 'cli' ? 'cli-worker-agent' : 'ide-worker-agent';
        const task: any = { taskId, incidentId, instruction: decision.instruction };
        if (decision.agent === 'cli') task.token = this.signer.sign({
            agentId: agent, role: 'STANDALONE', permissions: ['EXECUTE_RECON'], timestamp: Date.now(),
            expiresAt: Date.now() + 60000, taskId, incidentId,
            instructionHash: createHash('sha256').update(decision.instruction).digest('hex')
        });
        const timer = setTimeout(() => {
            this.pending.delete(taskId); this.status('TIMEOUT', 'Worker did not return evidence', incidentId);
        }, 15000);
        this.pending.set(taskId, { incidentId, agent, timer });
        const delivered = this.server.sendToAgent(agent, { source: 'STANDALONE',
            target: decision.agent === 'cli' ? 'CLI_DAEMON' : 'IDE_AGENT', type: 'TASK',
            incident_id: incidentId, payload: task });
        if (!delivered) {
            clearTimeout(timer); this.pending.delete(taskId);
            this.status('OFFLINE', agent + ' chưa kết nối. Task chưa được thực thi.', incidentId);
        } else this.status('DISPATCHED', 'Task ' + taskId + ' đã gửi đến ' + agent, incidentId);
    }

    private status(state: string, message: string, incidentId = 'GLOBAL_INCIDENT'): void {
        this.server.broadcast({ source: 'STANDALONE', target: 'BROADCAST', type: 'STATUS',
            incident_id: incidentId, payload: { action: 'ui_flash', source: state, message } });
    }
}
