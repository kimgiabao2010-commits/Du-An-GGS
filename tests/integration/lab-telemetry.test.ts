import { describe,it,expect,beforeAll,afterAll,vi } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp,readFile,writeFile,rm,realpath,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PostgresLabTelemetryStore, PostgresRuntimeStore } from '@asq/persistence';
import { labBatchHash, validateLabBatch, type LabBatch, type InvestigationRequest } from '@asq/sdk';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
const enabled=Boolean(process.env.DATABASE_URL);
let db:Pool,root:string,store:PostgresLabTelemetryStore;
const hostId='host-'+'a'.repeat(64);
const b:LabBatch={schemaVersion:'gss.lab-telemetry.v1',sourceId:'local-windows',sourceKind:'REPLAY',collectedAt:'2026-10-09T01:00:00Z',truncated:false,
  events:[{recordId:'1',eventCode:1001,channel:'System',provider:'Test fixture',eventTime:'2026-10-09T00:00:00Z',hostId,level:2}]};
const hash=labBatchHash(b),actor='lab-fixture';
function query(caseId:string,key=randomUUID()):InvestigationRequest { return {incidentId:caseId,taskId:'not-authority',idempotencyKey:key,requestedBy:'untrusted',
  indicator:{type:'HOSTNAME',value:hostId},timeRange:{start:'2026-10-08T00:00:00Z',end:'2026-10-10T00:00:00Z'}}; }
