import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';

export type OperatorRole = 'SOC_ANALYST' | 'SOC_LEAD' | 'CONTROL_OPERATOR' | 'SECURITY_ADMIN' | 'AUDITOR';
export interface OperatorIdentity { issuer: string; subject: string; role: OperatorRole; issuedAt: number }
const roles = new Set(['SOC_ANALYST','SOC_LEAD','CONTROL_OPERATOR','SECURITY_ADMIN','AUDITOR']);
const deny = (message: string, statusCode = 403) => Object.assign(new Error(message), { statusCode });
export function authorizeOperator(identity: OperatorIdentity, method: string, path: string): void {
  const read = method === 'GET';
  if(path==='/control/v1/workload-certificates/check')throw deny('service_authority_required');
  if(path==='/control/v1/workload-certificates/revocations' &&
    (read?!['SECURITY_ADMIN','AUDITOR'].includes(identity.role):identity.role!=='SECURITY_ADMIN'))throw deny('role_denied');
  if (!read && (/^\/control\/v1\/(?:results|workers|worker-deliveries|outbox|artifacts|model-usage|model-reservations)(?:\/|$)/.test(path) ||
    /^\/control\/v1\/tasks\/(?:accept|authorize|[^/]+\/status)$/.test(path) || /^\/control\/v1\/intakes\//.test(path))) throw deny('service_authority_required');
  if (identity.role === 'SECURITY_ADMIN') return;
  if (read) {
    if (/\/(audit|workers|runtime-state)$/.test(path) && !['AUDITOR','CONTROL_OPERATOR','SOC_LEAD'].includes(identity.role)) throw deny('role_denied');
    return;
  }
  if (/\/approvals\/[^/]+\/decision$/.test(path) && identity.role === 'SOC_LEAD') return;
  if (path === '/control/v1/approvals' && ['SOC_ANALYST','SOC_LEAD','CONTROL_OPERATOR'].includes(identity.role)) return;
  if (path === '/control/v1/intakes' && ['SOC_ANALYST','SOC_LEAD','CONTROL_OPERATOR'].includes(identity.role)) return;
  if (path === '/control/v1/cases' && ['SOC_ANALYST','SOC_LEAD'].includes(identity.role)) return;
  throw deny('role_denied');
}
export class OidcAuthority {
  private readonly keys;
  private readonly issuer: string;
  private readonly audience: string;
  constructor(private readonly pool: Pool) {
    this.issuer = process.env.GSS_OIDC_ISSUER ?? '';
    this.audience = process.env.GSS_OIDC_AUDIENCE ?? '';
    const jwks = new URL(process.env.GSS_OIDC_JWKS_URI ?? '');
    const issuerUrl = new URL(this.issuer);
    if (!this.audience || jwks.protocol !== 'https:' || issuerUrl.protocol !== 'https:' || jwks.username || jwks.password ||
      issuerUrl.username || issuerUrl.password || jwks.hash || jwks.search) throw new Error('OIDC issuer/JWKS HTTPS and audience required');
    this.keys = createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30000 });
  }
  async authenticate(request: IncomingMessage): Promise<OperatorIdentity> {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    if (!token || token.length > 16384) throw deny('unauthorized', 401);
    let claims;
    try { claims = (await jwtVerify(token, this.keys, { issuer: this.issuer, audience: this.audience,
      algorithms: ['RS256','ES256','EdDSA'], requiredClaims: ['exp','iat','sub'], maxTokenAge: '1h', clockTolerance: 5 })).payload; }
    catch { throw deny('invalid_identity', 401); }
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256 || typeof claims.iat !== 'number' ||
      !roles.has(String(claims.gss_role))) throw deny('identity_role_denied');
    const amr = claims.amr;
    // OTP or a hardware key alone is still one factor. Accept an explicit IdP MFA
    // assertion or password plus a possession factor; never infer MFA from one method.
    if (!Array.isArray(amr) || !(amr.includes('mfa') || amr.includes('pwd') && (amr.includes('otp') || amr.includes('hwk')))) throw deny('mfa_required');
    const identity: OperatorIdentity = { issuer: this.issuer, subject: claims.sub, role: claims.gss_role as OperatorRole, issuedAt: claims.iat };
    const row = (await this.pool.query('SELECT revoked_before FROM identity_revocations WHERE issuer=$1 AND subject=$2', [identity.issuer, identity.subject])).rows[0];
    if (row && identity.issuedAt * 1000 <= new Date(row.revoked_before).getTime()) throw deny('session_revoked', 401);
    return identity;
  }
  async authorize(identity: OperatorIdentity, method: string, path: string): Promise<void> {
    authorizeOperator(identity, method, path);
  }
  async caseAccess(identity: OperatorIdentity, caseId: string): Promise<void> {
    if (identity.role === 'SECURITY_ADMIN') return;
    const found = await this.pool.query('SELECT 1 FROM case_access WHERE case_id=$1 AND issuer=$2 AND subject=$3', [caseId, identity.issuer, identity.subject]);
    if (!found.rows[0]) throw deny('incident_access_denied');
  }
}
