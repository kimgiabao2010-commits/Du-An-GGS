import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { sha256Canonical } from '@asq/sdk';

export interface CommandIntake {
  commandId: string; caseId: string; actorId: string; content: string;
  decision?: Record<string, unknown>; claimOwner?: string;
}
const fail = (message: string, statusCode = 422) => Object.assign(new Error(message), { statusCode });
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail('invalid control identity or content');
  return value;
}

export class PostgresControlStateStore {
  constructor(private readonly pool: Pool) {}
  async state(): Promise<{ halted: boolean; generation: string }> {
    const row = (await this.pool.query('SELECT halted,generation::text FROM control_runtime_state WHERE singleton=true')).rows[0];
    if (!row) throw fail('control state unavailable', 503);
    return row;
  }
  async halt(actorId: string, reason: string): Promise<void> {
    text(actorId); text(reason, 1000);
    await this.tx(async c => {
      await c.query("UPDATE control_runtime_state SET halted=true,generation=generation+1,actor_id=$1,reason=$2,updated_at=now() WHERE singleton=true", [actorId, reason]);
      await c.query("UPDATE runtime_tasks SET status='CANCELLED',updated_at=now(),completed_at=now() WHERE status NOT IN ('COMPLETED','FAILED','CANCELLED')");
      await c.query("UPDATE investigation_runs SET state='BLOCKED',updated_at=now() WHERE state='ACTIVE'");
      await c.query("UPDATE command_intakes SET state='CANCELLED',locked_by=NULL,lease_until=NULL WHERE state IN ('PENDING','PLANNING')");
      await c.query(`INSERT INTO audit_events(event_type,severity,actor_id,target_resource,action_payload,event_hash)
        VALUES('CONTROL_HALTED','CRITICAL',$1,'control-runtime',$2,$3)`, [actorId, JSON.stringify({ reason }), sha256Canonical({ actorId, reason, nonce: randomUUID() })]);
    });
  }
  async receive(input: CommandIntake): Promise<{ replay: boolean }> {
    text(input.commandId); text(input.caseId); text(input.actorId); text(input.content, 16000);
    const hash = sha256Canonical({ caseId: input.caseId, actorId: input.actorId, content: input.content });
    return this.tx(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['command:' + input.commandId]);
      const old = (await c.query('SELECT body_hash FROM command_intakes WHERE command_id=$1', [input.commandId])).rows[0];
      if (old) { if (old.body_hash !== hash) throw fail('command_id_payload_mismatch', 409); return { replay: true }; }
      await this.active(c);
      await c.query("INSERT INTO cases(case_id,state,created_by) VALUES($1,'TRIAGING',$2) ON CONFLICT DO NOTHING", [input.caseId, input.actorId]);
      const current = (await c.query('SELECT state FROM cases WHERE case_id=$1 FOR UPDATE', [input.caseId])).rows[0];
      if (current.state === 'CLOSED') throw fail('closed_case_intake_denied', 409);
      await c.query('INSERT INTO command_intakes(command_id,case_id,actor_id,body_hash,content) VALUES($1,$2,$3,$4,$5)',
        [input.commandId, input.caseId, input.actorId, hash, input.content]);
      await c.query(`INSERT INTO case_messages(message_id,case_id,role,content,metadata) VALUES($1,$2,'USER',$3,$4)`,
        [randomUUID(), input.caseId, input.content, JSON.stringify({ commandId: input.commandId })]);
      await c.query("UPDATE cases SET state='TRIAGING',updated_at=now() WHERE case_id=$1", [input.caseId]);
      return { replay: false };
    });
  }
  async claim(owner: string): Promise<CommandIntake[]> {
    text(owner);
    return this.tx(async c => {
      await this.active(c);
      await c.query(`UPDATE command_intakes SET state='FAILED',locked_by=NULL,lease_until=NULL,completed_at=now()
        WHERE state IN ('PENDING','PLANNING') AND (lease_until IS NULL OR lease_until<=now())
        AND (attempts>=3 OR deadline_at<=now())`);
      const rows = await c.query(`WITH candidates AS (
        SELECT command_id FROM command_intakes WHERE state IN ('PENDING','PLANNING')
        AND next_attempt_at<=now() AND attempts<3 AND deadline_at>now() AND (lease_until IS NULL OR lease_until<=now())
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 4)
        UPDATE command_intakes i SET state='PLANNING',locked_by=$1,lease_until=now()+interval '120 seconds',attempts=attempts+1
        FROM candidates c WHERE i.command_id=c.command_id RETURNING i.*`, [owner]);
      return rows.rows.map(r => {
        if (r.decision && sha256Canonical(r.decision) !== r.decision_hash) throw fail('intake_decision_integrity_failed', 409);
        return { commandId: r.command_id, caseId: r.case_id, actorId: r.actor_id, content: r.content,
          ...(r.decision ? { decision: r.decision } : {}), claimOwner: owner };
      });
    });
  }
  async saveDecision(id: string, owner: string, decision: Record<string, unknown>): Promise<void> {
    if (!decision || Array.isArray(decision) || typeof decision !== 'object' || Buffer.byteLength(JSON.stringify(decision)) > 64000) throw fail('invalid intake decision');
    await this.tx(async c => {
      await this.active(c);
      const old = (await c.query('SELECT * FROM command_intakes WHERE command_id=$1 FOR UPDATE', [text(id)])).rows[0];
      if (!old || old.locked_by !== text(owner) || new Date(old.lease_until).getTime() <= Date.now() || old.state !== 'PLANNING') throw fail('intake_claim_lost', 409);
      if (old.decision) {
        if (old.decision_hash !== sha256Canonical(decision)) throw fail('intake_decision_conflict', 409);
        return;
      }
      await c.query('UPDATE command_intakes SET decision=$2,decision_hash=$3 WHERE command_id=$1', [id, JSON.stringify(decision), sha256Canonical(decision)]);
    });
  }
  async finish(id: string, owner: string, message?: string, state = 'RESPONDING'): Promise<void> {
    if (!['RESPONDING','TRIAGING','COLLECTING_EVIDENCE'].includes(state)) throw fail('invalid intake case state');
    await this.tx(async c => {
      await this.active(c);
      const row = (await c.query('SELECT * FROM command_intakes WHERE command_id=$1 FOR UPDATE', [text(id)])).rows[0];
      if (row?.state === 'DONE') return;
      if (!row || row.locked_by !== text(owner) || new Date(row.lease_until).getTime() <= Date.now() || !row.decision) throw fail('intake_claim_lost', 409);
      if (message) await c.query(`INSERT INTO case_messages(message_id,case_id,role,content,metadata) VALUES($1,$2,'ASSISTANT',$3,$4)`,
        [randomUUID(), row.case_id, text(message, 16000), JSON.stringify({ commandId: id })]);
      await c.query("UPDATE cases SET state=$2,updated_at=now() WHERE case_id=$1 AND state<>'CLOSED'", [row.case_id, state]);
      await c.query("UPDATE command_intakes SET state='DONE',locked_by=NULL,lease_until=NULL,completed_at=now() WHERE command_id=$1", [id]);
    });
  }
  async release(id: string, owner: string): Promise<void> {
    await this.pool.query(`UPDATE command_intakes SET state='PENDING',locked_by=NULL,lease_until=NULL,
      next_attempt_at=now()+interval '5 seconds' WHERE command_id=$1 AND locked_by=$2 AND state='PLANNING'`, [text(id), text(owner)]);
  }
  async acceptTask(taskId: string, caseId: string, workerId: string, executionId: string, connectionId?: string): Promise<{ accepted: boolean; reason?: string }> {
    [taskId, caseId, workerId, executionId].forEach(v => text(v));
    const target = ({ 'cli-worker-agent': 'cli', 'ide-worker-agent': 'ide', 'siem-worker-agent': 'siem' } as Record<string, string>)[workerId];
    if (!target) throw fail('invalid worker', 403);
    return this.tx(async c => {
      await this.active(c);
      if (process.env.GSS_RUNTIME_ENV === 'staging' || process.env.GSS_REQUIRE_WORKER_PRESENCE === 'true') {
        const live = (await c.query(`SELECT c.* FROM worker_registry w JOIN worker_connections c ON c.connection_id=w.current_connection_id
          WHERE w.worker_id=$1 AND c.connection_id=$2 AND c.execution_id=$3 AND c.state='ONLINE'
          AND c.lease_until>clock_timestamp() AND c.readiness='READY' FOR SHARE OF w,c`,[workerId,connectionId,executionId])).rows[0];
        if (!live) return { accepted:false,reason:'WORKER_PRESENCE_REQUIRED' };
      }
      const task = (await c.query('SELECT * FROM runtime_tasks WHERE task_id=$1 FOR UPDATE', [taskId])).rows[0];
      if (!task || task.case_id !== caseId || task.target !== target || task.assigned_worker !== workerId) throw fail('task_acceptance_provenance_mismatch', 403);
      if (!['DISPATCHED','RUNNING'].includes(task.status)) return { accepted: false, reason: 'TASK_NOT_EXECUTABLE' };
      const old = (await c.query('SELECT * FROM worker_task_acceptances WHERE task_id=$1', [taskId])).rows[0];
      if (old) return { accepted: old.worker_id === workerId && old.execution_id === executionId,
        ...(old.execution_id !== executionId ? { reason: 'EXECUTION_STATE_UNKNOWN' } : {}) };
      await c.query('INSERT INTO worker_task_acceptances(task_id,case_id,worker_id,execution_id) VALUES($1,$2,$3,$4)', [taskId, caseId, workerId, executionId]);
      await c.query("UPDATE runtime_tasks SET status='RUNNING',started_at=COALESCE(started_at,now()),updated_at=now() WHERE task_id=$1", [taskId]);
      await c.query(`UPDATE control_outbox SET published_at=COALESCE(published_at,now()),locked_by=NULL,locked_at=NULL
        WHERE published_at IS NULL AND event_type='TASK_DISPATCH_REQUESTED'
        AND (payload->'task'->>'taskId'=$1 OR 'decision:'||(payload->'decision'->>'decisionId')=$2)`, [taskId, task.idempotency_key]);
      return { accepted: true };
    });
  }
  async recoverExpiredExecutions(): Promise<void> {
    await this.tx(async c => {
      const tasks = await c.query(`UPDATE runtime_tasks t SET status='FAILED',completed_at=now(),updated_at=now()
        WHERE status IN ('DISPATCHED','RUNNING') AND started_at + (timeout_ms+5000)*interval '1 millisecond' < now()
        AND NOT EXISTS(SELECT 1 FROM worker_result_deliveries d WHERE d.task_id=t.task_id)
        AND NOT EXISTS(SELECT 1 FROM runtime_executions e WHERE e.task_id=t.task_id)
        RETURNING task_id,case_id`);
      for (const row of tasks.rows) {
        await c.query("UPDATE cases SET state='INVESTIGATING',updated_at=now() WHERE case_id=$1 AND state<>'CLOSED'", [row.case_id]);
        const payload = { taskId: row.task_id, reason: 'EXECUTION_NOT_VERIFIED_AFTER_TIMEOUT', evidenceCreated: false };
        await c.query(`INSERT INTO audit_events(event_type,severity,actor_id,target_resource,action_payload,incident_id,event_hash)
          VALUES('TASK_EXECUTION_UNVERIFIED','WARNING','control-watchdog',$1,$2,$3,$4)`, [row.task_id, JSON.stringify(payload), row.case_id, sha256Canonical(payload)]);
      }
    });
  }
  private async active(c: PoolClient): Promise<void> {
    const state = (await c.query('SELECT halted FROM control_runtime_state WHERE singleton=true FOR SHARE')).rows[0];
    if (!state || state.halted) throw fail('control_halted', 503);
  }
  private async tx<T>(op: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const result = await op(c); await c.query('COMMIT'); return result; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
}
