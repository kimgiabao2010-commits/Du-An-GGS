import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type {
  CaseState, GssResultContract, GssTaskContract, InvestigationRun, NextStepProposal, ObservationPack, TaskStatus,
} from '@asq/sdk';
import { actionFingerprint, sha256Canonical } from '@asq/sdk';
import {
  PostgresInvestigationLoopStore,
  commitObservationAndDecisionWithClient,
  type ClaimedOutboxEvent,
  type CommitObservationResult,
} from './loop-store.js';

export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM' | 'WORKER';

export interface ClaimedDispatch {
  claimOwner: string;
  parentTaskId?: string;
  loop: CommitObservationResult;
}

export interface RuntimeStore {
  ready(): Promise<void>;
  ensureCase(caseId: string, actorId: string): Promise<void>;
  transitionCase(caseId: string, state: CaseState): Promise<void>;
  appendMessage(caseId: string, role: MessageRole, content: string, metadata?: Record<string, unknown>): Promise<string>;
  ensureInvestigationRun?(caseId: string, requestedBy: string): Promise<InvestigationRun>;
  createTask(task: GssTaskContract, requestedBy: string, linkage?: {
    runId?: string;
    parentTaskId?: string;
    actionFingerprint?: string;
  }): Promise<{ created: boolean }>;
  updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void>;
  claimPendingDispatches?(claimOwner: string, limit?: number): Promise<ClaimedDispatch[]>;
  markOutboxPublished?(eventId: string, claimOwner?: string): Promise<boolean>;
  releaseOutbox?(eventId: string, claimOwner: string, error: string, retryAt: string): Promise<boolean>;
  recordResult(result: GssResultContract, observation?: ObservationPack, loop?: {
    runId: string;
    source: string;
    artifactHash?: string;
    proposal: NextStepProposal;
  }): Promise<void | CommitObservationResult>;
  close(): Promise<void>;
}

export class PostgresRuntimeStore implements RuntimeStore {
  private readonly loopStore: PostgresInvestigationLoopStore;

  public constructor(private readonly pool: Pool) {
    this.loopStore = new PostgresInvestigationLoopStore(pool);
  }

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

  public async ensureInvestigationRun(caseId: string, requestedBy: string): Promise<InvestigationRun> {
    return this.loopStore.ensureRun({ caseId, requestedBy });
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

  public async createTask(task: GssTaskContract, requestedBy: string, linkage: {
    runId?: string;
    parentTaskId?: string;
    actionFingerprint?: string;
  } = {}): Promise<{ created: boolean }> {
    const result = await this.pool.query<{ inserted: boolean }>(`INSERT INTO runtime_tasks
      (task_id, case_id, idempotency_key, source, target, action, parameters, risk_level, context_refs, timeout_ms,
       status, requested_by, created_at, run_id, parent_task_id, action_fingerprint)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'QUEUED',$11,$12,$13,$14,$15)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING true AS inserted`,
      [task.taskId, task.caseId, task.idempotencyKey, task.source, task.target, task.action,
        JSON.stringify(task.parameters), task.riskLevel, task.contextRefs, task.timeoutMs, requestedBy, task.createdAt,
        linkage.runId ?? null, linkage.parentTaskId ?? null, linkage.actionFingerprint ?? null]);
    return { created: result.rows[0]?.inserted ?? false };
  }

  public async claimPendingDispatches(claimOwner: string, limit = 25): Promise<ClaimedDispatch[]> {
    const claims = await this.loopStore.claimOutbox(claimOwner, limit);
    const dispatches: ClaimedDispatch[] = [];
    for (const claim of claims) {
      const recovered = await this.recoverDispatch(claim);
      if (recovered) dispatches.push({ claimOwner, ...recovered });
      else await this.loopStore.releaseOutbox(claim.event.eventId, claimOwner,
        'Outbox payload did not contain a valid dispatch decision', new Date(Date.now() + 60_000).toISOString());
    }
    return dispatches;
  }

  public async markOutboxPublished(eventId: string, claimOwner?: string): Promise<boolean> {
    if (claimOwner) return this.loopStore.markOutboxPublished(eventId, claimOwner);
    const result = await this.pool.query(`UPDATE control_outbox SET published_at=now(), locked_by=NULL, locked_at=NULL,
      last_error=NULL WHERE event_id=$1 AND published_at IS NULL`, [eventId]);
    return result.rowCount === 1;
  }

  public async releaseOutbox(eventId: string, claimOwner: string, error: string, retryAt: string): Promise<boolean> {
    return this.loopStore.releaseOutbox(eventId, claimOwner, error, retryAt);
  }

  public async updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void> {
    await this.pool.query(`UPDATE runtime_tasks SET status = $2, assigned_worker = COALESCE($3, assigned_worker),
      started_at = CASE WHEN $2 IN ('DISPATCHED','RUNNING') AND started_at IS NULL THEN now() ELSE started_at END,
      completed_at = CASE WHEN $2 IN ('COMPLETED','BLOCKED','FAILED','CANCELLED') THEN now() ELSE completed_at END,
      updated_at = now() WHERE task_id = $1`, [taskId, status, assignedWorker ?? null]);
  }

  public async recordResult(result: GssResultContract, observation?: ObservationPack, loop?: {
    runId: string;
    source: string;
    artifactHash?: string;
    proposal: NextStepProposal;
  }): Promise<void | CommitObservationResult> {
    return this.transaction(async client => {
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
      if (observation && loop) {
        return commitObservationAndDecisionWithClient(client, {
          runId: loop.runId,
          observation,
          source: loop.source,
          ...(loop.artifactHash ? { artifactHash: loop.artifactHash } : {}),
          proposal: loop.proposal,
        });
      }
      return undefined;
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await operation(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async recoverDispatch(claim: ClaimedOutboxEvent): Promise<Omit<ClaimedDispatch, 'claimOwner'> | null> {
    const payload = claim.event.payload;
    const decision = payload.decision as CommitObservationResult['decision'] | undefined;
    const expectedEventHash = sha256Canonical({
      aggregateId: claim.event.aggregateId,
      eventType: claim.event.eventType,
      payload,
    });
    if (claim.event.eventType !== 'TASK_DISPATCH_REQUESTED' || claim.event.eventHash !== expectedEventHash ||
      !decision || decision.schemaVersion !== 'gss.next-step.v1' || decision.kind !== 'DISPATCH' || !decision.action ||
      decision.runId !== claim.event.aggregateId || decision.action.riskLevel !== 'read_only' ||
      decision.action.fingerprint !== actionFingerprint(decision.action)) return null;
    const [run, frontier] = await Promise.all([
      this.loopStore.getRun(decision.runId),
      this.loopStore.getFrontier(decision.runId, decision.frontierVersion),
    ]);
    if (!run || !frontier || run.caseId !== decision.caseId || run.policyVersion !== decision.policyVersion ||
      frontier.runId !== run.runId || frontier.version !== decision.frontierVersion || frontier.caseId !== decision.caseId) return null;
    return {
      ...(typeof payload.parentTaskId === 'string' && payload.parentTaskId ? { parentTaskId: payload.parentTaskId } : {}),
      loop: { created: false, run, frontier, decision, outbox: claim.event },
    };
  }
}
