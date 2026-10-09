import { afterEach,describe,expect,it,vi } from 'vitest';
import { generateKeyPair,exportJWK,createLocalJWKSet,SignJWT } from 'jose';
const fixture=vi.hoisted(()=>({resolver:undefined as any}));
vi.mock('jose',async()=>{
  const actual=await vi.importActual<typeof import('jose')>('jose');
  return {...actual,createRemoteJWKSet:()=>fixture.resolver};
});
import { OidcAuthority,authorizeOperator,type OperatorIdentity } from '../../services/control-plane/src/identity.ts';
const issuer='https://fixture-idp.example',audience='gss-fixture';
afterEach(()=>vi.unstubAllEnvs());
async function setup() {
  vi.stubEnv('GSS_OIDC_ISSUER',issuer);vi.stubEnv('GSS_OIDC_AUDIENCE',audience);vi.stubEnv('GSS_OIDC_JWKS_URI',issuer+'/jwks');
  const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);jwk.kid='fixture';
  fixture.resolver=createLocalJWKSet({keys:[jwk]});
  const query=vi.fn().mockResolvedValue({rows:[]});
  const authority=new OidcAuthority({query} as any);
  const token=async(extra:Record<string,unknown>={})=>new SignJWT({gss_role:'SOC_ANALYST',amr:['mfa'],...extra})
    .setProtectedHeader({alg:'ES256',kid:'fixture'}).setIssuer(issuer).setAudience(audience).setSubject('analyst')
    .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  return {authority,query,token};
}
describe('OIDC policy with real JWT signatures and fixture JWKS, not live IdP',()=>{
  it('verifies issuer/audience/signature and MFA, never caller supplied role headers',async()=>{
    const {authority,token}=await setup();
    const identity=await authority.authenticate({headers:{authorization:'Bearer '+await token(),'x-gss-actor':'admin'}} as any);
    expect(identity.subject).toBe('analyst');expect(identity.role).toBe('SOC_ANALYST');
    await expect(authority.authenticate({headers:{authorization:'Bearer '+await token({amr:['pwd']})}} as any)).rejects.toThrow('mfa_required');
    await expect(authority.authenticate({headers:{authorization:'Bearer '+await token({amr:['otp']})}} as any)).rejects.toThrow('mfa_required');
    await expect(authority.authenticate({headers:{authorization:'Bearer '+await token({amr:['hwk']})}} as any)).rejects.toThrow('mfa_required');
    expect((await authority.authenticate({headers:{authorization:'Bearer '+await token({amr:['pwd','otp']})}} as any)).role).toBe('SOC_ANALYST');
    await expect(authority.authenticate({headers:{authorization:'Bearer '+await token({gss_role:'owner'})}} as any)).rejects.toThrow('identity_role_denied');
  });
  it('rejects signature alteration and revoked sessions',async()=>{
    const {authority,query,token}=await setup();const signed=await token();
    await expect(authority.authenticate({headers:{authorization:'Bearer '+signed.slice(0,-8)+'AAAAAAA'}} as any)).rejects.toThrow('invalid_identity');
    query.mockResolvedValue({rows:[{revoked_before:new Date()}]});
    await expect(authority.authenticate({headers:{authorization:'Bearer '+signed}} as any)).rejects.toThrow('session_revoked');
  });
  it('denies incident reads without ACL and allows explicit membership',async()=>{
    const {authority,query}=await setup();const identity:OperatorIdentity={issuer,subject:'analyst',issuedAt:Date.now()/1000,role:'SOC_ANALYST'};
    await expect(authority.caseAccess(identity,'other-case')).rejects.toThrow('incident_access_denied');
    query.mockResolvedValue({rows:[{ok:1}]});await expect(authority.caseAccess(identity,'allowed-case')).resolves.toBeUndefined();
  });
  it('keeps workers/results/signing service-only even for security admin; auditor cannot approve',()=>{
    const identity:OperatorIdentity={issuer,subject:'admin',issuedAt:Date.now()/1000,role:'SECURITY_ADMIN'};
    expect(()=>authorizeOperator(identity,'POST','/control/v1/results')).toThrow('service_authority_required');
    expect(()=>authorizeOperator(identity,'POST','/control/v1/tasks/authorize')).toThrow('service_authority_required');
    expect(()=>authorizeOperator(identity,'POST','/control/v1/model-reservations')).toThrow('service_authority_required');
    expect(()=>authorizeOperator(identity,'POST','/control/v1/model-reservations/start')).toThrow('service_authority_required');
    expect(()=>authorizeOperator({...identity,role:'AUDITOR'},'POST','/control/v1/approvals/APR-fixture/decision')).toThrow('role_denied');
    expect(()=>authorizeOperator({...identity,role:'SOC_LEAD'},'POST','/control/v1/approvals/APR-fixture/decision')).not.toThrow();
  });
});
