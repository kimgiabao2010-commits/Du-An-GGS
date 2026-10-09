import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresModelBudgetStore, PostgresInvestigationLoopStore, PostgresRuntimeStore,
  modelBudgetPolicyFromEnvironment, type ModelBudgetPolicy } from '@asq/persistence';
import type { ModelReservationInput, ModelUsageRecord } from '@asq/sdk';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
import { HttpControlPlaneClient } from '../../services/standalone/src/control-plane-client.ts';

const enabled=Boolean(process.env.DATABASE_URL);
const policy:ModelBudgetPolicy={version:'fixture-cost-policy.v1',caseBudgetMicros:200,models:[
  {provider:'openai',model:'gpt-5.6-sol',reservationMicros:80,maxRequestBytes:32768,maxOutputTokens:1200}]};
let db:Pool,budget:PostgresModelBudgetStore,ledger:PostgresInvestigationLoopStore,runtime:PostgresRuntimeStore;
let server:ControlPlaneServer,cp:HttpControlPlaneClient;
beforeAll(async()=>{
  if(!enabled)return;
  // Runner has migrated an isolated schema; no user/runtime schema is modified.
  if(!new URL(process.env.DATABASE_URL!).searchParams.get('options')?.includes('gss_suite_')) throw new Error('isolated PostgreSQL runner required');
  vi.stubEnv('GSS_MODEL_BUDGET_POLICY_JSON',JSON.stringify(policy));
  vi.stubEnv('GSS_CONTROL_PLANE_TOKEN','model-budget-fixture-service-token-32chars');
  db=new Pool({connectionString:process.env.DATABASE_URL});
  budget=new PostgresModelBudgetStore(db,policy);ledger=new PostgresInvestigationLoopStore(db);runtime=new PostgresRuntimeStore(db);
  server=new ControlPlaneServer(0);cp=new HttpControlPlaneClient('http://127.0.0.1:'+await server.ready(),process.env.GSS_CONTROL_PLANE_TOKEN!);
},20000);
afterAll(async()=>{await server?.close();await db?.end();vi.unstubAllEnvs();});

