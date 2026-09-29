import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalJson } from '../runtime/investigation-loop.js';

export interface ArtifactSignaturePayload {
  artifactHash: string;
  caseId: string;
  taskId: string;
  keyId: string;
  createdAt: string;
}

export interface ArtifactSignature {
  algorithm: 'EdDSA';
  keyId: string;
  artifactHash: string;
  compactJws: string;
}

function encode(value: string): string { return Buffer.from(value, 'utf8').toString('base64url'); }
function decode(value: string): string { return Buffer.from(value, 'base64url').toString('utf8'); }

function key(value: string | KeyObject, type: 'private' | 'public'): KeyObject {
  if (typeof value !== 'string') return value;
  return type === 'private' ? createPrivateKey(value) : createPublicKey(value);
}

/** Signs the canonical artifact binding. Keep the private key in Control Plane only. */
export function signArtifact(payload: ArtifactSignaturePayload, privateKey: string | KeyObject): ArtifactSignature {
  if (!/^[a-f0-9]{64}$/i.test(payload.artifactHash)) throw new Error('artifactHash must be SHA-256');
  const header = encode(JSON.stringify({ alg: 'EdDSA', kid: payload.keyId, typ: 'artifact+jws' }));
  const body = encode(canonicalJson(payload));
  const signingInput = `${header}.${body}`;
  const signature = sign(null, Buffer.from(signingInput), key(privateKey, 'private')).toString('base64url');
  return { algorithm: 'EdDSA', keyId: payload.keyId, artifactHash: payload.artifactHash.toLowerCase(), compactJws: `${signingInput}.${signature}` };
}

/** Verifies a signature with a public key; workers do not need the Control Plane private key. */
export function verifyArtifactSignature(compactJws: string, publicKey: string | KeyObject, expected?: Partial<ArtifactSignaturePayload>): ArtifactSignaturePayload | null {
  try {
    const [headerPart, bodyPart, signaturePart] = compactJws.split('.');
    if (!headerPart || !bodyPart || !signaturePart) return null;
    const header = JSON.parse(decode(headerPart)) as { alg?: string; kid?: string; typ?: string };
    const payload = JSON.parse(decode(bodyPart)) as ArtifactSignaturePayload;
    if (header.alg !== 'EdDSA' || header.typ !== 'artifact+jws' || header.kid !== payload.keyId ||
      !/^[a-f0-9]{64}$/i.test(payload.artifactHash) ||
      (expected?.artifactHash && expected.artifactHash.toLowerCase() !== payload.artifactHash.toLowerCase()) ||
      (expected?.caseId && expected.caseId !== payload.caseId) || (expected?.taskId && expected.taskId !== payload.taskId)) return null;
    const valid = verify(null, Buffer.from(`${headerPart}.${bodyPart}`), key(publicKey, 'public'), Buffer.from(signaturePart, 'base64url'));
    return valid ? payload : null;
  } catch { return null; }
}

export function generateArtifactSigningKeyPair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519', { privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  return pair;
}
