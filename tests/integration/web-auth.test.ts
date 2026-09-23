import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../../apps/standalone/app/api/auth/route.js';

const managedEnvironment = [
  'ASQ_ADMIN_USERNAME',
  'ASQ_ADMIN_PASSWORD',
  'ASQ_INSECURE_LOCAL_DEMO_AUTH',
  'ASQ_JWT_SECRET',
  'ASQ_LOCAL_RUNTIME',
] as const;

describe.sequential('local web authentication', () => {
  const originalEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of managedEnvironment) originalEnvironment.set(name, process.env[name]);
    process.env.ASQ_ADMIN_USERNAME = 'BaoNVG';
    process.env.ASQ_ADMIN_PASSWORD = '1';
    process.env.ASQ_INSECURE_LOCAL_DEMO_AUTH = 'true';
    process.env.ASQ_JWT_SECRET = 'test-signing-secret-that-is-at-least-32-characters';
    process.env.ASQ_LOCAL_RUNTIME = 'true';
  });

  afterEach(() => {
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    originalEnvironment.clear();
  });

  const login = (username: string, password: string, origin = 'http://localhost:3000') => POST(new Request(
    'http://localhost:3000/api/auth',
    { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username, password }) },
  ));

  it('accepts the requested preview credential only in explicit local demo mode', async () => {
    const response = await login('BaoNVG', '1');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get('set-cookie')).toContain('asq-control-token=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=strict');
  });

  it('rejects a wrong password without issuing a cookie', async () => {
    const response = await login('BaoNVG', 'wrong');

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a cross-origin login request', async () => {
    const response = await login('BaoNVG', '1', 'http://attacker.example');

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('accepts either supported loopback hostname as the local origin', async () => {
    const response = await login('BaoNVG', '1', 'http://127.0.0.1:3000');

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('asq-control-token=');
  });

  it('does not allow the one-character password without explicit demo opt-in', async () => {
    process.env.ASQ_INSECURE_LOCAL_DEMO_AUTH = 'false';
    const response = await login('BaoNVG', '1');

    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
