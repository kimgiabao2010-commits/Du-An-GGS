import type { PoolClient } from 'pg';

type Scheduler = {enabled:boolean;active_run_id:string|null;max_pending:number};
const fail=(reason:string)=>Object.assign(new Error(reason),{statusCode:503});

/** Always locked by the Control Plane inside a transaction, never by a worker. */
export async function lockDispatchScheduler(c:PoolClient):Promise<Scheduler> {
  const row=(await c.query<Scheduler>('SELECT * FROM dispatch_scheduler_state WHERE singleton=true FOR UPDATE')).rows[0];
  if(!row || row.max_pending!==32)throw fail('dispatch_scheduler_unavailable');
  return row;
}

/** Initial and follow-up intents deduplicate against their eventual task idempotency key. */
async function pendingWorkCount(c:PoolClient,key?:string):Promise<number> {
  const row=(await c.query<{n:number}>(`SELECT count(*)::int AS n FROM (
    SELECT idempotency_key AS key FROM runtime_tasks t
      WHERE status IN ('QUEUED','DISPATCHED','RUNNING','BLOCKED')
      AND NOT EXISTS(SELECT 1 FROM runtime_executions e WHERE e.task_id=t.task_id)
    UNION
    SELECT COALESCE(payload->'task'->>'idempotencyKey','decision:'||(payload->'decision'->>'decisionId'),event_id)
      FROM control_outbox WHERE published_at IS NULL AND event_type='TASK_DISPATCH_REQUESTED'
  ) work WHERE ($1::text IS NULL OR key<>$1)`,[key??null])).rows[0];
  if(!row)throw fail('dispatch_scheduler_unavailable');
  return row.n;
}
export async function assertDispatchCapacity(c:PoolClient,state:Scheduler,key?:string):Promise<void> {
  if(state.enabled && await pendingWorkCount(c,key)>=state.max_pending)throw fail('dispatch_queue_capacity_exhausted');
}
export async function assertSchedulerActivation(c:PoolClient,state:Scheduler):Promise<void> {
  if(await pendingWorkCount(c)>state.max_pending)throw fail('scheduler_activation_requires_bounded_backlog');
}

/** A lease timeout permits replay of the same intent; it never permits a second investigation. */
export async function scheduledRun(c:PoolClient,state:Scheduler):Promise<string|null> {
  if(!state.enabled)return null;
  const executing=await c.query<{run_id:string|null}>(
    "SELECT DISTINCT run_id FROM runtime_tasks WHERE status IN ('DISPATCHED','RUNNING')");
  if(executing.rows.some(r=>!r.run_id) || executing.rows.length>1 ||
    (state.active_run_id && executing.rows.some(r=>r.run_id!==state.active_run_id)))throw fail('dispatch_concurrency_state_conflict');
  let run=state.active_run_id;
  if(run) {
    const busy=(await c.query(`SELECT 1 FROM runtime_tasks WHERE run_id=$1 AND status IN ('DISPATCHED','RUNNING')
      UNION ALL SELECT 1 FROM control_outbox WHERE aggregate_id=$1 AND published_at IS NULL
        AND event_type='TASK_DISPATCH_REQUESTED' LIMIT 1`,[run])).rowCount;
    if(!busy)run=null;
  }
  if(!run)run=executing.rows[0]?.run_id??(await c.query<{aggregate_id:string}>(
    `SELECT aggregate_id FROM control_outbox WHERE published_at IS NULL AND event_type='TASK_DISPATCH_REQUESTED'
      ORDER BY created_at,event_id LIMIT 1`)).rows[0]?.aggregate_id??null;
  if(run!==state.active_run_id)await c.query(
    'UPDATE dispatch_scheduler_state SET active_run_id=$1,updated_at=now() WHERE singleton=true',[run]);
  return run;
}

export async function assertScheduledTask(c:PoolClient,state:Scheduler,runId:string|null):Promise<void> {
  if(!state.enabled)return;
  if(!runId || await scheduledRun(c,state)!==runId)throw fail('investigation_dispatch_slot_unavailable');
}
