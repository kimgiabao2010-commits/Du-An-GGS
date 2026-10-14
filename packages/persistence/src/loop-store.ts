import { Pool, type PoolClient } from 'pg';
import {
  INVESTIGATION_RUN_SCHEMA_VERSION,
  createControlOutboxEvent,
  planNextStep,
  reduceEvidenceFrontier,
  sha256Canonical,
  modelUsagePayloadHash,
  type ControlOutboxEvent,
  type EvidenceFrontier,
  type InvestigationBudget,
  type InvestigationRun,
  type InvestigationRunState,
  type ModelUsageRecord,
  type NextStepDecision,
  type NextStepProposal,
  type ObservationPack,
  type HypothesisPlan,
  SOC_EVIDENCE_POLICY_VERSION,
} from '@asq/sdk';
import { settleModelReservation } from './model-budget-store.js';

export interface CreateInvestigationRunInput {
  caseId: string;
  requestedBy: string;
  policyVersion?: string;
  budget?: Partial<Pick<InvestigationBudget, 'maxDepth' | 'maxExternalQueries' | 'maxCostMicros'>> & { deadlineAt?: string };
  now?: string;
}

export interface CommitObservationInput {
  traceparent?: string;
  runId: string;
  observation: ObservationPack;
  source: string;
  artifactHash?: string;
  proposal: NextStepProposal;
  now?: string;
}

export interface CommitObservationResult {
  created: boolean;
  run: InvestigationRun;
  frontier: EvidenceFrontier;
  decision: NextStepDecision;
  outbox: ControlOutboxEvent;
  hypothesisPlan?: HypothesisPlan;
}

/** In-process, Control Plane-owned policy. Never accepted from an HTTP body or model output. */
export type HypothesisDecisionPolicy = (context: {run:InvestigationRun;frontier:EvidenceFrontier;
  previousActionFingerprints:string[];now:string}) => HypothesisPlan;

export interface ClaimedOutboxEvent {
  event: ControlOutboxEvent;
  attempts: number;
}

