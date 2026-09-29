import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenSigner } from '../../packages/sdk/src/security/token-signer.ts';
import { proxy } from '../../apps/standalone/proxy.ts';

const secret = 'ui-boundary-signing-secret-at-least-32-characters';
const originalSecret = process.env.ASQ_JWT_SECRET;

function request(path: string, role?: string) {
  let token: string | undefined;
  if (role) {
    const now = Date.now();
    token = new TokenSigner(secret).sign({ agentId: `test-${role}`, role, permissions: ['CONTROL'],
      timestamp: now, expiresAt: now + 60_000 });
  }
  return {
    url: `http://localhost:3000${path}`,
    nextUrl: new URL(`http://localhost:3000${path}`),
    cookies: { get: (name: string) => name === 'asq-control-token' && token ? { value: token } : undefined },
  } as Parameters<typeof proxy>[0];
}

beforeAll(() => { process.env.ASQ_JWT_SECRET = secret; });
afterAll(() => {
  if (originalSecret === undefined) delete process.env.ASQ_JWT_SECRET;
  else process.env.ASQ_JWT_SECRET = originalSecret;
});

describe('server-side Standalone and Control Plane boundary', () => {
  it('redirects anonymous users to login without rendering protected content', async () => {
    const response = await proxy(request('/control/executions'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login?next=%2Fcontrol%2Fexecutions');
  });

  it('allows analysts into Standalone but denies Control Plane', async () => {
    const standalone = await proxy(request('/standalone/tasks', 'SOC_ANALYST'));
    expect(standalone.status).toBe(200);
    const control = await proxy(request('/control/executions', 'SOC_ANALYST'));
    expect(control.status).toBe(403);
  });

  it('allows a security administrator into both protected workspaces', async () => {
    const standalone = await proxy(request('/standalone', 'SECURITY_ADMIN'));
    expect(standalone.status).toBe(200);
    const control = await proxy(request('/control/executions/EXE-8421', 'SECURITY_ADMIN'));
    expect(control.status).toBe(200);
  });
});
