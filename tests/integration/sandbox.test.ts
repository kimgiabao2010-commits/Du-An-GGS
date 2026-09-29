import { afterEach, describe, expect, it, vi } from 'vitest';
import { EphemeralSandboxRunner } from '../../services/cli-worker/src/sandbox/ephemeral-runner.ts';

describe('sandbox boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fails closed and never reports mock success when Docker mode is absent', async () => {
    vi.stubEnv('GSS_SANDBOX_MODE', 'blocked');
    const result = await new EphemeralSandboxRunner().runInSandbox('hostname', []);
    expect(result.status).toBe('BLOCKED');
    expect(result.exitCode).toBe(125);
    expect(result.stdout).toBe('');
  });

  it('rejects commands outside the sandbox allowlist before invoking Docker', async () => {
    vi.stubEnv('GSS_SANDBOX_MODE', 'docker');
    const result = await new EphemeralSandboxRunner({ image: 'test/image' }).runInSandbox('powershell', []);
    expect(result.status).toBe('BLOCKED');
    expect(result.stderr).toContain('not allowlisted');
  });
});
