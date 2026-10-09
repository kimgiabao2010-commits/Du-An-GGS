import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { sha256Canonical, modelUsagePayloadHash, type ModelReservationInput,
  type ModelReservationReceipt, type ModelUsageRecord } from '@asq/sdk';

interface ModelPolicy { provider: 'openai' | 'groq'; model: string; reservationMicros: number; maxRequestBytes: number; maxOutputTokens: number }
export interface ModelBudgetPolicy { version: string; caseBudgetMicros: number; models: ModelPolicy[] }
const deny = (reason: string, statusCode=403) => Object.assign(new Error(reason),{statusCode});
const positive = (v: unknown, max=Number.MAX_SAFE_INTEGER): v is number =>
  typeof v==='number' && Number.isSafeInteger(v) && v>0 && v<=max;

export function modelBudgetPolicyFromEnvironment(): ModelBudgetPolicy | undefined {
  const raw=process.env.GSS_MODEL_BUDGET_POLICY_JSON;
  if(!raw?.trim()) {
    if(process.env.GSS_RUNTIME_ENV==='staging') throw deny('model_budget_policy_required',503);
    return undefined;
  }
  let policy: ModelBudgetPolicy;
  try { policy=JSON.parse(raw); } catch { throw deny('model_budget_policy_invalid',503); }
  if(!policy || typeof policy.version!=='string' || !policy.version.trim() || policy.version.length>128 ||
    !positive(policy.caseBudgetMicros) || !Array.isArray(policy.models) || policy.models.length<1 || policy.models.length>20 ||
    policy.models.some(p=>!p || !['openai','groq'].includes(p.provider) || typeof p.model!=='string' || !p.model || p.model.length>128 ||
      !positive(p.reservationMicros,policy.caseBudgetMicros) || !positive(p.maxRequestBytes,1000000) || !positive(p.maxOutputTokens,100000)) ||
    new Set(policy.models.map(p=>p.provider+':'+p.model)).size!==policy.models.length) throw deny('model_budget_policy_invalid',503);
  return policy;
}

/** No lease expiry/refund: STARTED without verified usage is still potentially billable. */
export class PostgresModelBudgetStore {
  constructor(private readonly pool: Pool, private readonly policy?: ModelBudgetPolicy) {}

  async reserve(input: ModelReservationInput): Promise<ModelReservationReceipt> {
    if(input.schemaVersion!=='gss.model-reservation.v1' || ![input.caseId,input.usageId,input.model].every(v=>typeof v==='string' && v.length>0 && v.length<=256) ||
      !/^[a-f0-9]{64}$/.test(input.requestHash) || !positive(input.requestBytes,1000000) || !positive(input.maxOutputTokens,100000) ||
      !['openai','groq'].includes(input.provider)) throw deny('model_reservation_contract_invalid',422);
    if(!this.policy) {
      if((await this.pool.query('SELECT 1 FROM model_case_budgets WHERE case_id=$1',[input.caseId])).rowCount) throw deny('model_budget_policy_required',503);
      return {enabled:false};
    }
    const policy=this.policy, model=policy.models.find(p=>p.model===input.model && p.provider===input.provider);
    if(!model || input.requestBytes>model.maxRequestBytes || input.maxOutputTokens>model.maxOutputTokens) throw deny('model_request_policy_denied');
    const bindingHash=sha256Canonical(input), policyHash=sha256Canonical(policy);
    return this.transaction(async client=>{
      await this.authority(client,input.caseId);
      // Imports historical measured spend, and explicitly blocks uncertified legacy usage.
      await client.query(`INSERT INTO model_case_budgets(case_id,policy_hash,policy_version,limit_micros,spent_micros,blocked)
        SELECT $1,$2,$3,$4,COALESCE(sum(estimated_cost_micros),0),COALESCE(bool_or(estimated_cost_micros IS NULL OR payload_hash IS NULL),false)
        FROM model_usage WHERE case_id=$1 ON CONFLICT DO NOTHING`,[input.caseId,policyHash,policy.version,policy.caseBudgetMicros]);
      const account=(await client.query('SELECT * FROM model_case_budgets WHERE case_id=$1 FOR UPDATE',[input.caseId])).rows[0];
      if(account.policy_hash!==policyHash) throw deny('model_budget_policy_mismatch',409);
      const previous=(await client.query('SELECT * FROM model_call_reservations WHERE usage_id=$1',[input.usageId])).rows[0];
      if(previous) {
        if(previous.binding_hash!==bindingHash) throw deny('model_reservation_id_payload_mismatch',409);
        return {enabled:true,reservationId:previous.reservation_id,state:previous.state,replay:true};
      }
      if(account.blocked) throw deny('model_budget_uncertain');
      if((await client.query("SELECT 1 FROM model_call_reservations WHERE case_id=$1 AND state='STARTED' LIMIT 1",[input.caseId])).rowCount) throw deny('model_budget_uncertain');
      const remaining=BigInt(account.limit_micros)-BigInt(account.spent_micros)-BigInt(account.held_micros);
      if(remaining<BigInt(model.reservationMicros)) throw deny('model_budget_exhausted');
      const reservationId='RES-'+randomUUID();
      const inserted=await client.query(`INSERT INTO model_call_reservations(reservation_id,usage_id,case_id,provider,model,request_hash,binding_hash,reserved_micros)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(usage_id) DO NOTHING RETURNING reservation_id`,
        [reservationId,input.usageId,input.caseId,input.provider,input.model,input.requestHash,bindingHash,model.reservationMicros]);
      if(!inserted.rowCount) throw deny('model_reservation_id_payload_mismatch',409);
      await client.query('UPDATE model_case_budgets SET held_micros=held_micros+$2,updated_at=now() WHERE case_id=$1',[input.caseId,model.reservationMicros]);
      await budgetAudit(client,'MODEL_COST_RESERVED',input.caseId,{reservationId,usageId:input.usageId,model:input.model,reservedMicros:model.reservationMicros});
      return {enabled:true,reservationId,state:'RESERVED',replay:false};
    });
  }

