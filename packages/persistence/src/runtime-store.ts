import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type {
  CaseState, GssResultContract, GssTaskContract, InvestigationRun, ModelUsageRecord, NextStepProposal, ObservationPack, TaskStatus,
} from '@asq/sdk';
import { actionFingerprint, sha256Canonical, currentTraceparent, initialTaskDispatchEvent, resultSubmissionHash } from '@asq/sdk';
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

export interface InitialTaskDispatch {
  claimOwner: string;
  eventId: string;
  task: GssTaskContract;
  runId?: string;
}

export interface RuntimeStore {
  ready(): Promise<void>;
  ensureCase(caseId: string, actorId: string): Promise<void>;
  transitionCase(caseId: string, state: CaseState): Promise<void>;
  appendMessage(caseId: string, role: MessageRole, content: string, metadata?: Record<string, unknown>): Promise<string>;
  ensureInvestigationRun?(caseId: string, requestedBy: string): Promise<InvestigationRun>;
  getInvestigationRun?(runId: string): Promise<InvestigationRun | null>;
  getEvidenceFrontier?(runId: string, version?: number): Promise<import('@asq/sdk').EvidenceFrontier | null>;
  recordModelUsage?(record: ModelUsageRecord): Promise<{ created: boolean }>;
  createTask(task: GssTaskContract, requestedBy: string, linkage?: {
    runId?: string;
    parentTaskId?: string;
    actionFingerprint?: string;
  }): Promise<{ created: boolean }>;
  updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void>;
  claimPendingDispatches?(claimOwner: string, limit?: number): Promise<ClaimedDispatch[]>;
  claimInitialDispatches?(claimOwner: string, limit?: number): Promise<InitialTaskDispatch[]>;
  markOutboxPublished?(eventId: string, claimOwner: string): Promise<boolean>;
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

