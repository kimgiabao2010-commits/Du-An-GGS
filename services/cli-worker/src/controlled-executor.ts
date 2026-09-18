import { execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { TokenSigner } from '@asq/sdk';

export const instructionHash = (instruction: string) => createHash('sha256').update(instruction).digest('hex');
export interface HostTask { taskId: string; incidentId: string; instruction: string; token: string }
export interface HostResult { taskId: string; status: 'SUCCESS' | 'FAILED' | 'DENIED' | 'CANCELLED'; output: string }
export type HostRunner = (file: string, args: string[], signal: AbortSignal) => Promise<string>;

export function parseReadOnlyCommand(instruction: string): { file: string; args: string[] } | null {
    const exact: Record<string, string[]> = {
        hostname: [], systeminfo: [], ipconfig: [], 'ipconfig /all': ['/all'],
        netstat: [], 'netstat -ano': ['-ano']
    };
    if (!Object.hasOwn(exact, instruction)) return null;
    const command = instruction.split(' ')[0];
    if (process.platform !== 'win32') {
        return command === 'hostname' ? { file: '/bin/hostname', args: [] } : null;
    }
    return { file: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', command + '.exe'), args: exact[instruction] };
}

export const runHostCommand: HostRunner = (file, args, signal) => new Promise((resolve, reject) => {
    execFile(file, args, { shell: false, windowsHide: true, timeout: 10000,
        maxBuffer: 65536, signal, encoding: 'utf8' }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.slice(0, 16384));
    });
});

export class ControlledExecutor {
    private used = new Map<string, number>();
    private active = new Set<AbortController>();
    private halted = false;

    constructor(private signer: TokenSigner, private runner: HostRunner = runHostCommand) {}

    public halt(): void {
        this.halted = true;
        for (const controller of this.active) controller.abort();
    }

    public async execute(task: HostTask): Promise<HostResult> {
        const result = (status: HostResult['status'], output: string) => ({ taskId: task?.taskId ?? '', status, output });
        if (this.halted) return result('DENIED', 'Worker halted');
        if (!task || typeof task.instruction !== 'string' || !task.taskId || !task.incidentId)
            return result('DENIED', 'Invalid task');
        const claims = this.signer.verify(task.token);
        if (!claims || claims.role !== 'STANDALONE' || claims.agentId !== 'cli-worker-agent' ||
            !claims.permissions.includes('EXECUTE_RECON') || claims.taskId !== task.taskId ||
            claims.incidentId !== task.incidentId || claims.instructionHash !== instructionHash(task.instruction))
            return result('DENIED', 'Invalid or mismatched task authorization');
        for (const [id, expiry] of this.used) if (expiry <= Date.now()) this.used.delete(id);
        if (this.used.has(task.taskId) || this.used.size >= 10000) return result('DENIED', 'Replayed task or capacity limit');
        const command = parseReadOnlyCommand(task.instruction);
        if (!command) return result('DENIED', 'Command not in exact read-only allowlist');
        if (this.active.size >= 2) return result('DENIED', 'Worker busy');
        this.used.set(task.taskId, claims.expiresAt);
        const controller = new AbortController();
        this.active.add(controller);
        try {
            const output = await this.runner(command.file, command.args, controller.signal);
            return controller.signal.aborted ? result('CANCELLED', 'Execution cancelled') : result('SUCCESS', output);
        } catch {
            return result(controller.signal.aborted ? 'CANCELLED' : 'FAILED', 'Execution failed, timed out or was cancelled');
        } finally { this.active.delete(controller); }
    }
}
