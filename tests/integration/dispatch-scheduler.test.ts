import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PostgresRuntimeStore} from '../../packages/persistence/src/runtime-store.ts';
import {PostgresDispatchQueue} from '../../packages/persistence/src/dispatch-queue.ts';
import {PostgresInvestigationLoopStore} from '../../packages/persistence/src/loop-store.ts';
import type {GssTaskContract,ObservationPack} from '../../packages/sdk/src/index.ts';

const enabled=Boolean(process.env.DATABASE_URL);let schema='';
let admin:Pool,db:Pool,store:PostgresRuntimeStore,queue:PostgresDispatchQueue;
function task():GssTaskContract {return {schemaVersion:'gss.task.v1',taskId:randomUUID(),caseId:randomUUID(),
  idempotencyKey:randomUUID(),source:'standalone',target:'cli',action:'inspect_hostname',parameters:{},riskLevel:'read_only',
  contextRefs:[],timeoutMs:15000,createdAt:new Date().toISOString()};}
async function create(t=task()) {await store.createTask(t,'test');return t;}
beforeAll(async()=>{
  if(!enabled)return;
  admin=new Pool({connectionString:process.env.DATABASE_URL});
  vi.stubEnv('GSS_BOUNDED_DISPATCH','true');vi.stubEnv('GSS_INVESTIGATION_POLICY','gss.deterministic-planner.v1');
},30000);
beforeEach(async()=>{
  if(!enabled)return;
  if(schema){await queue.close();await db.end();
    if(!/^gss_scheduler_[a-f0-9]{32}$/.test(schema))throw new Error('Unsafe test cleanup');
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);}
  schema='gss_scheduler_'+randomUUID().replaceAll('-','');
  if(!/^gss_scheduler_[a-f0-9]{32}$/.test(schema))throw new Error('Unsafe test schema');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('options','-c search_path='+schema);
  db=new Pool({connectionString:url.toString()});
  for(const f of (await readdir(resolve('infra/postgres/migrations'))).filter(f=>f.endsWith('.sql')).sort())
    await db.query(await readFile(resolve('infra/postgres/migrations',f),'utf8'));
  vi.stubEnv('GSS_BOUNDED_DISPATCH','true');
  store=new PostgresRuntimeStore(db);await store.ready();queue=new PostgresDispatchQueue(db);await queue.start();
},30000);
afterAll(async()=>{
  await queue?.close();await db?.end();
  if(admin){if(!/^gss_scheduler_[a-f0-9]{32}$/.test(schema))throw new Error('Unsafe cleanup');
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
  vi.unstubAllEnvs();
},30000);

describe.skipIf(!enabled)('durable bounded dispatch on isolated PostgreSQL',()=>{
  it('gives one run to concurrent owners and preserves it across restart/expired lease',async()=>{
    const first=await create(),second=await create();
    const claims=(await Promise.all([store.claimInitialDispatches('a'),store.claimInitialDispatches('b')])).flat();
    expect(claims).toHaveLength(1);expect(claims[0].task.taskId).toBe(first.taskId);
    await db.query("UPDATE control_outbox SET locked_at=now()-interval '70 seconds'");
    const restarted=new PostgresRuntimeStore(db);await restarted.ready();
    const replay=await restarted.claimInitialDispatches('restart');
    expect(replay.map(c=>c.task.taskId)).toEqual([first.taskId]);
    await expect(store.updateTask(second.taskId,'DISPATCHED')).rejects.toThrow('investigation_dispatch_slot_unavailable');
    await store.updateTask(first.taskId,'DISPATCHED');await store.markOutboxPublished(replay[0].eventId,'restart');
    expect(await store.claimInitialDispatches('while-running')).toEqual([]);
    await store.updateTask(first.taskId,'FAILED');
    expect((await store.claimInitialDispatches('after-terminal')).map(c=>c.task.taskId)).toEqual([second.taskId]);
  });
  it('bounds logical work, permits full-queue replay, and creates no rejected case/task/outbox',async()=>{
    const inputs=await Promise.all(Array.from({length:32},()=>create()));
    const extra=task();await expect(create(extra)).rejects.toThrow('dispatch_queue_capacity_exhausted');
    expect(await store.createTask(inputs[0],'test')).toEqual({created:false});
    const counts=(await db.query(`SELECT (SELECT count(*) FROM runtime_tasks)::int AS tasks,
      (SELECT count(*) FROM control_outbox)::int AS intents,(SELECT count(*) FROM cases WHERE case_id=$1)::int AS rejected`,[extra.caseId])).rows[0];
    expect(counts).toEqual({tasks:32,intents:32,rejected:0});
    await expect(store.createTask({...inputs[0],parameters:{changed:true}},'test')).rejects.toThrow('idempotency_key_payload_mismatch');
  });
  it('does not silently disable a persisted gate or accept multiple running investigations',async()=>{
    const first=await create(),second=await create();
    vi.stubEnv('GSS_BOUNDED_DISPATCH','false');vi.stubEnv('GSS_SOC_PROFILE','staging');
    const legacy=new PostgresRuntimeStore(db);await legacy.ready();
    const claims=await legacy.claimInitialDispatches('legacy');expect(claims).toHaveLength(1);
    await expect(legacy.updateTask(second.taskId,'RUNNING')).rejects.toThrow('investigation_dispatch_slot_unavailable');
    await db.query("UPDATE runtime_tasks SET status='RUNNING' WHERE task_id=ANY($1::text[])",[[first.taskId,second.taskId]]);
    await expect(legacy.claimInitialDispatches('conflict')).rejects.toThrow('dispatch_concurrency_state_conflict');
    vi.stubEnv('GSS_BOUNDED_DISPATCH','true');
    await expect(legacy.ready()).rejects.toThrow('scheduler_activation_requires_quiescent_runtime');
  });
  it('rejects activation on an oversized legacy backlog without deleting or rewriting tasks',async()=>{
    await db.query('UPDATE dispatch_scheduler_state SET enabled=false');
    const inputs=await Promise.all(Array.from({length:33},()=>create()));
    await expect(store.ready()).rejects.toThrow('scheduler_activation_requires_bounded_backlog');
    expect((await db.query('SELECT enabled FROM dispatch_scheduler_state')).rows[0].enabled).toBe(false);
    expect(Number((await db.query('SELECT count(*) FROM runtime_tasks')).rows[0].count)).toBe(inputs.length);
  });
  it('shares the same run slot between initial and follow-up queues without starving evidence continuation',async()=>{
    const first=await create(),second=await create();
    const initial=(await store.claimInitialDispatches('start'))[0];await store.updateTask(first.taskId,'DISPATCHED');
    await store.markOutboxPublished(initial.eventId,'start');
    const observation:ObservationPack={observationId:randomUUID(),caseId:first.caseId,taskId:first.taskId,summary:'Fixture host observation',
      facts:[{key:'fixture.hostname',value:'test-host'}],evidenceRefs:['fixture-evidence'],originalBytes:10,packedBytes:10,createdAt:new Date().toISOString()};
    const loop=await store.recordResult({schemaVersion:'gss.result.v1',taskId:first.taskId,caseId:first.caseId,executor:'cli',
      status:'COMPLETED',result:{summary:'Fixture only'},evidenceRefs:['fixture-evidence'],errors:[],metrics:{durationMs:1,outputBytes:10},completedAt:new Date().toISOString()},
      observation,{runId:initial.runId!,source:'cli',proposal:{kind:'DISPATCH',reasonCode:'FIXTURE_NEXT',rationale:'Fixture read-only next step',
        action:{target:'cli',action:'inspect_system',parameters:{},riskLevel:'read_only'}}});
    expect(loop?.decision.kind).toBe('DISPATCH');expect(await store.claimInitialDispatches('no-other-run')).toEqual([]);
    const acquired=await queue.acquire('decision',25);
    const next=await store.claimPendingDispatches('continue',25,acquired.eventIds);await acquired.settle(next.map(c=>c.loop.outbox.eventId));
    expect(next).toHaveLength(1);expect(next[0].loop.run.runId).toBe(initial.runId);
    const follow:GssTaskContract={...first,taskId:'TSK-'+loop!.decision.decisionId.slice(4),idempotencyKey:'decision:'+loop!.decision.decisionId,action:'inspect_system'};
    await store.createTask(follow,'test',{runId:initial.runId,parentTaskId:first.taskId,actionFingerprint:loop!.decision.action!.fingerprint});
    await store.updateTask(follow.taskId,'DISPATCHED');await store.markOutboxPublished(loop!.outbox.eventId,'continue');
    expect(await store.claimInitialDispatches('still-same-run')).toEqual([]);
    await store.updateTask(follow.taskId,'FAILED');
    expect((await store.claimInitialDispatches('advance')).map(c=>c.task.taskId)).toEqual([second.taskId]);
  });
  it('retains slot across retry/backoff and pg-boss restart; a timeout is not success/evidence',async()=>{
    const first=await create();await create();
    const acquired=await queue.acquire('initial',25),claims=await store.claimInitialDispatches('q',25,acquired.eventIds);
    await acquired.settle(claims.map(c=>c.eventId));expect(claims).toHaveLength(1);
    await store.releaseOutbox(claims[0].eventId,'q','fixture offline',new Date(Date.now()+60000).toISOString());
    await queue.close();queue=new PostgresDispatchQueue(db);await queue.start();
    const empty=await queue.acquire('initial',25);expect(empty.eventIds).toEqual([]);await empty.settle([]);
    await db.query('UPDATE control_outbox SET next_attempt_at=now() WHERE event_id=$1',[claims[0].eventId]);
    expect((await store.claimInitialDispatches('retry')).map(c=>c.task.taskId)).toEqual([first.taskId]);
    expect(Number((await db.query('SELECT count(*) FROM evidence_frontiers')).rows[0].count)).toBe(0);
  });
  it('rolls back result/frontier/outbox when capacity is unavailable; replay succeeds after space frees',async()=>{
    const first=await create(),initial=(await store.claimInitialDispatches('start'))[0];
    await store.markOutboxPublished(initial.eventId,'start');await store.updateTask(first.taskId,'FAILED');
    await Promise.all(Array.from({length:32},()=>create()));
    const loopStore=new PostgresInvestigationLoopStore(db),observation:ObservationPack={observationId:randomUUID(),caseId:first.caseId,
      taskId:first.taskId,summary:'Fixture only',facts:[{key:'fixture',value:'x'}],evidenceRefs:['fixture'],originalBytes:1,packedBytes:1,createdAt:new Date().toISOString()};
    const input={runId:initial.runId!,observation,source:'cli',proposal:{kind:'DISPATCH' as const,reasonCode:'FIXTURE',rationale:'Fixture',
      action:{target:'cli' as const,action:'inspect_system' as const,parameters:{},riskLevel:'read_only' as const}}};
    await expect(loopStore.commitObservationAndDecision(input)).rejects.toThrow('dispatch_queue_capacity_exhausted');
    expect(Number((await db.query('SELECT count(*) FROM evidence_frontiers')).rows[0].count)).toBe(0);
    const row=(await db.query("SELECT task_id FROM runtime_tasks WHERE status='QUEUED' LIMIT 1")).rows[0];
    await db.query("UPDATE runtime_tasks SET status='FAILED' WHERE task_id=$1",[row.task_id]);
    await db.query("UPDATE control_outbox SET published_at=now() WHERE payload->'task'->>'taskId'=$1",[row.task_id]);
    expect((await loopStore.commitObservationAndDecision(input)).created).toBe(true);
    expect((await loopStore.commitObservationAndDecision(input)).created).toBe(false);
  });
  it.each(['initial','decision'] as const)('retires an expired %s intent atomically, without evidence or re-execution',async kind=>{
    const first=await create(),second=await create(),initial=(await store.claimInitialDispatches('start'))[0];
    let retiredTask=first.taskId;
    if(kind==='decision') {
      await store.markOutboxPublished(initial.eventId,'start');await store.updateTask(first.taskId,'FAILED');
      const loopStore=new PostgresInvestigationLoopStore(db);
      const loop=await loopStore.commitObservationAndDecision({runId:initial.runId!,source:'cli',
        observation:{observationId:randomUUID(),caseId:first.caseId,taskId:first.taskId,summary:'Fixture, not actual telemetry',
          facts:[{key:'fixture',value:'x'}],evidenceRefs:['fixture'],originalBytes:1,packedBytes:1,createdAt:new Date().toISOString()},
        proposal:{kind:'DISPATCH',reasonCode:'FIXTURE',rationale:'Fixture read-only',action:{target:'cli',action:'inspect_system',parameters:{},riskLevel:'read_only'}}});
      const follow:GssTaskContract={...first,taskId:'TSK-'+loop.decision.decisionId.slice(4),idempotencyKey:'decision:'+loop.decision.decisionId,action:'inspect_system'};
      await store.createTask(follow,'test',{runId:initial.runId,parentTaskId:first.taskId,actionFingerprint:loop.decision.action!.fingerprint});
      retiredTask=follow.taskId;
    } else await store.releaseOutbox(initial.eventId,'start','fixture retry',new Date().toISOString());
    await db.query("UPDATE investigation_runs SET deadline_at=now()-interval '1 second' WHERE run_id=$1",[initial.runId]);
    await expect(store.updateTask(retiredTask,'DISPATCHED')).rejects.toThrow('investigation_inactive_or_expired');
    const noDispatch=kind==='initial'?await store.claimInitialDispatches('expired'):await store.claimPendingDispatches('expired');
    expect(noDispatch).toEqual([]);
    expect((await db.query('SELECT status FROM runtime_tasks WHERE task_id=$1',[retiredTask])).rows[0].status).toBe('CANCELLED');
    expect((await store.claimInitialDispatches('next')).map(c=>c.task.taskId)).toEqual([second.taskId]);
    expect(Number((await db.query('SELECT count(*) FROM runtime_executions')).rows[0].count)).toBe(0);
    expect(Number((await db.query('SELECT count(*) FROM evidence_frontiers')).rows[0].count)).toBe(kind==='initial'?0:1);
    expect(Number((await db.query("SELECT count(*) FROM audit_events WHERE event_type='DISPATCH_RETIRED'")).rows[0].count)).toBe(1);
  });
});