interface RunRow {
  traceparent?: string;
  run_id: string;
  case_id: string;
  state: InvestigationRunState;
  frontier_version: number;
  depth: number;
  max_depth: number;
  deadline_at: Date | string;
  external_queries_used: number;
  max_external_queries: number;
  cost_micros_used: string | number;
  max_cost_micros: string | number;
  cost_accounting_unknown?: boolean;
  policy_version: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function integer(value: number, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is out of range`);
  return value;
}

function mapRun(row: RunRow): InvestigationRun {
  return {
    ...(row.traceparent ? { traceparent: row.traceparent } : {}),
    schemaVersion: INVESTIGATION_RUN_SCHEMA_VERSION,
    runId: row.run_id,
    caseId: row.case_id,
    state: row.state,
    frontierVersion: Number(row.frontier_version),
    depth: Number(row.depth),
    budget: {
      maxDepth: Number(row.max_depth),
      deadlineAt: iso(row.deadline_at),
      maxExternalQueries: Number(row.max_external_queries),
      maxCostMicros: Number(row.max_cost_micros),
      requireKnownCost:process.env.GSS_RUNTIME_ENV==='staging' || process.env.GSS_ENFORCE_COST_ACCOUNTING==='true',
    },
    usage: {
      externalQueries: Number(row.external_queries_used),
      costMicros: Number(row.cost_micros_used),
      costUnknown:row.cost_accounting_unknown ?? false,
    },
    policyVersion: row.policy_version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function stateForDecision(decision: NextStepDecision): InvestigationRunState {
  if (decision.kind === 'WAIT_APPROVAL') return 'WAITING_APPROVAL';
  if (decision.kind === 'FINALIZE') return 'FINALIZED';
  if (decision.kind === 'BLOCKED') return 'BLOCKED';
  return 'ACTIVE';
}

export async function commitObservationAndDecisionWithClient(
  client: PoolClient,
  input: CommitObservationInput,
  hypothesisPolicy?: HypothesisDecisionPolicy,
): Promise<CommitObservationResult> {
  const locked = await client.query<RunRow>('SELECT * FROM investigation_runs WHERE run_id = $1 FOR UPDATE', [input.runId]);
  const row = locked.rows[0];
  if (!row) throw new Error('Investigation run not found');
  const run = mapRun(row);
  if (run.caseId !== input.observation.caseId) throw new Error('Observation case does not match investigation run');

  const replay = await client.query<{ payload: EvidenceFrontier;payload_hash:string }>(
    'SELECT payload,payload_hash FROM evidence_frontiers WHERE run_id = $1 AND observation_id = $2',
    [input.runId, input.observation.observationId]);
  if (replay.rows[0]) {
    const frontier = replay.rows[0].payload;
    if(sha256Canonical(frontier)!==replay.rows[0].payload_hash) throw new Error('Replay frontier integrity check failed');
    const decisionResult = await client.query<{ payload: NextStepDecision;payload_hash:string }>(
      'SELECT payload,payload_hash FROM next_step_decisions WHERE run_id = $1 AND frontier_version = $2', [input.runId, frontier.version]);
    const decision = decisionResult.rows[0]?.payload;
    if (!decision) throw new Error('Replay frontier exists without its atomic decision');
    if(sha256Canonical(decision)!==decisionResult.rows[0].payload_hash) throw new Error('Replay decision integrity check failed');
    const hypothesisPlan=run.policyVersion===SOC_EVIDENCE_POLICY_VERSION ? await readHypothesisPlan(client,input.runId,frontier.version):undefined;
    if(run.policyVersion===SOC_EVIDENCE_POLICY_VERSION && !hypothesisPlan) throw new Error('Replay hypothesis receipt missing');
    if(hypothesisPlan && sha256Canonical(hypothesisPlan.decision)!==sha256Canonical(decision)) throw new Error('Replay hypothesis decision mismatch');
    return { created: false, run, frontier, decision, ...(hypothesisPlan?{hypothesisPlan}:{}),
      outbox: createControlOutboxEvent(decision, input.observation.taskId,input.traceparent,hypothesisPlan?.planId) };
  }

  const latest = await client.query<{ payload: EvidenceFrontier;payload_hash:string }>(
    'SELECT payload,payload_hash FROM evidence_frontiers WHERE run_id = $1 ORDER BY version DESC LIMIT 1', [input.runId]);
  if(latest.rows[0] && sha256Canonical(latest.rows[0].payload)!==latest.rows[0].payload_hash) throw new Error('Current frontier integrity check failed');
  if(run.frontierVersion!==(latest.rows[0]?.payload.version ?? 0)) throw new Error('Run frontier version mismatch');
  const previousActions = await client.query<{ fingerprint: string }>(`SELECT payload->'action'->>'fingerprint' AS fingerprint
    FROM next_step_decisions WHERE run_id = $1 AND payload ? 'action'`, [input.runId]);
  const now = input.now ?? new Date().toISOString();
  const frontier = reduceEvidenceFrontier({
    runId: input.runId,
    caseId: run.caseId,
    observation: input.observation,
    source: input.source,
    ...(input.artifactHash ? { artifactHash: input.artifactHash } : {}),
    ...(latest.rows[0]?.payload ? { current: latest.rows[0].payload } : {}),
    now,
  });
  if(run.policyVersion===SOC_EVIDENCE_POLICY_VERSION && !hypothesisPolicy) throw new Error('SOC hypothesis authority policy unavailable');
  const hypothesisPlan=hypothesisPolicy?.({run,frontier,now,
    previousActionFingerprints:previousActions.rows.map(item=>item.fingerprint).filter(Boolean)});
  if(hypothesisPlan && (hypothesisPlan.runId!==run.runId || hypothesisPlan.caseId!==run.caseId || hypothesisPlan.frontierVersion!==frontier.version ||
    hypothesisPlan.policyVersion!==run.policyVersion || hypothesisPlan.decision.policyVersion!==run.policyVersion ||
    hypothesisPlan.decision.runId!==run.runId || hypothesisPlan.decision.caseId!==run.caseId || hypothesisPlan.decision.frontierVersion!==frontier.version ||
    hypothesisPlan.selectedFactIds.some(id=>!frontier.facts.some(f=>f.factId===id)) ||
    hypothesisPlan.selectedEvidenceIds.some(id=>!frontier.evidenceRefs.includes(id)))) throw new Error('Hypothesis policy provenance mismatch');
  const decision = hypothesisPlan?.decision ?? planNextStep({
    run,
    frontier,
    proposal: input.proposal,
    previousActionFingerprints: previousActions.rows.map(item => item.fingerprint).filter(Boolean),
    now,
  });
  const outbox = createControlOutboxEvent(decision, input.observation.taskId, input.traceparent,hypothesisPlan?.planId);
  const frontierHash = sha256Canonical(frontier);
  const decisionHash = sha256Canonical(decision);

  await client.query(`INSERT INTO evidence_frontiers
    (run_id,case_id,version,observation_id,payload,payload_hash,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.runId, run.caseId, frontier.version, input.observation.observationId, JSON.stringify(frontier), frontierHash, now]);
  await client.query(`INSERT INTO next_step_decisions
    (decision_id,run_id,case_id,frontier_version,kind,reason_code,action_fingerprint,policy_version,payload,payload_hash,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [decision.decisionId, input.runId, run.caseId, frontier.version, decision.kind, decision.reasonCode,
      decision.action?.fingerprint ?? null, decision.policyVersion, JSON.stringify(decision), decisionHash, now]);
  if(hypothesisPlan) await client.query(`INSERT INTO hypothesis_plans
    (plan_id,run_id,case_id,frontier_version,policy_version,decision_id,payload,payload_hash,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [hypothesisPlan.planId,input.runId,run.caseId,frontier.version,hypothesisPlan.policyVersion,decision.decisionId,
      JSON.stringify(hypothesisPlan),sha256Canonical(hypothesisPlan),now]);
  await client.query(`INSERT INTO control_outbox
    (event_id,aggregate_id,event_type,payload,event_hash,created_at)
    VALUES ($1,$2,$3,$4,$5,$6)`,
    [outbox.eventId, outbox.aggregateId, outbox.eventType, JSON.stringify(outbox.payload), outbox.eventHash, outbox.createdAt]);

  const nextState = stateForDecision(decision);
  const queryIncrement = decision.kind === 'DISPATCH' && decision.action?.target === 'siem' ? 1 : 0;
  const updated = await client.query<RunRow>(`UPDATE investigation_runs SET
    state=$2, frontier_version=$3, depth=depth+1, external_queries_used=external_queries_used+$4,
    row_version=row_version+1, updated_at=$5 WHERE run_id=$1 RETURNING *`,
    [input.runId, nextState, frontier.version, queryIncrement, now]);
  const updatedRun = updated.rows[0];
  if (!updatedRun) throw new Error('Investigation run update failed');

  await client.query(`INSERT INTO audit_events
    (event_type,severity,actor_id,target_resource,action_payload,incident_id,event_hash)
    VALUES ('NEXT_STEP_DECIDED','INFO','gss-planner',$1,$2,$3,$4) ON CONFLICT (event_hash) WHERE event_hash IS NOT NULL DO NOTHING`,
    [input.runId, JSON.stringify({ observationId: input.observation.observationId, frontierVersion: frontier.version,
      decisionId: decision.decisionId, kind: decision.kind, reasonCode: decision.reasonCode,
      ...(hypothesisPlan?{hypothesisPlanId:hypothesisPlan.planId}: {}) }), run.caseId, outbox.eventHash]);
  return { created: true, run: mapRun(updatedRun), frontier, decision, outbox, ...(hypothesisPlan?{hypothesisPlan}: {}) };
}

async function readHypothesisPlan(client:PoolClient | Pool,runId:string,version:number):Promise<HypothesisPlan | undefined> {
  const result=await client.query<{
    payload:HypothesisPlan|null;payload_hash:string;plan_id:string;case_id:string;policy_version:string;decision_id:string;
    decision_payload:NextStepDecision|null;decision_hash:string;decision_run_id:string;decision_case_id:string;
    decision_frontier_version:number;decision_policy_version:string;
  }>(`SELECT CASE WHEN octet_length(h.payload::text)<=1500000 THEN h.payload END AS payload,
    h.payload_hash,h.plan_id,h.case_id,h.policy_version,h.decision_id,
    CASE WHEN octet_length(d.payload::text)<=1500000 THEN d.payload END AS decision_payload,
    d.payload_hash AS decision_hash,d.run_id AS decision_run_id,d.case_id AS decision_case_id,
    d.frontier_version AS decision_frontier_version,d.policy_version AS decision_policy_version
    FROM hypothesis_plans h LEFT JOIN next_step_decisions d ON d.decision_id=h.decision_id
    WHERE h.run_id=$1 AND h.frontier_version=$2`,[runId,version]);
  const row=result.rows[0];if(!row) return undefined;
  const plan=row.payload,decision=row.decision_payload;
  const planIdentity=plan?(({planId:_id,...payload})=>sha256Canonical(payload))(plan):null;
  if(!plan || !decision || sha256Canonical(plan)!==row.payload_hash ||
    plan.planId!=='HPLAN-'+planIdentity?.slice(0,32) ||
    plan.schemaVersion!=='gss.hypothesis-plan.v1' || plan.runId!==runId || plan.frontierVersion!==version ||
    plan.planId!==row.plan_id || plan.caseId!==row.case_id || plan.policyVersion!==row.policy_version ||
    !plan.decision || sha256Canonical(plan.decision)!==sha256Canonical(decision) ||
    sha256Canonical(decision)!==row.decision_hash || decision.schemaVersion!=='gss.next-step.v1' ||
    decision.decisionId!==row.decision_id || decision.runId!==runId || decision.caseId!==plan.caseId ||
    decision.frontierVersion!==version || decision.policyVersion!==plan.policyVersion ||
    row.decision_run_id!==runId || row.decision_case_id!==plan.caseId || row.decision_frontier_version!==version ||
    row.decision_policy_version!==plan.policyVersion) {
    throw Object.assign(new Error('Hypothesis plan integrity check failed'),{statusCode:409});
  }
  return plan;
}

/** Use a caller-owned repeatable-read transaction to avoid mixing frontier/run versions. */
export async function readCaseInvestigationSnapshot(client: PoolClient, caseId: string) {
  const row=(await client.query<RunRow>(
    'SELECT * FROM investigation_runs WHERE case_id=$1 ORDER BY updated_at DESC,run_id LIMIT 1',[caseId])).rows[0];
  if(!row)return null;
  const run=mapRun(row);
  const retained=(await client.query<{payload:EvidenceFrontier|null;payload_hash:string}>(
    `SELECT CASE WHEN octet_length(payload::text)<=1500000 THEN payload END AS payload,payload_hash
     FROM evidence_frontiers WHERE run_id=$1 AND version=$2`,[run.runId,run.frontierVersion])).rows[0];
  if(!retained && run.frontierVersion===0)return {run,frontier:null};
  if(!retained?.payload || sha256Canonical(retained.payload)!==retained.payload_hash ||
    retained.payload.schemaVersion!=='gss.evidence-frontier.v1' ||
    retained.payload.runId!==run.runId || retained.payload.caseId!==caseId || retained.payload.version!==run.frontierVersion) {
    throw Object.assign(new Error('report_frontier_integrity_or_size_failed'),{statusCode:409});
  }
  const hypothesisPlan=run.policyVersion===SOC_EVIDENCE_POLICY_VERSION?
    await readHypothesisPlan(client,run.runId,run.frontierVersion):undefined;
  if(run.policyVersion===SOC_EVIDENCE_POLICY_VERSION && !hypothesisPlan) {
    throw Object.assign(new Error('report_hypothesis_receipt_missing'),{statusCode:409});
  }
  const frontier=retained.payload;
  const factIds=new Set(Array.isArray(frontier.facts)?frontier.facts.map(f=>f?.factId):[]);
  const evidenceIds=new Set(Array.isArray(frontier.evidenceRefs)?frontier.evidenceRefs:[]);
  if(hypothesisPlan && (hypothesisPlan.caseId!==caseId || hypothesisPlan.policyVersion!==run.policyVersion ||
    !Array.isArray(frontier.facts) || !Array.isArray(frontier.evidenceRefs) ||
    !Array.isArray(hypothesisPlan.selectedFactIds) || !Array.isArray(hypothesisPlan.selectedEvidenceIds) ||
    !Array.isArray(hypothesisPlan.hypotheses) || hypothesisPlan.hypotheses.length>16 ||
    hypothesisPlan.selectedFactIds.some(id=>!factIds.has(id)) ||
    hypothesisPlan.selectedEvidenceIds.some(id=>!evidenceIds.has(id)) ||
    hypothesisPlan.hypotheses.some(h=>!h || !Array.isArray(h.factIds) || !Array.isArray(h.evidenceIds) ||
      h.factIds.some(id=>!factIds.has(id)) || h.evidenceIds.some(id=>!evidenceIds.has(id))))) {
    throw Object.assign(new Error('report_plan_binding_failed'),{statusCode:409});
  }
  return {run,frontier:retained.payload,...(hypothesisPlan?{hypothesisPlan}:{})};
}

/** Authority desk reads one committed version even if a result arrives between SQL statements. */
export async function readCaseInvestigation(pool:Pool,caseId:string) {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(caseId))throw Object.assign(new Error('invalid_case_id'),{statusCode:422});
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    const snapshot=await readCaseInvestigationSnapshot(client,caseId);
    await client.query('COMMIT');return snapshot;
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}