  async start(reservationId: string, attemptId: string): Promise<{started:boolean}> {
    if(!/^RES-[a-f0-9-]{36}$/.test(reservationId) || !/^[a-f0-9-]{36}$/.test(attemptId)) throw deny('model_start_contract_invalid',422);
    if(!this.policy) throw deny('model_budget_policy_required',503);
    return this.transaction(async client=>{
      const existing=(await client.query('SELECT case_id FROM model_call_reservations WHERE reservation_id=$1',[reservationId])).rows[0];
      if(!existing) throw deny('model_reservation_not_found',404);
      await this.authority(client,existing.case_id);
      const account=(await client.query('SELECT * FROM model_case_budgets WHERE case_id=$1 FOR UPDATE',[existing.case_id])).rows[0];
      if(account.blocked || this.policy && account.policy_hash!==sha256Canonical(this.policy)) throw deny('model_budget_uncertain');
      const result=await client.query(`UPDATE model_call_reservations SET state='STARTED',attempt_id=$2,started_at=now()
        WHERE reservation_id=$1 AND state='RESERVED' RETURNING case_id`,[reservationId,attemptId]);
      // Even repeated same-attempt requests cannot authorize another physical call.
      if(!result.rowCount) return {started:false};
      await budgetAudit(client,'MODEL_CALL_STARTED',existing.case_id,{reservationId,attemptId});
      return {started:true};
    });
  }

  async status(caseId:string):Promise<Record<string,unknown>> {
    const account=(await this.pool.query('SELECT policy_version,limit_micros,spent_micros,held_micros,blocked FROM model_case_budgets WHERE case_id=$1',[caseId])).rows[0];
    const invocations=(await this.pool.query(`SELECT reservation_id,usage_id,provider,model,state,reserved_micros,actual_micros,started_at,settled_at
      FROM model_call_reservations WHERE case_id=$1 ORDER BY created_at DESC LIMIT 100`,[caseId])).rows;
    return {caseId,enabled:Boolean(this.policy || account),account:account ?? null,invocations};
  }

  private async authority(client: PoolClient,caseId:string): Promise<void> {
    const state=(await client.query('SELECT halted FROM control_runtime_state WHERE singleton=true FOR SHARE')).rows[0];
    if(!state || state.halted) throw deny('control_halted',503);
    const target=(await client.query('SELECT state FROM cases WHERE case_id=$1 FOR SHARE',[caseId])).rows[0];
    if(!target || target.state==='CLOSED') throw deny('model_case_inactive');
  }
  private async transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try {await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
  }
}

export async function budgetAudit(client:PoolClient,type:string,caseId:string,payload:Record<string,unknown>):Promise<void> {
  await client.query(`INSERT INTO audit_events(event_type,severity,actor_id,target_resource,action_payload,incident_id,event_hash)
    VALUES($1,'INFO','model-budget',$2,$3,$2,$4)`,[type,caseId,JSON.stringify(payload),sha256Canonical({id:randomUUID(),type,caseId,payload})]);
}

/** Called within the SAME transaction as the immutable model_usage insert. */
export async function settleModelReservation(client:PoolClient,record:ModelUsageRecord):Promise<void> {
  const account=(await client.query('SELECT * FROM model_case_budgets WHERE case_id=$1 FOR UPDATE',[record.caseId])).rows[0];
  if(!record.reservationId) {
    if(modelBudgetPolicyFromEnvironment() || account) throw deny('model_reservation_required');
    return;
  }
  const r=(await client.query('SELECT * FROM model_call_reservations WHERE reservation_id=$1 FOR UPDATE',[record.reservationId])).rows[0];
  if(!account || !r || r.case_id!==record.caseId || r.usage_id!==record.usageId || r.model!==record.model ||
    !record.invocationAttemptId || r.attempt_id!==record.invocationAttemptId) throw deny('model_settlement_binding_mismatch',409);
  const hash=modelUsagePayloadHash(record);
  if(r.state!=='STARTED') {
    if(r.settlement_hash!==hash) throw deny('model_settlement_conflict',409);
    return;
  }
  const actual=record.estimatedCostMicros,unknown=actual===null;
  if(!unknown && ([record.inputTokens,record.outputTokens,record.cachedTokens,record.cacheWriteTokens].some(v=>typeof v!=='number' || !Number.isSafeInteger(v) || v<0) ||
    record.cachedTokens!+record.cacheWriteTokens!>record.inputTokens!)) throw deny('model_settlement_usage_incomplete',422);
  const breached=!unknown && BigInt(actual)>BigInt(r.reserved_micros);
  await client.query(`UPDATE model_call_reservations SET state=$2,actual_micros=$3,settlement_hash=$4,settled_at=now() WHERE reservation_id=$1`,
    [r.reservation_id,unknown?'UNKNOWN':breached?'BREACHED':'SETTLED',actual,hash]);
  await client.query(`UPDATE model_case_budgets SET held_micros=held_micros-$2,
    spent_micros=spent_micros+$3,blocked=blocked OR $4,updated_at=now() WHERE case_id=$1`,
    [record.caseId,unknown?0:r.reserved_micros,actual ?? 0,unknown || breached]);
  await budgetAudit(client,'MODEL_COST_SETTLED',record.caseId,{reservationId:r.reservation_id,costStatus:unknown?'UNKNOWN':breached?'BREACHED':'KNOWN',actualMicros:actual});
}
