import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresWorkloadRevocationStore,type WorkloadRevocationInput } from '@asq/persistence';
import { TokenSigner } from '@asq/sdk';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
const enabled=Boolean(process.env.DATABASE_URL);
let pool:Pool,store:PostgresWorkloadRevocationStore,server:ControlPlaneServer,base:string;
const service='revocation-fixture-service-secret-32chars';
const gateway='revocation-fixture-gateway-secret-32chars';
const signer=new TokenSigner('revocation-fixture-jwt-secret-32chars');
const fingerprint=()=>createHash('sha256').update(randomUUID()).digest('hex');
const input=():WorkloadRevocationInput=>({schemaVersion:'gss.workload-revocation.v1',fingerprint:fingerprint(),
  workloadId:'cli-worker-agent',idempotencyKey:randomUUID(),reasonHash:fingerprint()});
const headers=(role='SECURITY_ADMIN',subject='revocation-admin')=>({authorization:'Bearer '+gateway,
  'content-type':'application/json','x-gss-actor':'spoofed-admin','x-gss-session':signer.sign({
    agentId:subject,role,permissions:[],timestamp:Date.now(),expiresAt:Date.now()+60000})});
const post=(path:string,value:unknown,auth:Record<string,string>)=>fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify(value)});
beforeAll(async()=>{
  if(!enabled)return;
  if(!new URL(process.env.DATABASE_URL!).searchParams.get('options')?.includes('gss_suite_'))throw new Error('isolated PostgreSQL runner required');
  vi.stubEnv('GSS_RUNTIME_ENV','local');vi.stubEnv('GSS_OIDC_ISSUER','');vi.stubEnv('ASQ_LOCAL_RUNTIME','true');
  vi.stubEnv('GSS_CONTROL_PLANE_TOKEN',service);vi.stubEnv('GSS_UI_GATEWAY_TOKEN',gateway);
  vi.stubEnv('ASQ_JWT_SECRET','revocation-fixture-jwt-secret-32chars');
  pool=new Pool({connectionString:process.env.DATABASE_URL});store=new PostgresWorkloadRevocationStore(pool);
  server=new ControlPlaneServer(0);base='http://127.0.0.1:'+await server.ready();
},20000);
afterAll(async()=>{await server?.close();await pool?.end();vi.unstubAllEnvs();},20000);
describe.skipIf(!enabled)('Permanent certificate deny floor, real isolated PostgreSQL and HTTP',()=>{
  it('serializes concurrent same-body replay with one revision, row and atomic audit',async()=>{
    const value=input(),actor='test-revoker-'+randomUUID();const before=await store.check(value.fingerprint);
    const receipts=await Promise.all([store.revoke(value,actor),store.revoke(value,actor)]);
    expect(receipts.map(r=>r.replay).sort()).toEqual([false,true]);expect(receipts[0].revision).toBe(receipts[1].revision);
    expect(receipts[0].revision).toBeGreaterThan(before.revision);
    expect((await pool.query('SELECT count(*)::int AS n FROM workload_certificate_revocations WHERE fingerprint=$1',[value.fingerprint])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE event_type='WORKLOAD_CERTIFICATE_REVOKED' AND actor_id=$1",[actor])).rows[0].n).toBe(1);
    await expect(store.check(value.fingerprint)).rejects.toThrow('workload_certificate_revoked');
  });
  it('denies payload/actor reuse, pin resurrection and duplicate leaf with a new key',async()=>{
    const value=input(),actor='test-revoker-'+randomUUID();await store.revoke(value,actor);
    await expect(store.revoke({...value,reasonHash:fingerprint()},actor)).rejects.toThrow('idempotency_conflict');
    await expect(store.revoke(value,'different-admin')).rejects.toThrow('idempotency_conflict');
    await expect(store.revoke({...value,idempotencyKey:randomUUID()},actor)).rejects.toThrow('idempotency_conflict');
    await expect(pool.query('UPDATE workload_certificate_revocations SET workload_id=$2 WHERE fingerprint=$1',[value.fingerprint,'ide-worker-agent'])).rejects.toThrow('immutable');
    await expect(pool.query('DELETE FROM workload_certificate_revocations WHERE fingerprint=$1',[value.fingerprint])).rejects.toThrow('immutable');
    await expect(pool.query('TRUNCATE workload_certificate_revocations')).rejects.toThrow('immutable');
    await expect(pool.query('UPDATE workload_revocation_state SET revision=0')).rejects.toThrow('not_monotonic');
    await expect(pool.query('DELETE FROM workload_revocation_state')).rejects.toThrow('not_monotonic');
    await expect(new PostgresWorkloadRevocationStore(pool).check(value.fingerprint)).rejects.toThrow('revoked');
  });
  it('rolls back tombstone and revision when audit persistence fails',async()=>{
    const value=input(),actor='audit-failure-'+randomUUID();
    await pool.query(`CREATE FUNCTION reject_revocation_fixture_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.actor_id='${actor}' THEN RAISE EXCEPTION 'revocation_audit_failure'; END IF; RETURN NEW;END $$`);
    await pool.query('CREATE TRIGGER reject_revocation_fixture_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_revocation_fixture_audit()');
    try {
      const before=await store.check(value.fingerprint);
      await expect(store.revoke(value,actor)).rejects.toThrow('revocation_audit_failure');
      expect((await store.check(value.fingerprint)).allowed).toBe(true);
      // Other files may revoke concurrently: account for all legitimate revisions, not wall-clock ordering.
      const after=(await pool.query(`SELECT revision,(SELECT count(*)::int FROM workload_certificate_revocations
        WHERE revision>$1) AS added FROM workload_revocation_state WHERE singleton=true`,[before.revision])).rows[0];
      expect(Number(after.revision)-before.revision).toBe(after.added);
      expect((await pool.query('SELECT 1 FROM workload_certificate_revocations WHERE fingerprint=$1',[value.fingerprint])).rowCount).toBe(0);
    }finally{await pool.query('DROP TRIGGER reject_revocation_fixture_audit ON audit_events');await pool.query('DROP FUNCTION reject_revocation_fixture_audit()');}
  });
  it('enforces Security Admin identity, never service bearer, role header or body actor',async()=>{
    const path='/control/v1/workload-certificates/revocations',value=input();
    expect((await post(path,value,{authorization:'Bearer '+service})).status).toBe(403);
    for(const role of ['SOC_ANALYST','SOC_LEAD','AUDITOR','CONTROL_OPERATOR'])expect((await post(path,value,headers(role))).status).toBe(403);
    expect((await post(path,value,{'x-gss-actor':'admin'})).status).toBe(401);
    expect((await post(path,value,{...headers(),'idempotency-key':'different'})).status).toBe(422);
    expect((await post(path,{...value,fingerprint:'not-a-hash'},headers())).status).toBe(422);
    expect((await post(path,value,headers())).status).toBe(201);
    expect((await post(path,value,headers())).status).toBe(200);
    expect((await post(path,{...value,reasonHash:fingerprint()},headers())).status).toBe(409);
    expect((await pool.query('SELECT actor_id FROM workload_certificate_revocations WHERE fingerprint=$1',[value.fingerprint])).rows[0].actor_id).toBe('gss-local-demo#revocation-admin');
  });
  it('keeps checks service-only and survives authority restart; audit reads are role gated',async()=>{
    const value=input();await store.revoke(value,'restart-fixture-'+randomUUID());
    const auth={authorization:'Bearer '+service};
    expect((await post('/control/v1/workload-certificates/check',{fingerprint:fingerprint()},auth)).status).toBe(200);
    expect((await post('/control/v1/workload-certificates/check',{fingerprint:value.fingerprint},auth)).status).toBe(403);
    expect((await post('/control/v1/workload-certificates/check',{fingerprint:fingerprint()},headers())).status).toBe(403);
    expect((await fetch(base+'/control/v1/workload-certificates/revocations',{headers:headers('AUDITOR')})).status).toBe(200);
    expect((await fetch(base+'/control/v1/workload-certificates/revocations',{headers:headers('SOC_ANALYST')})).status).toBe(403);
    await server.close();server=new ControlPlaneServer(0);base='http://127.0.0.1:'+await server.ready();
    expect((await post('/control/v1/workload-certificates/check',{fingerprint:value.fingerprint},auth)).status).toBe(403);
  });
  it('does not silently accept invalid contracts or unavailable authority state',async()=>{
    await expect(store.revoke({...input(),workloadId:'invented-worker' as any},'fixture')).rejects.toThrow('invalid');
    await expect(store.check('invalid')).rejects.toThrow('invalid');
    const unavailable=new PostgresWorkloadRevocationStore({query:async()=>({rows:[]})} as any);
    await expect(unavailable.check(fingerprint())).rejects.toThrow('authority_unavailable');
    const down=new PostgresWorkloadRevocationStore({query:async()=>{throw new Error('private provider detail');}} as any);
    await expect(down.check(fingerprint())).rejects.toMatchObject({message:'revocation_authority_unavailable',statusCode:503});
  });
});