export class PostgresInvestigationLoopStore {
  public constructor(private readonly pool: Pool) {}

  public static fromEnvironment(): PostgresInvestigationLoopStore | null {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    return new PostgresInvestigationLoopStore(new Pool({
      connectionString,
      max: 10,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    }));
  }

  public async ready(): Promise<void> { await this.pool.query('SELECT 1'); }
  public async close(): Promise<void> { await this.pool.end(); }

  public async ensureRun(input: CreateInvestigationRunInput, client?: PoolClient): Promise<InvestigationRun> {
    const now = input.now ?? new Date().toISOString();
    const deadlineAt = input.budget?.deadlineAt ?? new Date(new Date(now).getTime() + 30 * 60_000).toISOString();
    if (new Date(deadlineAt).getTime() <= new Date(now).getTime()) throw new Error('Investigation deadline must be in the future');
    const maxDepth = integer(input.budget?.maxDepth ?? 5, 'maxDepth', 1, 100);
    const maxExternalQueries = integer(input.budget?.maxExternalQueries ?? 10, 'maxExternalQueries', 0);
    const maxCostMicros = integer(input.budget?.maxCostMicros ?? 5_000_000, 'maxCostMicros', 0);
    const policyVersion = input.policyVersion ?? 'gss.deterministic-planner.v1';
    const runId = `RUN-${sha256Canonical({ caseId: input.caseId, policyVersion }).slice(0, 32)}`;
    const result = await (client ?? this.pool).query<RunRow>(`INSERT INTO investigation_runs
      (run_id,case_id,state,max_depth,deadline_at,max_external_queries,max_cost_micros,policy_version,requested_by,created_at,updated_at)
      VALUES ($1,$2,'ACTIVE',$3,$4,$5,$6,$7,$8,$9,$9)
      ON CONFLICT (run_id) DO UPDATE SET updated_at = investigation_runs.updated_at
      RETURNING *`,
      [runId, input.caseId, maxDepth, deadlineAt, maxExternalQueries, maxCostMicros, policyVersion, input.requestedBy, now]);
    const row = result.rows[0];
    if (!row) throw new Error('Failed to create investigation run');
    return mapRun(row);
  }

