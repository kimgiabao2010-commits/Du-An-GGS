import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createRepositorySnapshot } from './repository-snapshot.js';

const execFileAsync = promisify(execFile);
const ALLOWED_COMMANDS = new Set(['git', 'npm', 'semgrep', 'trivy', 'nmap', 'node']);
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
  repositoryRoot?: string;
  requireGvisor?: boolean;
}

/** Fail-closed execution boundary. A mock must never look like verified evidence. */
export class EphemeralSandboxRunner {
  public constructor(private readonly options: SandboxOptions = {}) {}

  public async runInSandbox(command: string, args: string[], signal?: AbortSignal): Promise<SandboxResult> {
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

    const containerName = `gss-sandbox-${randomUUID()}`;
    const image = this.options.image ?? process.env.GSS_SANDBOX_IMAGE ?? '';
    const timeoutMs = this.options.timeoutMs ?? 30000;
    const memory = this.options.memory ?? '512m', cpus = this.options.cpus ?? '1', pids = this.options.pidsLimit ?? 128;
    if (!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(image) || !Number.isSafeInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>120000 ||
      !/^(?:128|256|512|1024)m$/.test(memory) || !['0.5','1','2'].includes(cpus) || !Number.isSafeInteger(pids) || pids<16 || pids>256) {
      return { stdout: '', stderr: 'SANDBOX_BLOCKED: digest-pinned image and bounded limits required.', exitCode: 125, durationMs: Date.now()-startedAt, status: 'BLOCKED' };
    }
    let root: string;
    const gvisor = this.options.requireGvisor ?? process.env.GSS_SANDBOX_REQUIRE_GVISOR === 'true';
    try {
      if (process.platform !== 'linux') throw new Error('Linux staging worker required');
      const info = JSON.parse((await execFileAsync('docker', ['info','--format','{{json .}}'], { timeout: 5000, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true })).stdout);
      if (!Array.isArray(info.SecurityOptions) || !info.SecurityOptions.some((v: string) => v.includes('rootless')) ||
        info.OSType !== 'linux' || !info.CgroupDriver || info.CgroupDriver === 'none' || gvisor && !info.Runtimes?.runsc) throw new Error('Rootless resource isolation unavailable');
      const configured = this.options.repositoryRoot ?? process.env.GSS_SANDBOX_REPOSITORY_ROOT ?? '';
      if (!configured || (await lstat(resolve(configured))).isSymbolicLink()) throw new Error('Repository mount missing or unsafe');
      root = await realpath(resolve(configured));
      if (root.includes(',') || root === resolve(root, '..')) throw new Error('Unsafe repository mount');
      const allowed = (process.env.GSS_SANDBOX_ALLOWED_ROOTS ?? '').split(';').filter(Boolean);
      if (!allowed.length || !(await Promise.all(allowed.map(async v => {
        const base = await realpath(resolve(v)); const rel = relative(base, root);
        return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..'+sep);
      }))).some(Boolean)) throw new Error('Repository mount outside allowlist');
    } catch {
      return { stdout: '', stderr: 'SANDBOX_BLOCKED: verified rootless Linux daemon, resource controls and allowlisted mount required.', exitCode: 125, durationMs: Date.now()-startedAt, status: 'BLOCKED' };
    }
    let snapshot: Awaited<ReturnType<typeof createRepositorySnapshot>>;
    try { snapshot = await createRepositorySnapshot(root); }
    catch { return { stdout:'', stderr:'SANDBOX_BLOCKED: safe source snapshot unavailable.', exitCode:125, durationMs:Date.now()-startedAt, status:'BLOCKED' }; }
    const dockerArgs = [
      'run', '--rm', '--name', containerName,
      '--pull', 'never', '--network', 'none', '--read-only', '--user','10000:10000',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--init',
      '--pids-limit', String(pids), '--memory', memory, '--memory-swap', memory, '--cpus', cpus,
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m', '--tmpfs','/workspace:rw,nosuid,nodev,size=128m,uid=10000,gid=10000',
      '--mount', `type=bind,source=${snapshot.directory},target=/repo,readonly`, '--workdir','/workspace',
      ...(gvisor ? ['--runtime','runsc'] : []),
      image, command, ...args,
    ];
    try {
      const result = await execFileAsync('docker', dockerArgs, {
        timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, signal,
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
    } finally {
      // execFile timeout does not guarantee container termination; remove only our exact generated ID.
      await execFileAsync('docker', ['rm','-f',containerName], { timeout: 5000, maxBuffer: 4096, windowsHide: true }).catch(() => undefined);
      await snapshot.dispose();
    }
  }
}