  public async ready(): Promise<void> {
    const required = ['cases', 'runtime_tasks', 'runtime_executions', 'investigation_runs', 'evidence_frontiers',
      'next_step_decisions', 'control_outbox', 'model_usage', 'runtime_result_receipts', 'artifact_registry',
      'case_messages', 'audit_events', 'approval_requests', 'approval_approvals', 'worker_result_deliveries',
      'control_runtime_state', 'command_intakes', 'worker_task_acceptances', 'identity_revocations', 'case_access',
      'model_case_budgets','model_call_reservations','worker_registry','worker_connections',
      'workload_revocation_state','workload_certificate_revocations','lab_telemetry_batches','lab_import_receipts','lab_query_receipts'];
    const result = await this.pool.query<{ name: string; present: boolean }>(
      'SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) AS name', [required]);
    if (result.rows.length !== required.length || result.rows.some(row => !row.present)) {
      throw new Error('Control Plane storage migrations are incomplete');
    }
    const usage=await this.pool.query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='model_usage' AND column_name IN ('cost_status','cache_write_tokens')`);
    if(usage.rows[0]?.n!==2) throw new Error('Model usage migrations are incomplete');
  }
  public async close(): Promise<void> { await this.pool.end(); }

  public async ensureCase(caseId: string, actorId: string): Promise<void> {
    await this.pool.query(`INSERT INTO cases (case_id, state, created_by) VALUES ($1,'NEW',$2)
      ON CONFLICT (case_id) DO NOTHING`, [caseId, actorId]);
  }

  public async ensureInvestigationRun(caseId: string, requestedBy: string, traceparent?: string): Promise<InvestigationRun> {
    const run = await this.loopStore.ensureRun({ caseId, requestedBy });
    if (!traceparent) return run;
    await this.pool.query('UPDATE investigation_runs SET traceparent=COALESCE(traceparent,$2) WHERE run_id=$1', [run.runId, traceparent]);
    return (await this.loopStore.getRun(run.runId))!;
  }

  public async getInvestigationRun(runId: string): Promise<InvestigationRun | null> {
    return this.loopStore.getRun(runId);
  }

  public async getEvidenceFrontier(runId: string, version?: number) {
    return this.loopStore.getFrontier(runId, version);
  }

  public async recordModelUsage(record: ModelUsageRecord): Promise<{ created: boolean }> {
    return this.loopStore.recordModelUsage(record);
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
    linkage = { ...linkage, actionFingerprint: linkage.actionFingerprint ?? sha256Canonical({
      caseId: task.caseId, target: task.target, action: task.action, parameters: task.parameters,
      contextRefs: task.contextRefs, timeoutMs: task.timeoutMs,
      runId: linkage.runId ?? null, parentTaskId: linkage.parentTaskId ?? null,
    }) };
    return this.transaction(async client => {
    const authority = (await client.query('SELECT halted FROM control_runtime_state WHERE singleton=true FOR SHARE')).rows[0];
    if (!authority || authority.halted) throw Object.assign(new Error('control_halted'), { statusCode: 503 });
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [task.idempotencyKey]);
    const existing = await client.query<{ action_fingerprint: string | null }>(
      'SELECT action_fingerprint FROM runtime_tasks WHERE idempotency_key=$1', [task.idempotencyKey]);
    if (existing.rows[0]) {
      if (linkage.actionFingerprint && existing.rows[0].action_fingerprint !== linkage.actionFingerprint) {
        throw Object.assign(new Error('idempotency_key_payload_mismatch'), { statusCode: 409 });
      }
      return { created: false };
    }
    await client.query("INSERT INTO cases (case_id,state,created_by) VALUES ($1,'NEW',$2) ON CONFLICT (case_id) DO NOTHING", [task.caseId, requestedBy]);
    const budget=(await client.query('SELECT blocked FROM model_case_budgets WHERE case_id=$1 FOR SHARE',[task.caseId])).rows[0];
    if(budget && (budget.blocked || (await client.query("SELECT 1 FROM model_call_reservations WHERE case_id=$1 AND state='STARTED' LIMIT 1",[task.caseId])).rowCount)) {
      throw Object.assign(new Error('model_budget_uncertain'),{statusCode:403});
    }
    if (!linkage.runId && !linkage.parentTaskId) {
      const run = await this.loopStore.ensureRun({ caseId: task.caseId, requestedBy }, client);
      linkage = { ...linkage, runId: run.runId };
    }
    if (linkage.runId) {
      const run = await client.query('SELECT case_id,cost_micros_used,max_cost_micros,cost_accounting_unknown FROM investigation_runs WHERE run_id=$1 FOR SHARE', [linkage.runId]);
      if (!run.rows[0] || run.rows[0].case_id !== task.caseId) throw Object.assign(new Error('invalid task run provenance'), { statusCode: 422 });
      if (Number(run.rows[0].cost_micros_used)>=Number(run.rows[0].max_cost_micros)) throw Object.assign(new Error('cost_budget_exhausted'),{statusCode:403});
      if ((process.env.GSS_RUNTIME_ENV==='staging' || process.env.GSS_ENFORCE_COST_ACCOUNTING==='true') && run.rows[0].cost_accounting_unknown) {
        throw Object.assign(new Error('cost_accounting_unknown'),{statusCode:403});
      }
    }
    if (linkage.parentTaskId) {
      const parent = await client.query('SELECT case_id,run_id FROM runtime_tasks WHERE task_id=$1', [linkage.parentTaskId]);
      if (!parent.rows[0] || parent.rows[0].case_id !== task.caseId || parent.rows[0].run_id !== linkage.runId) {
        throw Object.assign(new Error('invalid parent task provenance'), { statusCode: 422 });
      }
    }
    const result = await client.query<{ inserted: boolean }>(`INSERT INTO runtime_tasks
      (task_id, case_id, idempotency_key, source, target, action, parameters, risk_level, context_refs, timeout_ms,
       status, requested_by, created_at, run_id, parent_task_id, action_fingerprint, traceparent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'QUEUED',$11,$12,$13,$14,$15,$16)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING true AS inserted`,
      [task.taskId, task.caseId, task.idempotencyKey, task.source, task.target, task.action,
        JSON.stringify(task.parameters), task.riskLevel, task.contextRefs, task.timeoutMs, requestedBy, task.createdAt,
        linkage.runId ?? null, linkage.parentTaskId ?? null, linkage.actionFingerprint ?? null, task.traceparent ?? null]);
    const created = result.rows[0]?.inserted ?? false;
    if (created && !linkage.parentTaskId) {
      const event = initialTaskDispatchEvent(task, linkage.runId);
      await client.query(`INSERT INTO control_outbox
        (event_id,aggregate_id,event_type,payload,event_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [event.eventId, event.aggregateId, event.eventType, JSON.stringify(event.payload), event.eventHash, event.createdAt]);
    }
    return { created };
    });
  }

  public async claimInitialDispatches(claimOwner: string, limit = 25, eventIds?: string[]): Promise<InitialTaskDispatch[]> {
    const claims = await this.loopStore.claimOutbox(claimOwner, limit, 60_000, 'initial', eventIds);
    const dispatches: InitialTaskDispatch[] = [];
    for (const { event } of claims) {
      const task = event.payload.task as GssTaskContract | undefined;
      const runId = typeof event.payload.runId === 'string' ? event.payload.runId : undefined;
      let valid = false;
      try {
        valid = event.eventHash === sha256Canonical({ aggregateId: event.aggregateId,
          eventType: event.eventType, payload: event.payload }) && task?.schemaVersion === 'gss.task.v1' &&
          task.riskLevel === 'read_only' && typeof task.taskId === 'string' && typeof task.caseId === 'string' &&
          typeof task.idempotencyKey === 'string' && typeof task.action === 'string' && task.source === 'standalone' &&
          ['cli', 'ide', 'siem'].includes(task.target) && !!task.parameters && typeof task.parameters === 'object' &&
          !Array.isArray(task.parameters) && Array.isArray(task.contextRefs) &&
          task.contextRefs.every(ref => typeof ref === 'string') && Number.isInteger(task.timeoutMs) &&
          task.timeoutMs >= 1_000 && task.timeoutMs <= 120_000 && !!runId && event.aggregateId === runId;
      } catch { /* Invalid persisted JSON fails closed. */ }
      if (valid && task) {
        const persisted = await this.pool.query(`SELECT t.*,
          EXISTS (SELECT 1 FROM runtime_executions e WHERE e.task_id=t.task_id) AS has_result
          FROM runtime_tasks t WHERE task_id=$1`, [task.taskId]);
        const row = persisted.rows[0];
        const sameTask = row && row.parent_task_id === null && (row.run_id ?? undefined) === runId &&
          sha256Canonical({ caseId: row.case_id, idempotencyKey: row.idempotency_key, source: row.source,
            target: row.target, action: row.action, parameters: row.parameters, riskLevel: row.risk_level,
            contextRefs: row.context_refs, timeoutMs: row.timeout_ms }) ===
          sha256Canonical({ caseId: task.caseId, idempotencyKey: task.idempotencyKey, source: task.source,
            target: task.target, action: task.action, parameters: task.parameters, riskLevel: task.riskLevel,
            contextRefs: task.contextRefs, timeoutMs: task.timeoutMs });
        if (sameTask) {
          const run = runId ? await this.loopStore.getRun(runId) : null;
          const expired = runId && (!run || run.state !== 'ACTIVE' || Date.parse(run.budget.deadlineAt) <= Date.now());
          if (row.has_result || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.status) || expired) {
            // published_at means intent processed, not worker ACK; preserve a retirement reason for audit.
            await this.pool.query(`UPDATE control_outbox SET published_at=now(),locked_by=NULL,locked_at=NULL,
              last_error='Dispatch retired: terminal task or inactive/expired run'
              WHERE event_id=$1 AND locked_by=$2 AND published_at IS NULL`, [event.eventId, claimOwner]);
            continue; // Retire stale intent; never produce an observation or re-execute a terminal task.
          }
          dispatches.push({ claimOwner, eventId: event.eventId, task, ...(runId ? { runId } : {}) });
          continue;
        }
      }
      await this.loopStore.releaseOutbox(event.eventId, claimOwner,
        'Initial dispatch hash or task provenance is invalid', new Date(Date.now() + 60_000).toISOString());
    }
    return dispatches;
  }

  public async claimPendingDispatches(claimOwner: string, limit = 25, eventIds?: string[]): Promise<ClaimedDispatch[]> {
    const claims = await this.loopStore.claimOutbox(claimOwner, limit, 60_000, 'decision', eventIds);
    const dispatches: ClaimedDispatch[] = [];
    for (const claim of claims) {
      const recovered = await this.recoverDispatch(claim);
      if (recovered) dispatches.push({ claimOwner, ...recovered });
      else await this.loopStore.releaseOutbox(claim.event.eventId, claimOwner,
        'Outbox payload did not contain a valid dispatch decision', new Date(Date.now() + 60_000).toISOString());
    }
    return dispatches;
  }

  public async markOutboxPublished(eventId: string, claimOwner: string): Promise<boolean> {
    if (!claimOwner?.trim()) throw Object.assign(new Error('claimOwner is required'), { statusCode: 422 });
    return this.loopStore.markOutboxPublished(eventId, claimOwner);
  }

  public async releaseOutbox(eventId: string, claimOwner: string, error: string, retryAt: string): Promise<boolean> {
    return this.loopStore.releaseOutbox(eventId, claimOwner, error, retryAt);
  }

  public async updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void> {
    await this.transaction(async client => {
    if (['QUEUED','DISPATCHED','RUNNING'].includes(status)) {
      const authority = (await client.query('SELECT halted FROM control_runtime_state WHERE singleton=true FOR SHARE')).rows[0];
      if (!authority || authority.halted) throw Object.assign(new Error('control_halted'), { statusCode: 503 });
    }
    const current = await client.query('SELECT status FROM runtime_tasks WHERE task_id=$1 FOR UPDATE', [taskId]);
    if (!current.rows[0]) throw Object.assign(new Error('task_not_found'), { statusCode: 404 });
    const completed = await client.query('SELECT 1 FROM runtime_executions WHERE task_id=$1', [taskId]);
    if (completed.rows[0]) {
      if (current.rows[0].status !== status) throw Object.assign(new Error('terminal_task_transition_denied'), { statusCode: 409 });
      return;
    }
    if (['COMPLETED','FAILED','CANCELLED'].includes(current.rows[0].status) && current.rows[0].status !== status) {
      throw Object.assign(new Error('terminal_task_transition_denied'), { statusCode: 409 });
    }
    if (current.rows[0].status === 'RUNNING' && status === 'DISPATCHED') return;
    await client.query(`UPDATE runtime_tasks SET status = $2, assigned_worker = COALESCE($3, assigned_worker),
      started_at = CASE WHEN $2 IN ('DISPATCHED','RUNNING') AND started_at IS NULL THEN now() ELSE started_at END,
      completed_at = CASE WHEN $2 IN ('COMPLETED','BLOCKED','FAILED','CANCELLED') THEN now() ELSE completed_at END,
      updated_at = now() WHERE task_id = $1`, [taskId, status, assignedWorker ?? null]);
    });
  }

  public async recordResult(result: GssResultContract, observation?: ObservationPack, loop?: {
    runId: string;
    source: string;
    artifactHash?: string;
    proposal: NextStepProposal;
  }): Promise<void | CommitObservationResult> {
    return (await this.recordResultReceipt(result, observation, loop)).loop;
  }

  public async recordResultReceipt(result: GssResultContract, observation?: ObservationPack, loop?: {
    runId: string; source: string; artifactHash?: string; proposal: NextStepProposal;
  }, deliveryId?: string): Promise<{ replay: boolean; loop?: CommitObservationResult }> {
    return this.transaction(async client => {
      const task = await client.query('SELECT case_id,target,run_id,status FROM runtime_tasks WHERE task_id=$1 FOR UPDATE', [result.taskId]);
      if (!task.rows[0]) throw Object.assign(new Error('task_not_found'), { statusCode: 404 });
      if (task.rows[0].case_id !== result.caseId || task.rows[0].target !== result.executor ||
          (loop && task.rows[0].run_id !== loop.runId)) {
        throw Object.assign(new Error('result_task_provenance_mismatch'), { statusCode: 422 });
      }
      const envelopeHash = sha256Canonical(JSON.parse(JSON.stringify({ result, observation: observation ?? null, loop: loop ?? null })));
      const delivery = (await client.query('SELECT delivery_id,prepared_hash,prepared_payload FROM worker_result_deliveries WHERE task_id=$1', [result.taskId])).rows[0];
      if (delivery && !deliveryId || deliveryId && (!delivery || delivery.delivery_id !== deliveryId || delivery.prepared_hash !== envelopeHash)) {
        throw Object.assign(new Error('worker_delivery_prepared_result_mismatch'), { statusCode: 409 });
      }
      if (delivery && (!delivery.prepared_payload || resultSubmissionHash(delivery.prepared_payload) !== delivery.prepared_hash)) {
        throw Object.assign(new Error('prepared_result_integrity_failed'), { statusCode: 409 });
      }
      const receipt = await client.query('SELECT envelope_hash,loop_result FROM runtime_result_receipts WHERE task_id=$1', [result.taskId]);
      if (receipt.rows[0]) {
        if (receipt.rows[0].envelope_hash !== envelopeHash) throw Object.assign(new Error('result_payload_mismatch'), { statusCode: 409 });
        if (deliveryId) await client.query('UPDATE worker_result_deliveries SET committed_at=COALESCE(committed_at,now()) WHERE task_id=$1', [result.taskId]);
        return { replay: true, ...(receipt.rows[0].loop_result ? { loop: { ...receipt.rows[0].loop_result, created: false } as CommitObservationResult } : {}) };
      }
      const historical = await client.query('SELECT 1 FROM runtime_executions WHERE task_id=$1', [result.taskId]);
      if (historical.rows[0]) throw Object.assign(new Error('legacy_result_requires_explicit_reconciliation'), { statusCode: 409 });
      if (['CANCELLED', 'FAILED', 'COMPLETED'].includes(task.rows[0].status)) {
        throw Object.assign(new Error('terminal_task_result_denied'), { statusCode: 409 });
      }
      await client.query(`INSERT INTO runtime_executions
        (task_id, case_id, executor, status, result, evidence_refs, errors, metrics, completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (task_id) DO NOTHING`,
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
        VALUES ('RUNTIME_RESULT','INFO',$1,$2,$3,$4,$5) ON CONFLICT (event_hash) WHERE event_hash IS NOT NULL DO NOTHING`,
        [result.executor, result.taskId, auditPayload, result.caseId, eventHash]);
      let committedLoop: CommitObservationResult | undefined;
      if (observation && loop) {
        committedLoop = await commitObservationAndDecisionWithClient(client, {
          traceparent: currentTraceparent(),
          runId: loop.runId,
          observation,
          source: loop.source,
          ...(loop.artifactHash ? { artifactHash: loop.artifactHash } : {}),
          proposal: loop.proposal,
        });
      }
      await client.query('INSERT INTO runtime_result_receipts (task_id,envelope_hash,loop_result) VALUES ($1,$2,$3)',
        [result.taskId, envelopeHash, committedLoop ? JSON.stringify(committedLoop) : null]);
      // Lifecycle and display message are part of the result commit, including background recovery.
      const caseState = result.status !== 'COMPLETED' || committedLoop?.decision.kind === 'BLOCKED' ? 'INVESTIGATING' :
        committedLoop?.decision.kind === 'DISPATCH' ? 'COLLECTING_EVIDENCE' : 'ANALYZING';
      await client.query("UPDATE cases SET state=$2,updated_at=now() WHERE case_id=$1 AND state<>'CLOSED'", [result.caseId, caseState]);
      await client.query(`INSERT INTO case_messages(message_id,case_id,role,content,metadata) VALUES($1,$2,'WORKER',$3,$4)`,
        [randomUUID(), result.caseId, observation?.summary ?? String(result.result.summary ?? result.status).slice(0,1600),
          JSON.stringify({ taskId: result.taskId, evidenceRefs: result.evidenceRefs })]);
      await client.query('UPDATE worker_task_acceptances SET completed_at=now() WHERE task_id=$1', [result.taskId]);
      if (deliveryId) await client.query('UPDATE worker_result_deliveries SET committed_at=now() WHERE task_id=$1', [result.taskId]);
      return { replay: false, ...(committedLoop ? { loop: committedLoop } : {}) };
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
