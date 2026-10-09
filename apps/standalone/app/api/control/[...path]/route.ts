import { NextRequest, NextResponse } from 'next/server';
import { TokenSigner,serviceFetch } from '@asq/sdk';

export const dynamic = 'force-dynamic';
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (process.env.GSS_RUNTIME_ENV === 'staging') return NextResponse.json({ error: 'Staging SSO browser session not configured' }, { status: 503 });
  const token = request.cookies.get('asq-control-token')?.value;
  let claims;
  try { claims = new TokenSigner().verify(token ?? ''); } catch { claims = null; }
  if (!claims) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const segments = (await context.params).path;
  const path = segments.join('/');
  const readAllowed = ['approvals','audit','workers','runtime-state'].includes(path);
  const writeAllowed = path === 'approvals' || /^approvals\/APR-[a-f0-9]{32}\/decision$/.test(path);
  if (request.method === 'GET' ? !readAllowed : !writeAllowed) return NextResponse.json({ error: 'Route denied' }, { status: 403 });
  if (request.method !== 'GET') {
    if (!['SECURITY_ADMIN','SOC_LEAD','CONTROL_OPERATOR','SOC_ANALYST'].includes(claims.role)) return NextResponse.json({ error: 'Role denied' }, { status: 403 });
    if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Origin denied' }, { status: 403 });
  }
  const authority = process.env.CONTROL_PLANE_URL;
  const gatewayToken = process.env.GSS_UI_GATEWAY_TOKEN;
  if (!authority || !gatewayToken) return NextResponse.json({ error: 'Control Plane gateway is unavailable' }, { status: 503 });
  try {
    let input: string | undefined;
    if (request.method !== 'GET') {
      const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) try {
        while (true) {
          const { done,value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 32000) { await reader.cancel(); return NextResponse.json({ error:'Request too large' },{ status:413 }); }
          chunks.push(value);
        }
      } finally { reader?.releaseLock(); }
      input = Buffer.concat(chunks).toString('utf8');
    }
    const response = await serviceFetch(authority.replace(/\/$/,'') + '/control/v1/' + path, { method: request.method,
      headers: { authorization: 'Bearer '+gatewayToken, 'x-gss-session': token!, 'content-type': 'application/json' },
      body: input, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Control Plane request failed safely' }, { status: 503 }); }
}
export const GET = handle;
export const POST = handle;