  public async getRun(runId: string): Promise<InvestigationRun | null> {
    const result = await this.pool.query<RunRow>('SELECT * FROM investigation_runs WHERE run_id = $1', [runId]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  public async getFrontier(runId: string, version?: number): Promise<EvidenceFrontier | null> {
    const result = version === undefined
      ? await this.pool.query<{ payload: EvidenceFrontier; payload_hash: string }>(
        'SELECT payload,payload_hash FROM evidence_frontiers WHERE run_id = $1 ORDER BY version DESC LIMIT 1', [runId])
      : await this.pool.query<{ payload: EvidenceFrontier; payload_hash: string }>(
        'SELECT payload,payload_hash FROM evidence_frontiers WHERE run_id = $1 AND version = $2', [runId, version]);
    const row = result.rows[0];
    if (!row) return null;
    if (sha256Canonical(row.payload) !== row.payload_hash) throw new Error('Evidence frontier integrity check failed');
    return row.payload;
  }

  public async commitObservationAndDecision(input: CommitObservationInput, policy?:HypothesisDecisionPolicy): Promise<CommitObservationResult> {
    return this.transaction(client => commitObservationAndDecisionWithClient(client, input,policy));
  }

  public async getHypothesisPlan(runId:string,version:number):Promise<HypothesisPlan | undefined> {return readHypothesisPlan(this.pool,runId,version);}

  public async recordModelUsage(record: ModelUsageRecord): Promise<{ created: boolean }> {
    for (const [name, value] of Object.entries({
      inputTokens: record.inputTokens, outputTokens: record.outputTokens, cachedTokens: record.cachedTokens,
      latencyMs: record.latencyMs, retryCount: record.retryCount, estimatedCostMicros: record.estimatedCostMicros,
      cacheWriteTokens: record.cacheWriteTokens ?? null,
    })) {
      if (value === null && !['latencyMs','retryCount'].includes(name)) continue;
      integer(value as number, name, 0);
    }
    const payloadHash=modelUsagePayloadHash(record);
    return this.transaction(async client=>{
    await settleModelReservation(client,record);
    const result = await client.query<{ inserted: boolean }>(`INSERT INTO model_usage
      (usage_id,case_id,task_id,trace_id,model,reasoning_effort,route_reason,input_tokens,output_tokens,cached_tokens,
       latency_ms,retry_count,estimated_cost_micros,status,created_at,cache_write_tokens,payload_hash,reservation_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (usage_id) DO NOTHING RETURNING true AS inserted`,
      [record.usageId, record.caseId, record.taskId ?? null, record.traceId, record.model, record.reasoningEffort,
        record.routeReason, record.inputTokens, record.outputTokens, record.cachedTokens, record.latencyMs,
        record.retryCount, record.estimatedCostMicros, record.status, record.createdAt, record.cacheWriteTokens ?? null,payloadHash,record.reservationId ?? null]);
    const created=result.rows[0]?.inserted ?? false;
    if(!created) {
      const previous=await client.query('SELECT payload_hash FROM model_usage WHERE usage_id=$1',[record.usageId]);
      if(previous.rows[0]?.payload_hash!==payloadHash) throw Object.assign(new Error('model_usage_id_payload_mismatch'),{statusCode:409});
    } else {
      await client.query(`UPDATE investigation_runs SET cost_micros_used=cost_micros_used+COALESCE($2::bigint,0),
        cost_accounting_unknown=cost_accounting_unknown OR $2::bigint IS NULL,row_version=row_version+1 WHERE case_id=$1 AND state='ACTIVE'`,
        [record.caseId,record.estimatedCostMicros]);
    }
    return {created};
    });
  }

  public async claimOutbox(workerId: string, limit = 25, lockTtlMs = 60_000,
    kind: 'decision' | 'initial' = 'decision', eventIds?: string[]): Promise<ClaimedOutboxEvent[]> {
    integer(limit, 'limit', 1, 100);
    integer(lockTtlMs, 'lockTtlMs', 1_000, 600_000);
    const result = await this.pool.query<{ payload: Record<string, unknown>; event_id: string; aggregate_id: string;
      event_type: ControlOutboxEvent['eventType']; event_hash: string; created_at: Date | string; attempts: number }>(`WITH candidates AS (
        SELECT event_id FROM control_outbox
        WHERE published_at IS NULL AND event_type = 'TASK_DISPATCH_REQUESTED' AND next_attempt_at <= now()
          AND ($5::text[] IS NULL OR event_id=ANY($5))
          AND CASE WHEN $4 = 'initial' THEN payload->>'schemaVersion' = 'gss.initial-dispatch.v1'
            ELSE COALESCE(payload->>'schemaVersion', '') <> 'gss.initial-dispatch.v1' END
          AND (locked_at IS NULL OR locked_at < now() - ($3 * interval '1 millisecond'))
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2
      )
      UPDATE control_outbox o SET locked_by=$1, locked_at=now(), attempts=o.attempts+1
      FROM candidates c WHERE o.event_id=c.event_id
      RETURNING o.event_id,o.aggregate_id,o.event_type,o.payload,o.event_hash,o.created_at,o.attempts`,
      [workerId, limit, lockTtlMs, kind, eventIds ?? null]);
    return result.rows.map(row => ({
      attempts: row.attempts,
      event: {
        schemaVersion: 'gss.control-outbox.v1',
        eventId: row.event_id,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        eventHash: row.event_hash,
        createdAt: iso(row.created_at),
      },
    }));
  }

  public async markOutboxPublished(eventId: string, workerId: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE control_outbox SET published_at=now(), locked_by=NULL, locked_at=NULL, last_error=NULL
      WHERE event_id=$1 AND locked_by=$2 AND published_at IS NULL`, [eventId, workerId]);
    return result.rowCount === 1;
  }

  public async releaseOutbox(eventId: string, workerId: string, error: string, retryAt: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE control_outbox SET locked_by=NULL, locked_at=NULL, last_error=$3, next_attempt_at=$4
      WHERE event_id=$1 AND locked_by=$2 AND published_at IS NULL`, [eventId, workerId, error.slice(0, 2_000), retryAt]);
    return result.rowCount === 1;
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
