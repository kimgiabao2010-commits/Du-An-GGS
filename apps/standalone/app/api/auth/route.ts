import { NextResponse } from 'next/server';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { TokenSigner } from '@asq/sdk';

export async function POST(request: Request) {
  // The local launcher uses a production build to avoid Windows HMR file-lock failures.
  // Real production still requires a reviewed identity provider.
  const requestUrl = new URL(request.url);
  const loopbackHosts = ['localhost', '127.0.0.1', '::1'];
  const loopback = loopbackHosts.includes(requestUrl.hostname);
  const localRuntime = process.env.ASQ_LOCAL_RUNTIME === 'true' && loopback;
  const insecureLocalDemo = localRuntime && process.env.ASQ_INSECURE_LOCAL_DEMO_AUTH === 'true';
  if (process.env.NODE_ENV === 'production' && !localRuntime)
    return NextResponse.json({ error: 'Production identity provider not configured' }, { status: 503 });
  const password = process.env.ASQ_ADMIN_PASSWORD, username = process.env.ASQ_ADMIN_USERNAME;
  const minimumPasswordLength = insecureLocalDemo ? 1 : 16;
  if (!username || !password || password.length < minimumPasswordLength ||
      !process.env.ASQ_JWT_SECRET || process.env.ASQ_JWT_SECRET.length < 32) {
    return NextResponse.json({ error: 'Local authentication is not configured' }, { status: 503 });
  }
  let allowedOrigin = false;
  try {
    const origin = new URL(request.headers.get('origin') ?? '');
    allowedOrigin = origin.protocol === requestUrl.protocol && origin.port === requestUrl.port &&
      (origin.hostname === requestUrl.hostname || (loopback && loopbackHosts.includes(origin.hostname)));
  } catch { /* Missing and malformed origins are denied. */ }
  if (!allowedOrigin) return NextResponse.json({ error: 'Origin denied' }, { status: 403 });
  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    const hash = (v: string) => createHash('sha256').update(v).digest();
    if (body.username !== username || typeof body.password !== 'string' ||
        !timingSafeEqual(hash(body.password), hash(password))) return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    const token = new TokenSigner().sign({ agentId: 'web-' + randomUUID(), role: 'CISO_Admin',
      permissions: ['CONTROL'], timestamp: Date.now(), expiresAt: Date.now() + 3600000 });
    const response = NextResponse.json({ success: true });
    response.cookies.set('asq-control-token', token, { httpOnly: true, secure: requestUrl.protocol === 'https:',
      sameSite: 'strict', path: '/', maxAge: 3600 });
    return response;
  } catch { return NextResponse.json({ error: 'Invalid login request' }, { status: 400 }); }
}