beforeAll(async()=>{
  if(!enabled)return;
  if(!new URL(process.env.DATABASE_URL!).searchParams.get('options')?.includes('gss_suite_'))throw new Error('Isolated schema required');
  db=new Pool({connectionString:process.env.DATABASE_URL});root=await mkdtemp(join(tmpdir(),'gss-lab-'));
  store=new PostgresLabTelemetryStore(db,{profile:'replay',allowedSources:['local-windows'],artifactRoot:root});
});
afterAll(async()=>{await db?.end();if(root && dirname(resolve(root))===resolve(tmpdir()) && basename(root).startsWith('gss-lab-'))await rm(root,{recursive:true,force:true});});
describe.skipIf(!enabled)('PostgreSQL lab evidence authority (fixture, NOT live telemetry)',()=>{
  it('imports atomically, supports concurrent replay and binds actor/body',async()=>{
    const input={batch:b,checksum:hash,idempotencyKey:randomUUID()};
    const results=await Promise.all([store.importBatch(input,actor),store.importBatch(input,actor)]);
    expect(results.filter(r=>!r.replay)).toHaveLength(1);
    await expect(store.importBatch(input,'another-actor')).rejects.toMatchObject({statusCode:409});
    expect((await db.query('SELECT count(*)::int AS n FROM lab_telemetry_batches WHERE batch_hash=$1',[hash])).rows[0].n).toBe(1);
  });
  it('rejects unauthorized sources/profile/hash before generating evidence',async()=>{
    const denied=new PostgresLabTelemetryStore(db,{profile:'staging',allowedSources:['local-windows'],artifactRoot:root});
    await expect(denied.importBatch({batch:b,checksum:hash,idempotencyKey:randomUUID()},actor)).rejects.toMatchObject({statusCode:403});
    await expect(store.importBatch({batch:b,checksum:'f'.repeat(64),idempotencyKey:randomUUID()},actor)).rejects.toMatchObject({statusCode:422});
  });
  it('persists evidence → Frontier → deterministic BLOCKED → outbox and survives store restart/replay',async()=>{
    const caseId='LABCASE-'+randomUUID();await new PostgresRuntimeStore(db).ensureCase(caseId,actor);
    const q=query(caseId),first=await store.investigate(hash,q,actor);
    expect(first.report.verdict).toBe('INSUFFICIENT_EVIDENCE');expect(first.loop.frontier.facts).toHaveLength(1);
    expect(first.loop.decision).toMatchObject({kind:'BLOCKED',reasonCode:'LAB_METADATA_ONLY'});
    expect(await store.report(caseId)).toMatchObject({report:first.report});
    const restarted=new PostgresLabTelemetryStore(db,{profile:'replay',allowedSources:['local-windows'],artifactRoot:root});
    expect(await restarted.investigate(hash,q,actor)).toMatchObject({replay:true,report:first.report});
    expect((await db.query('SELECT count(*)::int AS n FROM evidence_frontiers WHERE run_id=$1',[first.loop.run.runId])).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM control_outbox WHERE aggregate_id=$1',[first.loop.run.runId])).rows[0].n).toBe(1);
    await expect(store.investigate(hash,{...q,limit:1},actor)).rejects.toMatchObject({statusCode:409});
  });
  it('rollback leaves no query/frontier if audit fails',async()=>{
    const caseId='LABCASE-'+randomUUID();await new PostgresRuntimeStore(db).ensureCase(caseId,actor);
    await db.query("CREATE FUNCTION lab_fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.incident_id LIKE 'LABCASE-%' AND NEW.event_type='NEXT_STEP_DECIDED' THEN RAISE EXCEPTION 'lab_fixture_audit_failed'; END IF; RETURN NEW; END $$");
    await db.query('CREATE TRIGGER lab_fixture_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION lab_fixture_fail_audit()');
    try {await expect(store.investigate(hash,query(caseId),actor)).rejects.toThrow('lab_fixture_audit_failed');}
    finally {await db.query('DROP TRIGGER lab_fixture_audit ON audit_events');await db.query('DROP FUNCTION lab_fixture_fail_audit()');}
    expect((await db.query('SELECT count(*)::int AS n FROM investigation_runs WHERE case_id=$1',[caseId])).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM lab_query_receipts WHERE case_id=$1',[caseId])).rows[0].n).toBe(0);
  });
  it('fails closed on artifact mutation and immutable batch update',async()=>{
    await expect(db.query('UPDATE lab_telemetry_batches SET source_kind=\'LAB_LIVE\' WHERE batch_hash=$1',[hash])).rejects.toThrow('immutable');
    const file=join(root,hash+'.json'),original=await readFile(file,'utf8');await writeFile(file,JSON.stringify({...b,collectedAt:'2026-10-09T02:00:00Z'}));
    try {await expect(store.importBatch({batch:b,checksum:hash,idempotencyKey:randomUUID()},actor)).rejects.toThrow('integrity');}
    finally {await writeFile(file,original);}
  });
  it('rejects absent parameters, foreign case owner and report without receipt',async()=>{
    const caseId='LABCASE-'+randomUUID();await new PostgresRuntimeStore(db).ensureCase(caseId,'different-owner');
    await expect(store.investigate(hash,query(caseId),actor)).rejects.toMatchObject({statusCode:403});
    await expect(store.investigate(hash,{...query(caseId),indicator:undefined as any},actor)).rejects.toMatchObject({statusCode:422});
    await expect(store.report(caseId)).rejects.toMatchObject({statusCode:404});
  });
  it('refuses truncated provenance-table deletion',async()=>{
    await expect(db.query('TRUNCATE lab_query_receipts')).rejects.toThrow('immutable');
  });
  it('production profile HTTP endpoint denies fixture import, even with service bearer',async()=>{
    const old=process.env.GSS_CONTROL_PLANE_TOKEN;process.env.GSS_CONTROL_PLANE_TOKEN='lab-fixture-service-token-at-least-32';
    const server=new ControlPlaneServer(0);
    try {const base='http://127.0.0.1:'+await server.ready();
      const response=await fetch(base+'/control/v1/lab/batches',{method:'POST',headers:{authorization:'Bearer '+process.env.GSS_CONTROL_PLANE_TOKEN,'content-type':'application/json'},
        body:JSON.stringify({batch:b,checksum:hash,idempotencyKey:randomUUID()})});expect(response.status).toBe(403);
    }finally{await server.close();if(old===undefined)delete process.env.GSS_CONTROL_PLANE_TOKEN;else process.env.GSS_CONTROL_PLANE_TOKEN=old;}
  });
  it.skipIf(!process.env.GSS_LAB_LIVE_BATCH)('operator-authorized own-device export → HTTP Control Plane → durable Frontier/report (actual telemetry, not fixture)',async()=>{
    const allowed=await realpath(resolve('data/lab')),file=await realpath(resolve(process.env.GSS_LAB_LIVE_BATCH!));
    if(!file.startsWith(allowed+sep))throw new Error('Private own-device export required');
    const live=validateLabBatch(JSON.parse(await readFile(file,'utf8')));
    if(live.sourceKind!=='LAB_LIVE' || live.sourceId!=='local-windows' || !live.events.length)throw new Error('Not a live own-device export');
    const token='live-lab-isolated-control-token-at-least-32';
    vi.stubEnv('GSS_SOC_PROFILE','lab');vi.stubEnv('GSS_RUNTIME_ENV','local');vi.stubEnv('GSS_LAB_OWN_DEVICE_AUTHORIZED','true');
    vi.stubEnv('GSS_LAB_ALLOWED_SOURCES','local-windows');vi.stubEnv('GSS_DATA_DIR',join(root,'live'));
    vi.stubEnv('GSS_CONTROL_PLANE_TOKEN',token);
    let server=new ControlPlaneServer(0);
    try {
      let base='http://127.0.0.1:'+await server.ready();
      async function post(path:string,payload:unknown){
        const response=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-gss-actor':'own-device-lab-verification'},body:JSON.stringify(payload)});
        const result=await response.json() as any;expect(response.status,JSON.stringify(result)).toBeLessThan(300);return result;
      }
      const checksum=labBatchHash(live),caseId='LABCASE-'+randomUUID(),key=randomUUID();
      await post('/control/v1/lab/batches',{batch:live,checksum,idempotencyKey:'import-'+key});
      await post('/control/v1/cases',{caseId});
      const end=Math.max(...live.events.map(event=>Date.parse(event.eventTime)))+1;
      const payload={batchHash:checksum,idempotencyKey:'query-'+key,indicator:{type:'HOSTNAME',value:live.events[0].hostId},
        timeRange:{start:new Date(end-7*86400000).toISOString(),end:new Date(end).toISOString()},limit:100};
      const first=await post(`/control/v1/cases/${caseId}/lab-investigations`,payload);
      expect(first.evidence.events.length).toBeGreaterThan(0);expect(first.loop.frontier.facts.length).toBeGreaterThan(0);
      expect(first.report.provenance.sourceKind).toBe('LAB_LIVE');expect(first.report.verdict).toBe('INSUFFICIENT_EVIDENCE');
      await server.close();server=new ControlPlaneServer(0);base='http://127.0.0.1:'+await server.ready();
      const replay=await post(`/control/v1/cases/${caseId}/lab-investigations`,payload);
      expect(replay.replay).toBe(true);expect(replay.loop.frontier.version).toBe(first.loop.frontier.version);
      const read=await fetch(base+`/control/v1/cases/${caseId}/lab-report`,{headers:{authorization:'Bearer '+token}});
      expect(read.status).toBe(200);expect((await read.json() as any).report.evidenceIds).toEqual(first.report.evidenceIds);
      await mkdir(allowed,{recursive:true});await writeFile(join(allowed,'live-verification.json'),JSON.stringify({schemaVersion:'gss.lab-live-verification.v1',
        verifiedAt:new Date().toISOString(),database:'isolated test schema; NOT runtime schema',collectedBatchHash:checksum,
        report:first.report,frontier:first.loop.frontier,decision:first.loop.decision,replayVerified:true},null,2),{mode:0o600});
      console.log('LAB_LIVE: actual own-device metadata, HTTP/PG Frontier and replay PASS. Chronicle/model/sandbox NOT RUN.');
    }finally{await server.close();vi.unstubAllEnvs();}
  },20000);
});
