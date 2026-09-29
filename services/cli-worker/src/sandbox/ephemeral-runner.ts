import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execFileAsync = promisify(execFile);
const ALLOWED_COMMANDS = new Set(['git', 'npm', 'semgrep', 'trivy', 'nmap']);
const MAX_OUTPUT_BYTES = 64 * 1024;

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  status: 'COMPLETED' | 'BLOCKED' | 'FAILED';
  artifactHash?: string;
}

export interface SandboxOptions {
  image?: string;
  timeoutMs?: number;
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
}

/** Fail-closed execution boundary. A mock must never look like verified evidence. */
export class EphemeralSandboxRunner {
  public constructor(private readonly options: SandboxOptions = {}) {}

  public async runInSandbox(command: string, args: string[]): Promise<SandboxResult> {
    const startedAt = Date.now();
    if (process.env.GSS_SANDBOX_MODE !== 'docker') {
      return { stdout: '', stderr: 'SANDBOX_BLOCKED: Docker staging mode is not enabled.', exitCode: 125,
        durationMs: Date.now() - startedAt, status: 'BLOCKED' };
    }
    if (!ALLOWED_COMMANDS.has(command)) {
      return { stdout: '', stderr: `SANDBOX_BLOCKED: command is not allowlisted: ${command}`, exitCode: 126,
        durationMs: Date.now() - startedAt, status: 'BLOCKED' };
    }
    if (args.some(arg => typeof arg !== 'string' || arg.length > 2_000 || arg.includes('\0'))) {
      return { stdout: '', stderr: 'SANDBOX_BLOCKED: invalid argument.', exitCode: 126,
        durationMs: Date.now() - startedAt, status: 'BLOCKED' };
    }

    const containerName = `gss-sandbox-${createHash('sha256').update(`${Date.now()}:${command}:${args.join('\0')}`).digest('hex').slice(0, 16)}`;
    const image = this.options.image ?? process.env.GSS_SANDBOX_IMAGE ?? 'gss/sandbox:staging';
    const dockerArgs = [
      'run', '--rm', '--name', containerName,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', String(this.options.pidsLimit ?? 128), '--memory', this.options.memory ?? '512m',
      '--cpus', this.options.cpus ?? '1', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      image, command, ...args,
    ];
    try {
      const result = await execFileAsync('docker', dockerArgs, {
        timeout: this.options.timeoutMs ?? 30_000, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true,
      });
      const stdout = String(result.stdout).slice(0, MAX_OUTPUT_BYTES);
      const stderr = String(result.stderr).slice(0, MAX_OUTPUT_BYTES);
      return { stdout, stderr, exitCode: 0, durationMs: Date.now() - startedAt, status: 'COMPLETED',
        artifactHash: createHash('sha256').update(stdout).digest('hex') };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };
      const timedOut = failure.killed === true;
      return { stdout: String(failure.stdout ?? '').slice(0, MAX_OUTPUT_BYTES),
        stderr: String(failure.stderr ?? (timedOut ? 'SANDBOX_FAILED: timeout.' : 'SANDBOX_FAILED: container execution failed.')).slice(0, MAX_OUTPUT_BYTES),
        exitCode: typeof failure.code === 'number' ? failure.code : 1, durationMs: Date.now() - startedAt,
        status: 'FAILED' };
    }
  }
}
