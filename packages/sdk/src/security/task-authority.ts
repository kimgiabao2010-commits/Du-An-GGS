import { createPublicKey, createPrivateKey, sign, verify, type KeyObject } from 'node:crypto';
import { sha256Canonical } from '../runtime/investigation-loop.js';
import type { TokenPayload } from './token-signer.js';

export interface TaskVerifier { verify(token: string): TokenPayload | null }
export function taskAuthorizationHash(task: { taskId: string; caseId?: string; incidentId?: string; target?: string; action?: string;
  parameters?: Record<string,unknown>; contextRefs?: string[] }): string {
  return sha256Canonical({ taskId: task.taskId, caseId: task.caseId ?? task.incidentId, target: task.target,
    action: task.action, parameters: task.parameters ?? {}, contextRefs: task.contextRefs ?? [] });
}
export class Ed25519TaskVerifier implements TaskVerifier {
  private readonly key: KeyObject;
  constructor(publicKey: string, private readonly keyId: string) {
    this.key = createPublicKey(publicKey);
    if (this.key.asymmetricKeyType !== 'ed25519' || !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId)) throw new Error('Invalid task verification key');
  }
  verify(token: string): (TokenPayload & { taskHash: string }) | null {
    try {
      if (typeof token !== 'string' || token.length>16384) return null;
      const [scheme,keyId,data,signature,extra] = token.split('.');
      if (scheme !== 'gss-ed25519-v1' || keyId !== this.keyId || extra || !/^[A-Za-z0-9_-]+$/.test(data ?? '') || !/^[A-Za-z0-9_-]+$/.test(signature ?? '')) return null;
      if (!verify(null,Buffer.from([scheme,keyId,data].join('.')),this.key,Buffer.from(signature,'base64url'))) return null;
      const claims = JSON.parse(Buffer.from(data,'base64url').toString('utf8'));
      const now = Date.now();
      return claims.role === 'STANDALONE' && typeof claims.agentId === 'string' && Array.isArray(claims.permissions) &&
        claims.permissions.every((v: unknown) => typeof v === 'string') && typeof claims.taskId === 'string' &&
        typeof claims.incidentId === 'string' && /^[a-f0-9]{64}$/.test(claims.taskHash) &&
        Number.isSafeInteger(claims.timestamp) && Number.isSafeInteger(claims.expiresAt) && claims.timestamp<=now+5000 &&
        claims.expiresAt>now && claims.expiresAt>claims.timestamp && claims.expiresAt-claims.timestamp<=60000 ? claims : null;
    } catch { return null; }
  }
}
export function signTaskAuthorization(claims: TokenPayload & { taskHash: string }, privateKey: string, keyId: string): string {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519' || !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId)) throw new Error('Invalid task signing key');
  const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const header = ['gss-ed25519-v1',keyId,data].join('.');
  return header + '.' + sign(null,Buffer.from(header),key).toString('base64url');
}
export function taskVerifierFromEnvironment(): Ed25519TaskVerifier | null {
  const publicKey = process.env.GSS_TASK_PUBLIC_KEY_BASE64;
  if (!publicKey || !process.env.GSS_TASK_KEY_ID) return null;
  return new Ed25519TaskVerifier(Buffer.from(publicKey,'base64').toString('utf8'),process.env.GSS_TASK_KEY_ID);
}
