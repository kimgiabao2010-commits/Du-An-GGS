import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { CaseState, GssResultContract, GssTaskContract, ObservationPack, TaskStatus } from '@asq/sdk';

export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM' | 'WORKER';

export interface RuntimeStore {
  ready(): Promise<void>;
  ensureCase(caseId: string, actorId: string): Promise<void>;
  transitionCase(caseId: string, state: CaseState): Promise<void>;
  appendMessage(caseId: string, role: MessageRole, content: string, metadata?: Record<string, unknown>): Promise<string>;
  createTask(task: GssTaskContract, requestedBy: string): Promise<{ created: boolean }>;
  updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void>;
  recordResult(result: GssResultContract, observation?: ObservationPack): Promise<void>;
  close(): Promise<void>;
}

export class PostgresRuntimeStore implements RuntimeStore {
  public constructor(private readonly pool: Pool) {}

  public static fromEnvironment(): PostgresRuntimeStore | null {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    return new PostgresRuntimeStore(new Pool({
      connectionString,
      max: 10,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    }));
  }

  public async ready(): Promise<void> { await this.pool.query('SELECT 1'); }
  public async close(): Promise<void> { await this.pool.end(); }

  public async ensureCase(caseId: string, actorId: string): Promise<void> {
    await this.pool.query(`INSERT INTO cases (case_id, state, created_by) VALUES ($1,'NEW',$2)
      ON CONFLICT (case_id) DO NOTHING`, [caseId, actorId]);
  }

  public async transitionCase(caseId: string, state: CaseState): Promise<void> {
    await this.pool.query('UPDATE cases SET state = $2, updated_at = now() WHERE case_id = $1', [caseId, state]);
  }

  public async appendMessage(caseId: string, role: MessageRole, content: string, metadata: Record<string, unknown> = {}): Promise<string> {
    const messageId = randomUUID();
    await this.pool.query(`INSERT INTO case_messages (message_id, case_id, role, content, metadata)
      VALUES ($1,$2,$3,$4,$5)`, [messageId, caseId, role, content, JSON.stringify(metadata)]);
    return messageId;
  }

  public async createTask(task: GssTaskContract, requestedBy: string): Promise<{ created: boolean }> {
    const result = await this.pool.query<{ inserted: boolean }>(`INSERT INTO runtime_tasks
      (task_id, case_id, idempotency_key, source, target, action, parameters, risk_level, context_refs, timeout_ms, status, requested_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'QUEUED',$11,$12)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING true AS inserted`,
      [task.taskId, task.caseId, task.idempotencyKey, task.source, task.target, task.action,
        JSON.stringify(task.parameters), task.riskLevel, task.contextRefs, task.timeoutMs, requestedBy, task.createdAt]);
    return { created: result.rows[0]?.inserted ?? false };
  }

  public async updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void> {
    await this.pool.query(`UPDATE runtime_tasks SET status = $2, assigned_worker = COALESCE($3, assigned_worker),
      started_at = CASE WHEN $2 IN ('DISPATCHED','RUNNING') AND started_at IS NULL THEN now() ELSE started_at END,
      completed_at = CASE WHEN $2 IN ('COMPLETED','BLOCKED','FAILED','CANCELLED') THEN now() ELSE completed_at END,
      updated_at = now() WHERE task_id = $1`, [taskId, status, assignedWorker ?? null]);
  }

  public async recordResult(result: GssResultContract, observation?: ObservationPack): Promise<void> {
    await this.transaction(async client => {
      await client.query(`INSERT INTO runtime_executions
        (task_id, case_id, executor, status, result, evidence_refs, errors, metrics, completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (task_id) DO UPDATE SET status=EXCLUDED.status, result=EXCLUDED.result,
        evidence_refs=EXCLUDED.evidence_refs, errors=EXCLUDED.errors, metrics=EXCLUDED.metrics, completed_at=EXCLUDED.completed_at`,
        [result.taskId, result.caseId, result.executor, result.status, JSON.stringify(result.result), result.evidenceRefs,
          JSON.stringify(result.errors), JSON.stringify(result.metrics), result.completedAt]);
      if (observation) await client.query(`INSERT INTO observation_packs
        (observation_id, case_id, task_id, summary, facts, evidence_refs, raw_artifact_ref, original_bytes, packed_bytes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (observation_id) DO NOTHING`,
        [observation.observationId, observation.caseId, observation.taskId, observation.summary,
          JSON.stringify(observation.facts), observation.evidenceRefs, observation.rawArtifactRef ?? null,
          observation.originalBytes, observation.packedBytes, observation.createdAt]);
      const evidence = result.result.evidence as Record<string, any> | undefined;
      const provenance = evidence?.provenance as Record<string, any> | undefined;
      if (result.executor === 'siem' && evidence && provenance && typeof evidence.evidenceId === 'string') {
        await client.query(`INSERT INTO runtime_siem_query_runs
          (task_id,case_id,adapter,adapter_version,query_hash,source_instance,time_start,time_end,result_count,truncated,redaction_state,queried_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (task_id) DO NOTHING`,
          [result.taskId, result.caseId, provenance.adapter, provenance.adapterVersion, provenance.queryHash,
            provenance.sourceInstance, provenance.timeRange?.start, provenance.timeRange?.end,
            provenance.resultCount, provenance.truncated, provenance.redaction, provenance.queriedAt]);
        await client.query(`INSERT INTO runtime_investigation_evidence (evidence_id,case_id,task_id,event_ids,events)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (evidence_id) DO NOTHING`,
          [evidence.evidenceId, result.caseId, result.taskId, evidence.eventIds ?? [], JSON.stringify(evidence.events ?? [])]);
      }
      const verdict = result.result.verdict as Record<string, any> | undefined;
      if (result.executor === 'siem' && verdict) await client.query(`INSERT INTO runtime_investigation_verdicts
        (task_id,case_id,verdict,evidence_ids,policy_version,rationale,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (task_id) DO NOTHING`,
        [result.taskId, result.caseId, verdict.verdict, verdict.evidenceIds ?? [], verdict.policyVersion,
          verdict.rationale, verdict.createdAt]);
      await client.query(`UPDATE runtime_tasks SET status=$2, completed_at=now(), updated_at=now() WHERE task_id=$1`,
        [result.taskId, result.status]);
      const auditPayload = JSON.stringify({ taskId: result.taskId, status: result.status, evidenceRefs: result.evidenceRefs });
      const eventHash = createHash('sha256').update(`RUNTIME_RESULT:${result.caseId}:${auditPayload}`).digest('hex');
      await client.query(`INSERT INTO audit_events (event_type,severity,actor_id,target_resource,action_payload,incident_id,event_hash)
        VALUES ('RUNTIME_RESULT','INFO',$1,$2,$3,$4,$5) ON CONFLICT (event_hash) DO NOTHING`,
        [result.executor, result.taskId, auditPayload, result.caseId, eventHash]);
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await operation(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
