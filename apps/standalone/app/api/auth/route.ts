import { NextResponse } from 'next/server';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { TokenSigner } from '@asq/sdk';

export async function POST(request: Request) {
  // Local development bootstrap only. Production requires a reviewed identity provider.
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Production identity provider not configured' }, { status: 503 });
  const password = process.env.ASQ_ADMIN_PASSWORD, username = process.env.ASQ_ADMIN_USERNAME;
  if (!username || !password || password.length < 16 || !process.env.ASQ_JWT_SECRET) {
    return NextResponse.json({ error: 'Local authentication is not configured' }, { status: 503 });
  }
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Origin denied' }, { status: 403 });
  try {
    const body = await request.json();
    const hash = (v: string) => createHash('sha256').update(v).digest();
    if (body.username !== username || typeof body.password !== 'string' ||
        !timingSafeEqual(hash(body.password), hash(password))) return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    const token = new TokenSigner().sign({ agentId: 'web-' + randomUUID(), role: 'CISO_Admin',
      permissions: ['CONTROL'], timestamp: Date.now(), expiresAt: Date.now() + 3600000 });
    const response = NextResponse.json({ success: true });
    response.cookies.set('asq-control-token', token, { httpOnly: true, secure: new URL(request.url).protocol === 'https:',
      sameSite: 'strict', path: '/', maxAge: 3600 });
    return response;
  } catch { return NextResponse.json({ error: 'Invalid login request' }, { status: 400 }); }
}