async function input(caseId='budget-'+randomUUID()):Promise<ModelReservationInput> {
  await runtime.ensureCase(caseId,'fixture');
  return {schemaVersion:'gss.model-reservation.v1',usageId:randomUUID(),caseId,provider:'openai',model:'gpt-5.6-sol',
    requestHash:'a'.repeat(64),requestBytes:5000,maxOutputTokens:1200};
}
function usage(i:ModelReservationInput,reservationId:string,attemptId:string,cost:number|null):ModelUsageRecord {
  return {schemaVersion:'gss.model-usage.v1',usageId:i.usageId,caseId:i.caseId,model:i.model,reservationId,invocationAttemptId:attemptId,
    traceId:'fixture',reasoningEffort:'medium',routeReason:'fixture_no_provider_call',inputTokens:100,outputTokens:10,
    cachedTokens:0,cacheWriteTokens:0,latencyMs:5,retryCount:0,estimatedCostMicros:cost,status:cost===null?'FAILED':'SUCCEEDED',createdAt:new Date().toISOString()};
}
async function reserve(i:ModelReservationInput) {
  const r=await cp.reserveModelCall(i);if(!r.enabled)throw new Error('fixture policy not enabled');return r;
}
describe.skipIf(!enabled)('model reservations on real isolated PostgreSQL (synthetic prices, no paid calls)',()=>{
  it('serializes concurrent reservations against held+spent budget',async()=>{
    const i=await input();
    const results=await Promise.allSettled(Array.from({length:8},()=>reserve({...i,usageId:randomUUID()})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
    const account=(await db.query('SELECT * FROM model_case_budgets WHERE case_id=$1',[i.caseId])).rows[0];
    expect(Number(account.held_micros)).toBe(160);expect(Number(account.spent_micros)).toBe(0);
    expect(results.filter(r=>r.status==='rejected').every(r=>String(r.reason).includes('model_budget_exhausted'))).toBe(true);
  });
  it('replays same body without a second hold, binds case/model/request/limits',async()=>{
    const i=await input(),r=await reserve(i);
    expect(await reserve(i)).toMatchObject({reservationId:r.reservationId,replay:true});
    await expect(reserve({...i,requestHash:'b'.repeat(64)})).rejects.toThrow('model_reservation_id_payload_mismatch');
    await expect(reserve({...i,requestBytes:5001})).rejects.toThrow('model_reservation_id_payload_mismatch');
    const other=await input();await expect(reserve({...other,usageId:i.usageId})).rejects.toThrow('model_reservation_id_payload_mismatch');
    expect((await db.query('SELECT held_micros FROM model_case_budgets WHERE case_id=$1',[i.caseId])).rows[0].held_micros).toBe('80');
  });
  it('authorizes one physical call, including same-attempt duplicate; restart does not reset STARTED',async()=>{
    const i=await input(),r=await reserve(i),attempt=randomUUID();
    const starts=await Promise.all(Array.from({length:5},()=>cp.startModelCall(r.reservationId,attempt)));
    expect(starts.filter(s=>s.started)).toHaveLength(1);
    const restarted=new PostgresModelBudgetStore(db,policy);
    expect(await restarted.start(r.reservationId,randomUUID())).toEqual({started:false});
    await expect(reserve({...i,usageId:randomUUID()})).rejects.toThrow('model_budget_uncertain');
    expect((await reserve(i)).state).toBe('STARTED');
  });
  it('settles measured cost and usage atomically, refunds only unused known ceiling, exact replay is idempotent',async()=>{
    const i=await input(),r=await reserve(i),attempt=randomUUID();await cp.startModelCall(r.reservationId,attempt);
    const record=usage(i,r.reservationId,attempt,35);
    expect(await cp.recordModelUsage(record)).toEqual({created:true});
    expect(await cp.recordModelUsage(record)).toEqual({created:false});
    const account=(await db.query('SELECT * FROM model_case_budgets WHERE case_id=$1',[i.caseId])).rows[0];
    expect(account.spent_micros).toBe('35');expect(account.held_micros).toBe('0');expect(account.blocked).toBe(false);
    await expect(cp.recordModelUsage({...record,estimatedCostMicros:36})).rejects.toThrow('model_settlement_conflict');
    expect((await reserve({...i,usageId:randomUUID()})).state).toBe('RESERVED');
  });
  it('retains full hold on unknown usage and denies subsequent calls and evidence dispatch',async()=>{
    const i=await input(),r=await reserve(i),attempt=randomUUID();await cp.startModelCall(r.reservationId,attempt);
    await ledger.recordModelUsage(usage(i,r.reservationId,attempt,null));
    const account=(await db.query('SELECT * FROM model_case_budgets WHERE case_id=$1',[i.caseId])).rows[0];
    expect(account.held_micros).toBe('80');expect(account.spent_micros).toBe('0');expect(account.blocked).toBe(true);
    await expect(reserve({...i,usageId:randomUUID()})).rejects.toThrow('model_budget_uncertain');
    await expect(runtime.createTask({schemaVersion:'gss.task.v1',taskId:randomUUID(),caseId:i.caseId,idempotencyKey:randomUUID(),
      source:'standalone',target:'cli',action:'inspect_hostname',riskLevel:'read_only',parameters:{},contextRefs:[],timeoutMs:15000,createdAt:new Date().toISOString()},'fixture'))
      .rejects.toThrow('model_budget_uncertain');
  });
  it('records ceiling breach honestly and blocks rather than hiding actual spend',async()=>{
    const i=await input(),r=await reserve(i),attempt=randomUUID();await cp.startModelCall(r.reservationId,attempt);
    await ledger.recordModelUsage(usage(i,r.reservationId,attempt,99));
    const account=(await db.query('SELECT * FROM model_case_budgets WHERE case_id=$1',[i.caseId])).rows[0];
    expect(account.spent_micros).toBe('99');expect(account.held_micros).toBe('0');expect(account.blocked).toBe(true);
    expect((await reserve(i)).state).toBe('BREACHED');
  });
  it('rolls back reservation settlement if ledger insert fails',async()=>{
    const i=await input(),r=await reserve(i),attempt=randomUUID();await cp.startModelCall(r.reservationId,attempt);
    await db.query(`CREATE FUNCTION reject_budget_usage() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.case_id='${i.caseId}' THEN RAISE EXCEPTION 'ledger_fixture_failure'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER reject_budget_usage BEFORE INSERT ON model_usage FOR EACH ROW EXECUTE FUNCTION reject_budget_usage()');
    try {
      await expect(ledger.recordModelUsage(usage(i,r.reservationId,attempt,35))).rejects.toThrow('ledger_fixture_failure');
      expect((await reserve(i)).state).toBe('STARTED');
      expect((await db.query('SELECT held_micros FROM model_case_budgets WHERE case_id=$1',[i.caseId])).rows[0].held_micros).toBe('80');
    }finally{await db.query('DROP TRIGGER reject_budget_usage ON model_usage');await db.query('DROP FUNCTION reject_budget_usage()');}
  });
  it('denies unreserved usage, wrong attempt, changed budget policy and immutable DB binding',async()=>{
    const i=await input(),r=await reserve(i),attempt=randomUUID();await cp.startModelCall(r.reservationId,attempt);
    await expect(ledger.recordModelUsage({...usage(i,r.reservationId,attempt,1),reservationId:undefined})).rejects.toThrow('model_reservation_required');
    await expect(ledger.recordModelUsage(usage(i,r.reservationId,randomUUID(),1))).rejects.toThrow('model_settlement_binding_mismatch');
    await expect(ledger.recordModelUsage({...usage(i,r.reservationId,attempt,0),inputTokens:null})).rejects.toThrow('model_settlement_usage_incomplete');
    await expect(new PostgresModelBudgetStore(db).reserve(i)).rejects.toThrow('model_budget_policy_required');
    await expect(new PostgresModelBudgetStore(db).start(r.reservationId,attempt)).rejects.toThrow('model_budget_policy_required');
    await expect(new PostgresModelBudgetStore(db,{...policy,caseBudgetMicros:300}).reserve(i)).rejects.toThrow('model_budget_policy_mismatch');
    await expect(db.query('UPDATE model_call_reservations SET reserved_micros=1 WHERE reservation_id=$1',[r.reservationId])).rejects.toThrow('model_reservation_binding_immutable');
    await expect(db.query("UPDATE model_call_reservations SET state='RESERVED' WHERE reservation_id=$1",[r.reservationId])).rejects.toThrow('model_reservation_transition_denied');
    await expect(db.query('UPDATE model_case_budgets SET limit_micros=300 WHERE case_id=$1',[i.caseId])).rejects.toThrow('model_budget_policy_immutable');
  });
  it('imports legacy unknown spend as blocked, and refuses call start when case closed',async()=>{
    const i=await input();
    vi.stubEnv('GSS_MODEL_BUDGET_POLICY_JSON','');
    try { await ledger.recordModelUsage({...usage(i,'unused',randomUUID(),null),reservationId:undefined,invocationAttemptId:undefined}); }
    finally {vi.stubEnv('GSS_MODEL_BUDGET_POLICY_JSON',JSON.stringify(policy));}
    await expect(reserve(i)).rejects.toThrow('model_budget_uncertain');
    const other=await input(),r=await reserve(other);
    await db.query("UPDATE cases SET state='CLOSED' WHERE case_id=$1",[other.caseId]);
    await expect(cp.startModelCall(r.reservationId,randomUUID())).rejects.toThrow('model_case_inactive');
    const snapshot=await budget.status(other.caseId);
    expect(snapshot.account).toMatchObject({held_micros:'80'});
  });
  it('denies unsupported provider/model, oversized request and invalid policy without holds',async()=>{
    const i=await input();
    await expect(reserve({...i,provider:'groq'})).rejects.toThrow('model_request_policy_denied');
    await expect(reserve({...i,maxOutputTokens:1201})).rejects.toThrow('model_request_policy_denied');
    await expect(reserve({...i,requestBytes:32769})).rejects.toThrow('model_request_policy_denied');
    vi.stubEnv('GSS_MODEL_BUDGET_POLICY_JSON','{}');expect(modelBudgetPolicyFromEnvironment).toThrow('model_budget_policy_invalid');
    vi.stubEnv('GSS_MODEL_BUDGET_POLICY_JSON',JSON.stringify(policy));
    expect((await db.query('SELECT 1 FROM model_case_budgets WHERE case_id=$1',[i.caseId])).rowCount).toBe(0);
  });
});
