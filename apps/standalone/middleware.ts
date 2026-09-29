import { NextRequest, NextResponse } from 'next/server';

type SessionClaims = { role?: string; permissions?: unknown; expiresAt?: number };

const standaloneRoles = new Set(['SOC_ANALYST', 'SOC_LEAD', 'CONTROL_OPERATOR', 'SECURITY_ADMIN']);
const controlRoles = new Set(['CONTROL_OPERATOR', 'SECURITY_ADMIN', 'AUDITOR']);

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(bytes, character => character.charCodeAt(0)).buffer as ArrayBuffer;
}

async function session(request: NextRequest): Promise<SessionClaims | null> {
  const secret = process.env.ASQ_JWT_SECRET;
  const token = request.cookies.get('asq-control-token')?.value;
  if (!secret || secret.length < 32 || !token || token.length > 16_384) return null;
  const [data, signature, extra] = token.split('.');
  if (!data || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(data) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, decodeBase64Url(signature), new TextEncoder().encode(data));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(data))) as SessionClaims;
    return Number.isSafeInteger(claims.expiresAt) && claims.expiresAt! > Date.now() ? claims : null;
  } catch { return null; }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const claims = await session(request);
  if (pathname === '/') return NextResponse.redirect(new URL(claims ? '/standalone' : '/login', request.url));
  if (pathname === '/login' && claims) return NextResponse.redirect(new URL('/standalone', request.url));
  if (pathname.startsWith('/standalone') || pathname.startsWith('/control')) {
    if (!claims) {
      const login = new URL('/login', request.url); login.searchParams.set('next', pathname);
      return NextResponse.redirect(login);
    }
    const allowed = pathname.startsWith('/control') ? controlRoles : standaloneRoles;
    if (!claims.role || !allowed.has(claims.role)) return new NextResponse('Forbidden', { status: 403 });
    return NextResponse.next();
  }
  return NextResponse.next();
}

export const config = { matcher: ['/', '/login', '/standalone/:path*', '/control/:path*'] };
