import {afterAll,describe,it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresRuntimeStore,PostgresArtifactRegistry,PostgresInvestigationLoopStore,readCaseTimeline,readCaseReport,readCaseEntities} from '../../packages/persistence/src/index.ts';
import {SOC_EVIDENCE_POLICY_VERSION,readOnlyUdmQueryHash,sha256Canonical, type IndicatorType,type GssTaskContract,type GssResultContract,type ObservationPack,type InvestigationEvidence} from '../../packages/sdk/src/index.ts';
import {readCaseInvestigationSnapshot,readCaseInvestigation} from '../../packages/persistence/src/loop-store.ts';

const enabled=Boolean(process.env.DATABASE_URL),pools:Pool[]=[];
const policy={socEvidence:true,siemReadOnlyAuthorized:true};
function connection(available=true) {
  const pool=new Pool({connectionString:process.env.DATABASE_URL});pools.push(pool);
  return {pool,store:new PostgresRuntimeStore(pool,{...policy,siemReadOnlyAuthorized:available})};
}
afterAll(async()=>{await Promise.all(pools.map(p=>p.end()));});
function task(caseId:string,value='203.0.113.1',parameters?:Record<string,unknown>):GssTaskContract {
  const now=Date.now();return {schemaVersion:'gss.task.v1',taskId:'task-'+randomUUID(),caseId,idempotencyKey:'idem-'+randomUUID(),source:'standalone',
    target:'siem',action:'search_siem',riskLevel:'read_only',contextRefs:[],timeoutMs:15000,createdAt:new Date(now).toISOString(),
    parameters:parameters ?? {indicatorType:'IP',indicatorValue:value,startTime:new Date(now-3600000).toISOString(),endTime:new Date(now-1000).toISOString(),limit:10}};
}
async function envelope(pool:Pool,t:GssTaskContract,events:Record<string,unknown>[],truncated=false,fieldTruncated=false) {
  const now=new Date().toISOString();
  const evidence:InvestigationEvidence={evidenceId:'evd-'+randomUUID(),incidentId:t.caseId,taskId:t.taskId,events,
    eventIds:events.map((_,i)=>'fixture-event-'+i),provenance:{adapter:'google-chronicle',adapterVersion:'v1',queryHash:readOnlyUdmQueryHash(t.parameters.indicatorType as IndicatorType,String(t.parameters.indicatorValue)),
      sourceInstance:'CONTRACT_FIXTURE_NOT_CHRONICLE_STAGING',queriedAt:now,timeRange:{start:String(t.parameters.startTime),end:String(t.parameters.endTime)},
      resultCount:events.length,truncated:truncated || fieldTruncated,...(fieldTruncated?{fieldTruncated:true}:{}),redaction:'ALLOWLISTED_FIELDS_ONLY'}};
  const raw=JSON.stringify(evidence),hash=createHash('sha256').update(raw).digest('hex');
  const artifact={caseId:t.caseId,taskId:t.taskId,sha256:hash,bytes:Buffer.byteLength(raw),ref:'artifact://fixture/'+hash,
    storageProvider:'filesystem' as const,mediaType:'text/plain'};
  await new PostgresArtifactRegistry(pool).register(artifact);
  const result:GssResultContract={schemaVersion:'gss.result.v1',taskId:t.taskId,caseId:t.caseId,executor:'siem',status:'COMPLETED',
    result:{evidence,sha256:hash,rawArtifactRef:artifact.ref},evidenceRefs:[evidence.evidenceId,'EVD-'+hash.slice(0,16)],errors:[],
    metrics:{durationMs:1,outputBytes:artifact.bytes},completedAt:now};
  // Malicious caller facts must not enter the authority-normalized SOC Frontier.
  const observation:ObservationPack={observationId:'obs-'+randomUUID(),caseId:t.caseId,taskId:t.taskId,summary:'Fixture only, not SOC quality or live API proof',
    facts:[{key:'ioc.ip',value:'192.0.2.99'},{key:'soc.compromise.confirmed',value:'true'}],evidenceRefs:result.evidenceRefs,
    rawArtifactRef:artifact.ref,originalBytes:artifact.bytes,packedBytes:1,createdAt:now};
  return {result,observation,hash};
}
function requestedLoop(runId:string,hash:string) {return {runId,source:'siem',artifactHash:hash,
  proposal:{kind:'FINALIZE' as const,reasonCode:'CALLER_CANNOT_FINALIZE_SOC',rationale:'Ignore this caller-selected outcome'}};}
