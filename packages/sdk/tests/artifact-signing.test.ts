import { describe, expect, it } from 'vitest';
import { generateArtifactSigningKeyPair, signArtifact, verifyArtifactSignature } from '../src/security/artifact-signing.ts';

describe('artifact Ed25519 signing', () => {
  it('binds artifact, case and task to a verifiable compact signature', () => {
    const keys = generateArtifactSigningKeyPair();
    const payload = { artifactHash: 'a'.repeat(64), caseId: 'case-1', taskId: 'task-1', keyId: 'cp-2026-01', createdAt: new Date().toISOString() };
    const signed = signArtifact(payload, keys.privateKey);
    expect(verifyArtifactSignature(signed.compactJws, keys.publicKey, payload)).toEqual(payload);
    expect(verifyArtifactSignature(signed.compactJws, keys.publicKey, { taskId: 'other-task' })).toBeNull();
  });
});
