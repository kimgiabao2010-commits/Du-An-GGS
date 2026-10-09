import { describe,expect,it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Ed25519TaskVerifier,signTaskAuthorization,taskAuthorizationHash } from '../src/security/task-authority.ts';
describe('verify-only task authority', () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type:'pkcs8',format:'pem' }).toString();
  const publicKey = keys.publicKey.export({ type:'spki',format:'pem' }).toString();
  const verifier = new Ed25519TaskVerifier(publicKey,'test');
  const task = { taskId:'task',caseId:'case',target:'ide',action:'search_code',parameters:{ question:'fixture' },contextRefs:[] };
  const input = () => ({ agentId:'ide-worker-agent',role:'STANDALONE',permissions:['EXECUTE_READ_ONLY'],timestamp:Date.now(),expiresAt:Date.now()+60000,
    taskId:'task',incidentId:'case',taskHash:taskAuthorizationHash(task) });
  it('verifies only with the public key and binds all material task parameters', () => {
    const token = signTaskAuthorization(input(),privateKey,'test');
    expect(verifier.verify(token)?.taskHash).toBe(taskAuthorizationHash(task));
    expect(verifier.verify(token)?.taskHash).not.toBe(taskAuthorizationHash({ ...task,parameters:{ question:'changed' } }));
  });
  it('rejects tampered signature, wrong key ID and wrong public key', () => {
    const token = signTaskAuthorization(input(),privateKey,'test');
    expect(verifier.verify(token.slice(0,-5)+'AAAAA')).toBeNull();
    expect(verifier.verify(token.replace('.test.','.other.'))).toBeNull();
    const other = generateKeyPairSync('ed25519').publicKey.export({ type:'spki',format:'pem' }).toString();
    expect(new Ed25519TaskVerifier(other,'test').verify(token)).toBeNull();
  });
  it('rejects expired and excessive-lifetime authorizations', () => {
    expect(verifier.verify(signTaskAuthorization({ ...input(),timestamp:Date.now()-2000,expiresAt:Date.now()-1000 },privateKey,'test'))).toBeNull();
    expect(verifier.verify(signTaskAuthorization({ ...input(),expiresAt:Date.now()+3600000 },privateKey,'test'))).toBeNull();
  });
});