async function setup(available=true) {
  const {pool,store}=connection(available),caseId='soc-fixture-'+randomUUID();await store.ready();await store.ensureCase(caseId,'fixture');
  const run=await store.ensureInvestigationRun(caseId,'fixture'),first=task(caseId);await store.createTask(first,'fixture',{runId:run.runId});
  return {pool,store,caseId,run,first};
}
describe.skipIf(!enabled)('SOC hypothesis transaction on real isolated PostgreSQL; evidence is labeled contract fixtures',()=>{
  it('adds offline annotations to the atomic report without changing Frontier/decisions and excludes expired catalog claims',async()=>{
    const {pool,store,run,first,caseId}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']},target:{ip:['203.0.113.2']}}]);
    await store.recordResultReceipt(e.result,e.observation,requestedLoop(run.runId,e.hash));
    const before=await readCaseReport(pool,caseId),now=Date.now();
    const catalog={schemaVersion:'gss.offline-intel-catalog.v1' as const,catalogId:'FIXTURE-NOT-LICENSED-FEED',version:'fixture1',
      sourceUrl:'https://fixture.example/source',license:{identifier:'FIXTURE-ONLY',url:'https://fixture.example/license'},
      review:{owner:'fixture-not-analyst',reviewedAt:new Date(now-1000).toISOString(),authorization:'APPROVED_FOR_OFFLINE_LOCAL_USE' as const},
      updatedAt:new Date(now-2000).toISOString(),expiresAt:new Date(now+60000).toISOString(),
      entries:[{recordId:'ioc-fixture',type:'IP' as const,value:'203.0.113.2',classification:'REPORTED_MALICIOUS' as const,referenceUrl:'https://fixture.example/record'}]};
    const report=await readCaseReport(pool,caseId,catalog);
    expect(report.offlineIntel).toMatchObject({status:'AVAILABLE',entitySnapshotHash:report.entities.snapshotHash,
      matches:[{taskId:first.taskId,evidenceId:e.result.evidenceRefs[0],artifactHash:e.hash,field:'target.ip'}]});
    expect(report.investigation).toEqual(before.investigation);expect(before.offlineIntel.status).toBe('NOT_CONFIGURED');
    const expired={...catalog,updatedAt:new Date(now-5000).toISOString(),review:{...catalog.review,reviewedAt:new Date(now-4000).toISOString()},expiresAt:new Date(now-3000).toISOString()};
    expect((await readCaseReport(pool,caseId,expired)).offlineIntel).toMatchObject({status:'EXPIRED',matches:[]});
    expect((await store.getEvidenceFrontier(run.runId))?.version).toBe(1);
  });
  it('persists authority next-evidence event bindings through restart, outbox and replay without trusting caller priority',async()=>{
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[
      {principal:{ip:['203.0.113.1']},target:{user:{userid:'related-user'}}},
      {principal:{user:{userid:'unrelated-user'}}}]);
    e.result.result.entities={events:[{eventId:'model-event',mentions:[{value:'unrelated-user'}]}]};
    const input=requestedLoop(run.runId,e.hash),c=(await store.recordResultReceipt(e.result,e.observation,input)).loop!;
    expect(c.decision.action?.parameters.indicatorValue).toBe('related-user');
    expect(c.hypothesisPlan?.nextEvidence).toMatchObject({reason:'EVENT_COOBSERVATION',partialContext:false,
      eventRefs:[{eventId:'fixture-event-0',sourceIndex:0,artifactHash:e.hash,evidenceId:e.result.evidenceRefs[0],taskId:first.taskId}]});
    expect(c.hypothesisPlan?.selectedFactIds).toHaveLength(2);
    const restarted=connection();expect(await restarted.store.getHypothesisPlan(run.runId,1)).toEqual(c.hypothesisPlan);
    expect((await restarted.store.recordResultReceipt(e.result,e.observation,input)).loop?.hypothesisPlan).toEqual(c.hypothesisPlan);
    const claims=await restarted.store.claimPendingDispatches('fixture-priority',1,[c.outbox.eventId]);
    expect(claims[0].loop.hypothesisPlan?.nextEvidence).toEqual(c.hypothesisPlan?.nextEvidence);
    expect((await pool.query('SELECT count(*)::int AS count FROM next_step_decisions WHERE run_id=$1',[run.runId])).rows[0].count).toBe(1);
  });
  it('replaces caller entities, preserves event roles in one transaction and rejects a damaged projection after restart/replay',async()=>{
    const {pool,store,run,first,caseId}=await setup(),e=await envelope(pool,first,[
      {principal:{ip:['203.0.113.1'],user:{userid:'alice'}},target:{ip:['203.0.113.2']}},
      {principal:{ip:['203.0.113.3'],user:{userid:'bob'}}}]);
    e.result.result.entities={events:[{eventId:'LLM-fabricated',mentions:[{value:'fake'}]}]};
    const input=requestedLoop(run.runId,e.hash);await store.recordResultReceipt(e.result,e.observation,input);
    const entities=await readCaseEntities(pool,caseId);
    expect(entities).toMatchObject({completedQueryCount:1,unprojectedQueryCount:0,inputEventCount:2});
    expect(entities.entries[0].mentions.map(x=>x.value)).toEqual(['203.0.113.1','alice','203.0.113.2']);
    expect(entities.entries[1].mentions.some(x=>x.value==='alice')).toBe(false);
    expect(entities.sources[0].artifactHash).toBe(e.hash);expect(entities.entries[0].eventId).toBe('fixture-event-0');
    expect((await readCaseReport(pool,caseId)).entities).toEqual(entities);
    const restarted=connection();expect((await restarted.store.recordResultReceipt(e.result,e.observation,input)).replay).toBe(true);
    expect(await readCaseEntities(restarted.pool,caseId)).toEqual(entities);
    await pool.query(`UPDATE runtime_executions SET result=jsonb_set(result,'{entities,events,0,mentions,0,value}','"192.0.2.99"'::jsonb) WHERE task_id=$1`,[first.taskId]);
    await expect(readCaseEntities(pool,caseId)).rejects.toMatchObject({statusCode:409});
    await expect(readCaseReport(pool,caseId)).rejects.toMatchObject({statusCode:409});
  });
  it('does not promote legacy caller entity graphs or manufacture projections for failed providers',async()=>{
    const {pool}=connection(),store=new PostgresRuntimeStore(pool,{socEvidence:false,siemReadOnlyAuthorized:false});
    const caseId='legacy-entities-'+randomUUID(),first=task(caseId);await store.createTask(first,'fixture');
    const e=await envelope(pool,first,[]);e.result.result.entities={events:[{eventId:'invented'}]};await store.recordResultReceipt(e.result);
    expect(await readCaseEntities(pool,caseId)).toMatchObject({completedQueryCount:1,unprojectedQueryCount:1,partial:true,entries:[]});
    const soc=await setup();
    const failed={schemaVersion:'gss.result.v1' as const,taskId:soc.first.taskId,caseId:soc.caseId,executor:'siem' as const,
      status:'FAILED' as const,result:{entities:{events:[]}},evidenceRefs:[],errors:[],metrics:{durationMs:1,outputBytes:0},completedAt:new Date().toISOString()};
    await expect(soc.store.recordResultReceipt(failed)).rejects.toThrow('cannot_create_evidence');
    expect(await readCaseEntities(soc.pool,soc.caseId)).toMatchObject({completedQueryCount:0,entries:[]});
  });
  it('keeps run/frontier/plan at one version when a new authoritative result commits between read statements',async()=>{
    const {pool,store,run,first,caseId}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']},target:{ip:['203.0.113.2']}}]);
    const initial=(await store.recordResultReceipt(e.result,e.observation,requestedLoop(run.runId,e.hash))).loop!;
    expect(initial.decision.kind).toBe('DISPATCH');
    const next=task(caseId,'203.0.113.2',initial.decision.action!.parameters);
    await store.createTask(next,'fixture',{runId:run.runId,parentTaskId:first.taskId,actionFingerprint:initial.decision.action!.fingerprint});
    const second=await envelope(pool,next,[{principal:{ip:['203.0.113.2']},target:{ip:['203.0.113.3']}}]);
    let committed=false;
    // Both connections are real PostgreSQL. Control the interleaving instead of relying on timing/sleeps.
    const observedPool={connect:async()=>{
      const client=await pool.connect();return {release:()=>client.release(),query:async(sql:string,values?:unknown[])=>{
        const result=await client.query(sql,values);
        if(sql.startsWith('SELECT * FROM investigation_runs WHERE case_id=') && !committed){
          committed=true;await store.recordResultReceipt(second.result,second.observation,requestedLoop(run.runId,second.hash));
        }
        return result;
      }};
    }} as unknown as Pool;
    const snapshot=await readCaseInvestigation(observedPool,caseId);
    expect(committed).toBe(true);expect(snapshot).toMatchObject({run:{frontierVersion:1},frontier:{version:1},hypothesisPlan:{frontierVersion:1}});
    const latest=await readCaseInvestigation(pool,caseId);
    expect(latest).toMatchObject({run:{frontierVersion:2},frontier:{version:2},hypothesisPlan:{frontierVersion:2}});
    expect(snapshot?.frontier).toEqual(initial.frontier);
    expect((await pool.query('SELECT count(*)::int AS count FROM evidence_frontiers WHERE run_id=$1',[run.runId])).rows[0].count).toBe(2);
  });
  it.each(['missing-plan','decision-digest','decision-mismatch','dangling-fact'])('rejects %s during report reads and recovers the valid snapshot after rollback/restart',async fault=>{
    const {pool,store,run,first,caseId}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']}}]);
    await store.recordResultReceipt(e.result,e.observation,requestedLoop(run.runId,e.hash));
    const valid=await readCaseReport(pool,caseId),client=await pool.connect();
    try {
      await client.query('BEGIN');
      if(fault==='missing-plan' || fault==='dangling-fact') {
        // Fault injection in this transaction/owned suite schema only; rollback restores the trigger and receipt.
        await client.query('ALTER TABLE hypothesis_plans DISABLE TRIGGER hypothesis_plan_no_mutation');
        if(fault==='missing-plan')await client.query('DELETE FROM hypothesis_plans WHERE run_id=$1',[run.runId]);
        else {
          const plan=(await client.query('SELECT payload FROM hypothesis_plans WHERE run_id=$1',[run.runId])).rows[0].payload;
          plan.selectedFactIds=['FACT-invented'];
          await client.query('UPDATE hypothesis_plans SET payload=$2,payload_hash=$3 WHERE run_id=$1',[run.runId,plan,sha256Canonical(plan)]);
        }
      }else {
        const decision=(await client.query('SELECT payload FROM next_step_decisions WHERE run_id=$1',[run.runId])).rows[0].payload;
        decision.rationale='Corrupted fixture decision, not an authorized transition';
        await client.query('UPDATE next_step_decisions SET payload=$2,payload_hash=$3 WHERE run_id=$1',
          [run.runId,decision,fault==='decision-digest'?'0'.repeat(64):sha256Canonical(decision)]);
      }
      await expect(readCaseInvestigationSnapshot(client,caseId)).rejects.toMatchObject({statusCode:409});
    }finally {await client.query('ROLLBACK');client.release();}
    const restarted=connection();expect((await readCaseReport(restarted.pool,caseId)).investigation).toEqual(valid.investigation);
    expect((await pool.query('SELECT count(*)::int AS count FROM hypothesis_plans WHERE run_id=$1',[run.runId])).rows[0].count).toBe(1);
  });
  it('reads a bounded authority case timeline through restart/replay and rejects a damaged projection',async()=>{
    const {pool,store,run,first,caseId}=await setup(),e=await envelope(pool,first,[
      {principal:{ip:['203.0.113.1']},metadata:{event_timestamp:'2026-10-10T12:00:00+07:00'}},{}]);
    const input=requestedLoop(run.runId,e.hash);await store.recordResultReceipt(e.result,e.observation,input);
    const timeline=await readCaseTimeline(pool,caseId);
    expect(timeline).toMatchObject({completedQueryCount:1,unprojectedQueryCount:0,inputEventCount:2,uncertainTimeCount:1});
    expect(timeline.sources[0].artifactHash).toBe(e.hash);
    const report=await readCaseReport(pool,caseId);
    expect(report).toMatchObject({schemaVersion:'gss.case-report.v1',caseId,analystReview:'REQUIRED',timeline});
    expect(report.investigation?.frontier?.version).toBe(report.investigation?.run.frontierVersion);
    if(!report.investigation?.frontier)throw new Error('Expected retained fixture frontier');
    expect(report.investigation.hypothesisPlan?.caseId).toBe(caseId);
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
    const restarted=connection();await restarted.store.recordResultReceipt(e.result,e.observation,input);
    expect(await readCaseTimeline(restarted.pool,caseId)).toEqual(timeline);
    await pool.query(`UPDATE runtime_executions SET result=jsonb_set(result,'{timeline,entries,0,eventId}','"tampered"'::jsonb) WHERE task_id=$1`,[first.taskId]);
    await expect(readCaseTimeline(pool,caseId)).rejects.toMatchObject({statusCode:409,message:'timeline_integrity_failed'});
    await expect(readCaseReport(pool,caseId)).rejects.toMatchObject({statusCode:409,message:'timeline_integrity_failed'});
    await expect(readCaseTimeline(pool,'unknown-case')).rejects.toMatchObject({statusCode:404});
  });
  it('does not expose caller-authored legacy timelines as authority projections',async()=>{
    const {pool}=connection(),store=new PostgresRuntimeStore(pool,{socEvidence:false,siemReadOnlyAuthorized:false});
    const caseId='legacy-timeline-'+randomUUID(),first=task(caseId);await store.createTask(first,'fixture');
    const e=await envelope(pool,first,[]);e.result.result.timeline={entries:[{eventId:'invented'}]};
    await store.recordResultReceipt(e.result);
    const timeline=await readCaseTimeline(pool,caseId);
    expect(timeline).toMatchObject({completedQueryCount:1,unprojectedQueryCount:1,partial:true,entries:[],sources:[]});
  });
  it('authority replaces caller timeline and retains hash-bound event-time uncertainty after restart/replay',async()=>{
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[
      {principal:{ip:['203.0.113.1']},metadata:{event_timestamp:'2026-10-10T12:00:00+07:00'}},
      {metadata:{event_timestamp:'2026-02-30T12:00:00Z'}},{}]);
    e.result.result.timeline={entries:[{eventId:'model-created',occurredAt:'invented'}]};
    const input=requestedLoop(run.runId,e.hash);await store.recordResultReceipt(e.result,e.observation,input);
    const read=async(p:Pool)=>(await p.query('SELECT result FROM runtime_executions WHERE task_id=$1',[first.taskId])).rows[0].result.timeline;
    const stored=await read(pool);
    expect(stored).toMatchObject({schemaVersion:'gss.evidence-timeline.v1',artifactHash:e.hash,sourceKind:'CHRONICLE_UNATTESTED',
      inputCount:3,uncertainTimeCount:2,entries:[{eventId:'fixture-event-0',timeStatus:'VALID'},
        {eventId:'fixture-event-1',timeStatus:'INVALID'},{eventId:'fixture-event-2',timeStatus:'MISSING'}]});
    const restarted=connection();expect(await read(restarted.pool)).toEqual(stored);
    expect((await restarted.store.recordResultReceipt(e.result,e.observation,input)).replay).toBe(true);
    expect(await read(restarted.pool)).toEqual(stored);expect(e.result.result.timeline).toEqual({entries:[{eventId:'model-created',occurredAt:'invented'}]});
  });
  it('retains adapter field-loss processing provenance in durable plans after restart/replay',async()=>{
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']},target:{ip:['203.0.113.2']}}],false,true);
    const input=requestedLoop(run.runId,e.hash),committed=(await store.recordResultReceipt(e.result,e.observation,input)).loop!;
    expect(committed.frontier.facts.some(f=>f.key.startsWith('soc.extraction.') && f.value==='PROVIDER_FIELD_LIMIT')).toBe(true);
    expect(committed.hypothesisPlan?.coverage?.partialExtractionEvidenceIds).toEqual([...e.result.evidenceRefs].sort());
    expect(committed.hypothesisPlan?.coverage?.limitations).toContain('PARTIAL_EXTRACTION');
    expect(committed.hypothesisPlan?.hypotheses.some(h=>h.gap==='UNRECOGNIZED_VALUE')).toBe(true);
    const restarted=connection();expect(await restarted.store.getHypothesisPlan(run.runId,1)).toEqual(committed.hypothesisPlan);
    expect((await restarted.store.recordResultReceipt(e.result,e.observation,input)).replay).toBe(true);
  });
  it('takes three evidence-driven steps, changes target from discovered entities, reopens store connections and replays without duplicate transitions',async()=>{
    let {pool,store,caseId,run,first}=await setup();
    expect(run.policyVersion).toBe(SOC_EVIDENCE_POLICY_VERSION);
    let current=first;const envelopes=[];
    for(let step=0;step<3;step++) {
      const value=String(current.parameters.indicatorValue),next=step<2?'203.0.113.'+(step+2):undefined;
      const e=await envelope(pool,current,[{principal:{ip:[value]},...(next?{target:{ip:[next]}}:{})}]);
      const input=requestedLoop(run.runId,e.hash);envelopes.push({task:current,...e,input});
      const committed=(await store.recordResultReceipt(e.result,e.observation,input)).loop!;
      expect(committed.frontier.version).toBe(step+1);expect(committed.hypothesisPlan?.selectedEvidenceIds.every(id=>committed.frontier.evidenceRefs.includes(id))).toBe(true);
      expect(committed.frontier.facts.some(f=>f.value==='192.0.2.99' || f.key==='soc.compromise.confirmed')).toBe(false);
      expect(committed.decision.kind).toBe(step<2?'DISPATCH':'BLOCKED');
      expect(committed.outbox.payload.hypothesisPlanId).toBe(committed.hypothesisPlan?.planId);
      const receipt=await store.getHypothesisPlan(run.runId,step+1);expect(receipt).toEqual(committed.hypothesisPlan);
      const restarted=connection();pool=restarted.pool;store=restarted.store;
      expect((await store.getEvidenceFrontier(run.runId))?.version).toBe(step+1);
      const replays=await Promise.all([store.recordResultReceipt(e.result,e.observation,input),store.recordResultReceipt(e.result,e.observation,input)]);
      expect(replays.every(r=>r.replay && r.loop?.created===false)).toBe(true);
      if(next) {
        const claims=await store.claimPendingDispatches('fixture-restart',1,[committed.outbox.eventId]);
        expect(claims).toHaveLength(1);expect(claims[0].loop.hypothesisPlan).toEqual(committed.hypothesisPlan);
        expect(await store.markOutboxPublished(committed.outbox.eventId,'fixture-restart')).toBe(true);
        expect(committed.decision.action?.parameters.indicatorValue).toBe(next);
        current=task(caseId,next,committed.decision.action!.parameters);
        await store.createTask(current,'fixture',{runId:run.runId,parentTaskId:envelopes[step].task.taskId,actionFingerprint:committed.decision.action!.fingerprint});
      }
    }
    const old=envelopes[0];expect((await store.recordResultReceipt(old.result,old.observation,old.input)).replay).toBe(true);
    const counts=(await pool.query(`SELECT
      (SELECT count(*) FROM evidence_frontiers WHERE run_id=$1)::int AS frontiers,
      (SELECT count(*) FROM next_step_decisions WHERE run_id=$1)::int AS decisions,
      (SELECT count(*) FROM hypothesis_plans WHERE run_id=$1)::int AS plans,
      (SELECT count(*) FROM control_outbox WHERE aggregate_id=$1)::int AS outbox`,[run.runId])).rows[0];
    expect(counts).toEqual({frontiers:3,decisions:3,plans:3,outbox:4});
    expect((await store.getInvestigationRun(run.runId))?.state).toBe('BLOCKED');
    await expect(pool.query('UPDATE hypothesis_plans SET payload=$1 WHERE run_id=$2',[{},run.runId])).rejects.toThrow('immutable');
  });
  it('rolls back the result, observation, Frontier and decision when evidence artifact hash does not match',async()=>{
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']}}]);
    await expect(store.recordResultReceipt({...e.result,result:{...e.result.result,sha256:'b'.repeat(64)}},e.observation,requestedLoop(run.runId,e.hash)))
      .rejects.toThrow('artifact_hash_mismatch');
    expect((await pool.query('SELECT 1 FROM runtime_executions WHERE task_id=$1',[first.taskId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM observation_packs WHERE task_id=$1',[first.taskId])).rowCount).toBe(0);
    expect(await store.getEvidenceFrontier(run.runId)).toBeNull();
    expect((await store.getInvestigationRun(run.runId))?.frontierVersion).toBe(0);
  });
  it('persists partial extraction and omitted-candidate coverage unchanged across restart/replay',async()=>{
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:Array.from({length:21},(_,i)=>'203.0.113.'+(i+1))}}]);
    const input=requestedLoop(run.runId,e.hash),committed=(await store.recordResultReceipt(e.result,e.observation,input)).loop!;
    expect(committed.hypothesisPlan?.coverage).toMatchObject({discoveredIndicators:20,evaluatedIndicators:16,omittedIndicators:4,
      partialExtractionEvidenceIds:[...e.result.evidenceRefs].sort(),limitations:['CANDIDATE_LIMIT','PARTIAL_EXTRACTION']});
    expect(committed.frontier.facts.some(f=>f.key.startsWith('soc.extraction.') && f.value==='FIELD_ARRAY_LIMIT')).toBe(true);
    const restarted=connection();expect(await restarted.store.getHypothesisPlan(run.runId,1)).toEqual(committed.hypothesisPlan);
    const replay=await restarted.store.recordResultReceipt(e.result,e.observation,input);
    expect(replay.replay).toBe(true);expect(replay.loop?.hypothesisPlan).toEqual(committed.hypothesisPlan);
  });
  it('rolls back all evidence/decisions when hypothesis receipt persistence fails',async()=>{
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']},target:{ip:['203.0.113.2']}}]);
    const trigger='reject_plan_'+randomUUID().replaceAll('-','');
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.run_id='${run.runId}' THEN RAISE EXCEPTION 'fixture_receipt_write_failure'; END IF; RETURN NEW; END; $$`);
    await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON hypothesis_plans FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    try {
      await expect(store.recordResultReceipt(e.result,e.observation,requestedLoop(run.runId,e.hash))).rejects.toThrow('receipt_write_failure');
      expect((await pool.query('SELECT 1 FROM runtime_executions WHERE task_id=$1',[first.taskId])).rowCount).toBe(0);
      expect(await store.getEvidenceFrontier(run.runId)).toBeNull();
      expect((await pool.query('SELECT 1 FROM next_step_decisions WHERE run_id=$1',[run.runId])).rowCount).toBe(0);
    } finally {await pool.query(`DROP TRIGGER ${trigger} ON hypothesis_plans`);await pool.query(`DROP FUNCTION ${trigger}()`);}
  });
  it('authority recomputes SOC verdict, ignores caller-confirmed claims and preserves replay hashes',async()=>{
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']},security_result:[{severity:'HIGH'},{severity:'HIGH'}]},{}]);
    e.result.result.verdict={incidentId:first.caseId,taskId:first.taskId,verdict:'CONFIRMED',evidenceIds:e.result.evidenceRefs,
      policyVersion:'caller-invented',rationale:'Model claims confirmation',createdAt:new Date().toISOString()};
    const input=requestedLoop(run.runId,e.hash);await store.recordResultReceipt(e.result,e.observation,input);
    const row=(await pool.query('SELECT verdict,policy_version FROM runtime_investigation_verdicts WHERE task_id=$1',[first.taskId])).rows[0];
    expect(row).toEqual({verdict:'SUSPICIOUS',policy_version:'gss.deterministic-verdict.v2'});
    const stored=(await pool.query('SELECT result FROM runtime_executions WHERE task_id=$1',[first.taskId])).rows[0];
    expect(stored.result.verdict.verdict).toBe('SUSPICIOUS');expect(e.result.result.verdict).toMatchObject({verdict:'CONFIRMED'});
    expect((await connection().store.recordResultReceipt(e.result,e.observation,input)).replay).toBe(true);
  });
  it('stores zero-result uncertainty without a benign conclusion and blocks unavailable SIEM dispatch',async()=>{
    for(const [available,events] of [[true,[]],[false,[{principal:{ip:['203.0.113.1']},target:{ip:['203.0.113.2']}}]]] as const) {
      const {pool,store,run,first}=await setup(available),e=await envelope(pool,first,[...events]);
      const c=(await store.recordResultReceipt(e.result,e.observation,requestedLoop(run.runId,e.hash))).loop!;
      expect(c.decision.kind).toBe('BLOCKED');expect(c.decision.action).toBeUndefined();
      expect(c.frontier.facts.some(f=>f.key==='verdict' || f.value==='BENIGN')).toBe(false);
    }
  });
  it('blocks repeated/truncated questions and depth/cost/query/deadline exhaustion inside authority',async()=>{
    for(const update of ["depth=max_depth","cost_micros_used=max_cost_micros","external_queries_used=max_external_queries","deadline_at=now()-interval '1 second'"]) {
      const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']},target:{ip:['203.0.113.2']}}]);
      await pool.query(`UPDATE investigation_runs SET ${update} WHERE run_id=$1`,[run.runId]);
      const c=(await store.recordResultReceipt(e.result,e.observation,requestedLoop(run.runId,e.hash))).loop!;
      expect(c.decision.kind).toBe('BLOCKED');expect(c.hypothesisPlan?.selectedFactIds).toEqual([]);
    }
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']}}],true);
    const c=(await store.recordResultReceipt(e.result,e.observation,requestedLoop(run.runId,e.hash))).loop!;
    expect(c.hypothesisPlan?.hypotheses[0].gap).toBe('UNRECOGNIZED_VALUE');
  });
  it('refuses a SOC run without its authority-owned hypothesis policy',async()=>{
    const {pool,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']}}]);
    const loops=new PostgresInvestigationLoopStore(pool);
    await expect(loops.commitObservationAndDecision({runId:run.runId,source:'siem',artifactHash:e.hash,observation:e.observation,
      proposal:requestedLoop(run.runId,e.hash).proposal})).rejects.toThrow('authority policy unavailable');
    expect(await loops.getFrontier(run.runId)).toBeNull();
  });
  it('rejects caller omission of the SOC loop and persists provider failure without evidence or hypothesis',async()=>{
    const {pool,store,run,first}=await setup(),e=await envelope(pool,first,[{principal:{ip:['203.0.113.1']}}]);
    await expect(store.recordResultReceipt(e.result,e.observation)).rejects.toThrow('verified_siem_observation');
    const failed:GssResultContract={...e.result,status:'FAILED',result:{summary:'Provider unavailable'},evidenceRefs:[],errors:[{code:'UPSTREAM_TIMEOUT',message:'fixture'}]};
    await expect(store.recordResultReceipt(failed,e.observation)).rejects.toThrow('cannot_create_evidence');
    for(const status of ['FAILED','BLOCKED','CANCELLED'] as const) {
      await expect(store.recordResultReceipt({...failed,status,result:{...failed.result,timeline:{entries:[{eventId:'fabricated'}]}}}))
        .rejects.toThrow('cannot_create_evidence');
    }
    expect(await store.recordResultReceipt(failed)).toEqual({replay:false});
    expect(await store.getEvidenceFrontier(run.runId)).toBeNull();
    expect((await pool.query('SELECT 1 FROM hypothesis_plans WHERE run_id=$1',[run.runId])).rowCount).toBe(0);
  });
});
