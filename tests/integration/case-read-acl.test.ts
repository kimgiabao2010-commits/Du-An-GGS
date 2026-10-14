import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresRuntimeStore } from '@asq/persistence';
import { TokenSigner } from '@asq/sdk';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
const enabled=Boolean(process.env.DATABASE_URL);
const service='case-read-fixture-service-secret-32chars',gateway='case-read-fixture-gateway-secret-32chars';
const secret='case-read-fixture-session-secret-32chars';
const signer=new TokenSigner(secret),caseId='case-read-'+randomUUID();
let pool:Pool,server:ControlPlaneServer,base:string;
function headers(subject='outsider',role='SOC_ANALYST') {
  return {authorization:'Bearer '+gateway,'x-gss-actor':'spoofed-owner',
    'x-gss-session':signer.sign({agentId:subject,role,permissions:[],timestamp:Date.now(),expiresAt:Date.now()+60000})};
}
const get=(path:string,auth=headers())=>fetch(base+'/control/v1/cases/'+path,{headers:auth,signal:AbortSignal.timeout(5000)});
beforeAll(async()=>{
  if(!enabled)return;
  if(!new URL(process.env.DATABASE_URL!).searchParams.get('options')?.includes('gss_suite_'))throw new Error('Isolated PostgreSQL required');
  vi.stubEnv('GSS_RUNTIME_ENV','local');vi.stubEnv('ASQ_LOCAL_RUNTIME','true');vi.stubEnv('GSS_OIDC_ISSUER','');
  vi.stubEnv('GSS_CONTROL_PLANE_TOKEN',service);vi.stubEnv('GSS_UI_GATEWAY_TOKEN',gateway);vi.stubEnv('ASQ_JWT_SECRET',secret);
  pool=new Pool({connectionString:process.env.DATABASE_URL});
  const runtime=new PostgresRuntimeStore(pool);await runtime.ensureCase(caseId,'fixture-owner');await runtime.ensureInvestigationRun(caseId,'fixture-owner');
  await pool.query('INSERT INTO case_access(case_id,issuer,subject,granted_by) VALUES($1,$2,$3,$4)',[caseId,'gss-local-demo','owner','fixture']);
  server=new ControlPlaneServer(0);base='http://127.0.0.1:'+await server.ready();
},20000);
afterAll(async()=>{await server?.close();await pool?.end();vi.unstubAllEnvs();},20000);
describe.skipIf(!enabled)('Case-read HTTP ACL with real isolated PostgreSQL; local identity fixture, not staging OIDC',()=>{
  it('returns an uncached atomic empty snapshot and rejects a damaged persisted frontier before exposing it',async()=>{
    const empty=await get(caseId+'/frontier',headers('owner'));
    expect(empty.headers.get('cache-control')).toBe('no-store');
    expect(await empty.json()).toMatchObject({run:{caseId,frontierVersion:0},frontier:null});
    const broken='broken-frontier-'+randomUUID(),runtime=new PostgresRuntimeStore(pool);
    await runtime.ensureCase(broken,'fixture');const run=await runtime.ensureInvestigationRun(broken,'fixture');
    const frontier={schemaVersion:'gss.evidence-frontier.v1',runId:run.runId,caseId:broken,version:1,
      facts:[],contradictions:[],evidenceRefs:[],sourceObservationIds:[],updatedAt:new Date().toISOString()};
    await pool.query('INSERT INTO evidence_frontiers(run_id,case_id,version,observation_id,payload,payload_hash,created_at) VALUES($1,$2,1,$3,$4,$5,now())',
      [run.runId,broken,'fixture-observation-'+randomUUID(),frontier,'0'.repeat(64)]);
    await pool.query('UPDATE investigation_runs SET frontier_version=1 WHERE run_id=$1',[run.runId]);
    const response=await get(broken+'/frontier',headers('admin','SECURITY_ADMIN'));
    expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'report_frontier_integrity_or_size_failed'});
  });
  it.each(['frontier','lab-report','timeline','report','entities'])('denies cross-case %s reads before lookup, including encoded and unknown case IDs',async route=>{
    for(const role of ['SOC_ANALYST','SOC_LEAD','CONTROL_OPERATOR','AUDITOR']) {
      const response=await get(caseId+'/'+route,headers('outsider',role));
      expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'incident_access_denied'});
    }
    expect((await get('%63'+caseId.slice(1)+'/'+route)).status).toBe(403);
    expect((await get('unknown-'+randomUUID()+'/'+route)).status).toBe(403);
    // Authorized lab lookup is 404 because no report/evidence was fabricated for this ACL fixture.
    expect((await get(caseId+'/'+route,headers('owner'))).status).toBe(route==='lab-report'?404:200);
  });
  it('requires an authenticated operator; gateway bearer alone and spoofed actor cannot read case data',async()=>{
    expect((await get(caseId+'/frontier',{authorization:'Bearer invalid','x-gss-actor':'owner','x-gss-session':''})).status).toBe(401);
    expect((await get(caseId+'/frontier',{authorization:'Bearer '+gateway,'x-gss-actor':'owner','x-gss-session':''})).status).toBe(401);
  });
  it('revoked incident grant is enforced on the next read without restarting the authority',async()=>{
    await pool.query('INSERT INTO case_access(case_id,issuer,subject,granted_by) VALUES($1,$2,$3,$4)',[caseId,'gss-local-demo','temporary','fixture']);
    expect((await get(caseId+'/frontier',headers('temporary'))).status).toBe(200);
    await pool.query('DELETE FROM case_access WHERE case_id=$1 AND issuer=$2 AND subject=$3',[caseId,'gss-local-demo','temporary']);
    expect((await get(caseId+'/frontier',headers('temporary'))).status).toBe(403);
  });
  it('retains explicit Security Admin and internal-service authority without widening ordinary operator access',async()=>{
    const admin=await get(caseId+'/frontier',headers('admin','SECURITY_ADMIN'));
    expect(admin.status).toBe(200);expect((await admin.json()).run.caseId).toBe(caseId);
    expect((await get(caseId+'/frontier',{authorization:'Bearer '+service,'x-gss-actor':'service','x-gss-session':''})).status).toBe(200);
    const report=await (await get(caseId+'/report',headers('admin','SECURITY_ADMIN'))).json();
    expect(report.offlineIntel).toMatchObject({status:'NOT_CONFIGURED',matches:[],matchCount:0});
  });
});
