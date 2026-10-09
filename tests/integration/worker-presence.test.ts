import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,basename,resolve } from 'node:path';
import { Pool } from 'pg';
import { PostgresWorkerPresenceStore,PostgresRuntimeStore,PostgresControlStateStore } from '@asq/persistence';
import type { WorkerConnectionInput,WorkerHeartbeatInput } from '@asq/persistence';
import { ASQWebSocketClient,TokenSigner } from '@asq/sdk';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
import { CentralCommandOrchestrator } from '../../services/standalone/src/command-center.ts';
import { HttpControlPlaneClient } from '../../services/standalone/src/control-plane-client.ts';
import { authorizeOperator } from '../../services/control-plane/src/identity.ts';

const enabled=Boolean(process.env.DATABASE_URL);
let db:Pool,fleet:PostgresWorkerPresenceStore,runtime:PostgresRuntimeStore,control:PostgresControlStateStore;
let cpServer:ControlPlaneServer,cc:CentralCommandOrchestrator,client:ASQWebSocketClient,spool:string;
const token='worker-presence-fixture-service-token-32chars';
let base:string;
const connection=(workerId='cli-worker-agent',role='CLI_DAEMON'):WorkerConnectionInput=>({workerId,role,connectionId:randomUUID(),observerId:'fixture-'+randomUUID()});
const heartbeat=(input:WorkerConnectionInput,sequence=1):WorkerHeartbeatInput=>({...input,executionId:randomUUID(),sequence,readiness:'READY'});
async function expire(input:WorkerConnectionInput) {
  // Simulates lease expiry using DB time; no wall-clock sleep and no runtime DB mutation.
  await db.query("UPDATE worker_connections SET lease_until=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[input.connectionId]);
}
beforeAll(async()=>{
  if(!enabled) return;
  if(!new URL(process.env.DATABASE_URL!).searchParams.get('options')?.includes('gss_suite_')) throw new Error('isolated PostgreSQL runner required');
  vi.stubEnv('GSS_REQUIRE_WORKER_PRESENCE','true');vi.stubEnv('GSS_CONTROL_PLANE_TOKEN',token);
  db=new Pool({connectionString:process.env.DATABASE_URL});fleet=new PostgresWorkerPresenceStore(db);
  runtime=new PostgresRuntimeStore(db);control=new PostgresControlStateStore(db);
  cpServer=new ControlPlaneServer(0);base='http://127.0.0.1:'+await cpServer.ready();
},20000);
afterAll(async()=>{client?.disconnect();await cc?.close();await cpServer?.close();await db?.end();
  if(spool && dirname(resolve(spool))===resolve(tmpdir()) && basename(spool).startsWith('gss-fleet-')) await rm(spool,{recursive:true,force:true});vi.unstubAllEnvs();});

describe.skipIf(!enabled)('durable worker presence, live PostgreSQL authority',()=>{
  it('does not infer online workers from historical audit; registry roles/capabilities are fixed',async()=>{
    const rows=await fleet.list();expect(rows).toHaveLength(3);
    expect(rows.find(w=>w.workerId==='siem-worker-agent')).toMatchObject({presence:'UNKNOWN',reportedReadiness:'UNKNOWN',activeTasks:0});
    await expect(fleet.register(connection('cli-worker-agent','SIEM'))).rejects.toThrow('worker_role_denied');
    await expect(fleet.register(connection('unregistered-worker'))).rejects.toThrow('worker_role_denied');
    await expect(fleet.register({...connection(),observerId:'invalid identity'})).rejects.toThrow('invalid_worker_identity');
  });
  it('serializes concurrent registration, replays without extending lease, retains immutable history',async()=>{
    const inputs=[connection(),connection()];
    const results=await Promise.allSettled(inputs.map(i=>fleet.register(i)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const winner=inputs[results.findIndex(r=>r.status==='fulfilled')];
    const before=(await db.query('SELECT lease_until FROM worker_connections WHERE connection_id=$1',[winner.connectionId])).rows[0];
    expect(await fleet.register(winner)).toMatchObject({replay:true});
    expect((await db.query('SELECT lease_until FROM worker_connections WHERE connection_id=$1',[winner.connectionId])).rows[0]).toEqual(before);
    await expect(db.query('UPDATE worker_connections SET observer_id=$2 WHERE connection_id=$1',[winner.connectionId,'tampered'])).rejects.toThrow('worker_connection_binding_immutable');
    await fleet.disconnect(winner);
  });
  it('accepts monotonically increasing heartbeats; duplicate does not extend lease and different body conflicts',async()=>{
    const input=connection();await fleet.register(input);const hb=heartbeat(input);
    await fleet.heartbeat(hb);
    const before=(await db.query('SELECT lease_until FROM worker_connections WHERE connection_id=$1',[input.connectionId])).rows[0];
    expect(await fleet.heartbeat(hb)).toMatchObject({replay:true});
    expect((await db.query('SELECT lease_until FROM worker_connections WHERE connection_id=$1',[input.connectionId])).rows[0]).toEqual(before);
    await expect(fleet.heartbeat({...hb,readiness:'BUSY'})).rejects.toThrow('worker_heartbeat_payload_mismatch');
    await expect(fleet.heartbeat({...hb,sequence:2,executionId:randomUUID()})).rejects.toThrow('worker_execution_binding_mismatch');
    await fleet.heartbeat({...hb,sequence:2,readiness:'BLOCKED'});
    await expect(fleet.heartbeat(hb)).rejects.toThrow('worker_heartbeat_replayed');
    await expect(fleet.heartbeat({...hb,sequence:0})).rejects.toThrow('invalid_worker_heartbeat');
    expect((await fleet.list()).find(w=>w.workerId===input.workerId)).toMatchObject({presence:'ONLINE',reportedReadiness:'BLOCKED'});
    await fleet.disconnect(input);
  });
  it('expires presence across restart; a fenced heartbeat/disconnect cannot change a new session',async()=>{
    const input=connection();await fleet.register(input);const hb=heartbeat(input);await fleet.heartbeat(hb);await expire(input);
    const restarted=new PostgresWorkerPresenceStore(db);
    expect((await restarted.list()).find(w=>w.workerId===input.workerId)?.presence).toBe('STALE');
    await expect(restarted.heartbeat({...hb,sequence:2})).rejects.toThrow('worker_connection_fenced');
    const next=connection();await restarted.register(next);await restarted.heartbeat(heartbeat(next));
    await expect(restarted.register(input)).rejects.toThrow('worker_connection_fenced');
    expect(await restarted.disconnect(input)).toEqual({closed:false});
    expect((await restarted.list()).find(w=>w.workerId===input.workerId)?.presence).toBe('ONLINE');
    await restarted.disconnect(next);
  });
  it('gates physical acceptance on fresh connection/execution/readiness, never reexecutes on restart',async()=>{
    const input=connection();await fleet.register(input);const hb=heartbeat(input);await fleet.heartbeat(hb);
    const task={schemaVersion:'gss.task.v1' as const,taskId:randomUUID(),caseId:'fleet-'+randomUUID(),idempotencyKey:randomUUID(),
      source:'standalone' as const,target:'cli' as const,action:'inspect_hostname' as const,parameters:{},contextRefs:[],
      riskLevel:'read_only' as const,timeoutMs:15000,createdAt:new Date().toISOString()};
    await runtime.createTask(task,'fixture');await runtime.updateTask(task.taskId,'DISPATCHED',input.workerId);
    expect(await control.acceptTask(task.taskId,task.caseId,input.workerId,hb.executionId,'forged')).toMatchObject({accepted:false});
    await fleet.heartbeat({...hb,sequence:2,readiness:'HALTED'});
    expect(await control.acceptTask(task.taskId,task.caseId,input.workerId,hb.executionId,input.connectionId)).toMatchObject({accepted:false});
    await fleet.heartbeat({...hb,sequence:3});
    expect(await control.acceptTask(task.taskId,task.caseId,input.workerId,hb.executionId,input.connectionId)).toMatchObject({accepted:true});
    expect((await fleet.list()).find(w=>w.workerId===input.workerId)?.activeTasks).toBe(1);
    await expire(input);
    expect(await control.acceptTask(task.taskId,task.caseId,input.workerId,hb.executionId,input.connectionId)).toMatchObject({accepted:false});
    const next=connection();await fleet.register(next);const newHB=heartbeat(next);await fleet.heartbeat(newHB);
    expect(await control.acceptTask(task.taskId,task.caseId,next.workerId,newHB.executionId,next.connectionId)).toMatchObject({accepted:false,reason:'EXECUTION_STATE_UNKNOWN'});
    expect((await db.query('SELECT count(*)::int AS n FROM worker_task_acceptances WHERE task_id=$1',[task.taskId])).rows[0].n).toBe(1);
    await fleet.disconnect(next);
  });
  it('rolls back registry and history if audit insert fails',async()=>{
    const input=connection('siem-worker-agent','SIEM');
    await db.query(`CREATE FUNCTION reject_presence_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.actor_id='${input.observerId}' THEN RAISE EXCEPTION 'presence_audit_fixture_failure'; END IF;RETURN NEW;END $$`);
    await db.query('CREATE TRIGGER reject_presence_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_presence_audit()');
    try {
      await expect(fleet.register(input)).rejects.toThrow('presence_audit_fixture_failure');
      expect((await db.query('SELECT 1 FROM worker_connections WHERE connection_id=$1',[input.connectionId])).rowCount).toBe(0);
      expect((await fleet.list()).find(w=>w.workerId===input.workerId)?.presence).toBe('UNKNOWN');
    }finally{await db.query('DROP TRIGGER reject_presence_audit ON audit_events');await db.query('DROP FUNCTION reject_presence_audit()');}
  });
  it('cannot disable staging acceptance gate using the local compatibility switch',async()=>{
    vi.stubEnv('GSS_RUNTIME_ENV','staging');vi.stubEnv('GSS_REQUIRE_WORKER_PRESENCE','false');
    try {
      expect(await control.acceptTask('fixture-not-executed','fixture-case','cli-worker-agent',randomUUID()))
        .toEqual({accepted:false,reason:'WORKER_PRESENCE_REQUIRED'});
    }finally{vi.stubEnv('GSS_RUNTIME_ENV','local');vi.stubEnv('GSS_REQUIRE_WORKER_PRESENCE','true');}
  });
  it('restricts mutations to service authority, including security admin; API uses durable observations',async()=>{
    expect(()=>authorizeOperator({issuer:'fixture',subject:'admin',role:'SECURITY_ADMIN'} as any,'POST','/control/v1/workers/heartbeat')).toThrow('service_authority_required');
    const unauthorized=await fetch(base+'/control/v1/workers',{headers:{authorization:'Bearer invalid'}});expect(unauthorized.status).toBe(401);
    const input=connection('ide-worker-agent','IDE_AGENT');
    const cp=new HttpControlPlaneClient(base,token);await cp.registerWorker(input);await cp.heartbeatWorker(heartbeat(input));
    expect(await cp.workerReady(input.workerId)).toBe(true);await cp.disconnectWorker(input);
    expect(await cp.workerReady(input.workerId)).toBe(false);
  });
  it('persists real SDK heartbeat via authenticated WS and HTTP, binds connection identity, closes durably',async()=>{
    const signer=new TokenSigner('fleet-test-signing-secret-at-least-32characters');
    cc=new CentralCommandOrchestrator(0,{route:async()=>{throw new Error('no paid model calls in fleet test');}} as any,
      signer,new HttpControlPlaneClient(base,token));
    const port=await cc.ready();spool=await mkdtemp(join(tmpdir(),'gss-fleet-'));
    const now=Date.now();const bearer=signer.sign({agentId:'ide-worker-agent',role:'IDE_AGENT',permissions:['REPORT'],timestamp:now,expiresAt:now+60000});
    client=new ASQWebSocketClient('ws://127.0.0.1:'+port,bearer,0,{workerId:'ide-worker-agent',directory:spool,readiness:()=> 'READY'});
    client.connect();await vi.waitFor(async()=>expect((await fleet.list()).find(w=>w.workerId==='ide-worker-agent')?.presence).toBe('ONLINE'),{timeout:5000});
    const actual=(await db.query("SELECT c.* FROM worker_registry w JOIN worker_connections c ON c.connection_id=w.current_connection_id WHERE w.worker_id='ide-worker-agent'")).rows[0];
    // Frame-supplied top-level connection identity is overwritten by the authenticated server.
    client.publishMessage({type:'HEARTBEAT',payload:{executionId:actual.execution_id,sequence:2,readiness:'BUSY'},connectionId:'forged'} as any);
    await vi.waitFor(async()=>expect((await fleet.list()).find(w=>w.workerId==='ide-worker-agent')?.reportedReadiness).toBe('BUSY'),{timeout:5000});
    client.disconnect();await vi.waitFor(async()=>expect((await fleet.list()).find(w=>w.workerId==='ide-worker-agent')?.presence).toBe('OFFLINE'),{timeout:5000});
  });
});
