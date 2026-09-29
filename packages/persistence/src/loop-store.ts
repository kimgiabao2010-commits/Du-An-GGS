import { Pool, type PoolClient } from 'pg';
import {
  INVESTIGATION_RUN_SCHEMA_VERSION,
  createControlOutboxEvent,
  planNextStep,
  reduceEvidenceFrontier,
  sha256Canonical,
  type ControlOutboxEvent,
  type EvidenceFrontier,
  type InvestigationBudget,
  type InvestigationRun,
  type InvestigationRunState,
  type ModelUsageRecord,
  type NextStepDecision,
  type NextStepProposal,
  type ObservationPack,
} from '@asq/sdk';

export interface CreateInvestigationRunInput {
  caseId: string;
  requestedBy: string;
  policyVersion?: string;
  budget?: Partial<Pick<InvestigationBudget, 'maxDepth' | 'maxExternalQueries' | 'maxCostMicros'>> & { deadlineAt?: string };
  now?: string;
}

export interface CommitObservationInput {
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
}

export interface ClaimedOutboxEvent {
  event: ControlOutboxEvent;
  attempts: number;
}

interface RunRow {
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
    },
    usage: {
      externalQueries: Number(row.external_queries_used),
      costMicros: Number(row.cost_micros_used),
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
): Promise<CommitObservationResult> {
  const locked = await client.query<RunRow>('SELECT * FROM investigation_runs WHERE run_id = $1 FOR UPDATE', [input.runId]);
  const row = locked.rows[0];
  if (!row) throw new Error('Investigation run not found');
  const run = mapRun(row);
  if (run.caseId !== input.observation.caseId) throw new Error('Observation case does not match investigation run');

  const replay = await client.query<{ payload: EvidenceFrontier }>(
    'SELECT payload FROM evidence_frontiers WHERE run_id = $1 AND observation_id = $2',
    [input.runId, input.observation.observationId]);
  if (replay.rows[0]) {
    const frontier = replay.rows[0].payload;
    const decisionResult = await client.query<{ payload: NextStepDecision }>(
      'SELECT payload FROM next_step_decisions WHERE run_id = $1 AND frontier_version = $2', [input.runId, frontier.version]);
    const decision = decisionResult.rows[0]?.payload;
    if (!decision) throw new Error('Replay frontier exists without its atomic decision');
    return { created: false, run, frontier, decision,
      outbox: createControlOutboxEvent(decision, input.observation.taskId) };
  }

  const latest = await client.query<{ payload: EvidenceFrontier }>(
    'SELECT payload FROM evidence_frontiers WHERE run_id = $1 ORDER BY version DESC LIMIT 1', [input.runId]);
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
  const decision = planNextStep({
    run,
    frontier,
    proposal: input.proposal,
    previousActionFingerprints: previousActions.rows.map(item => item.fingerprint).filter(Boolean),
    now,
  });
  const outbox = createControlOutboxEvent(decision, input.observation.taskId);
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
      decisionId: decision.decisionId, kind: decision.kind, reasonCode: decision.reasonCode }), run.caseId, outbox.eventHash]);
  return { created: true, run: mapRun(updatedRun), frontier, decision, outbox };
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

  public async ensureRun(input: CreateInvestigationRunInput): Promise<InvestigationRun> {
    const now = input.now ?? new Date().toISOString();
    const deadlineAt = input.budget?.deadlineAt ?? new Date(new Date(now).getTime() + 30 * 60_000).toISOString();
    if (new Date(deadlineAt).getTime() <= new Date(now).getTime()) throw new Error('Investigation deadline must be in the future');
    const maxDepth = integer(input.budget?.maxDepth ?? 5, 'maxDepth', 1, 100);
    const maxExternalQueries = integer(input.budget?.maxExternalQueries ?? 10, 'maxExternalQueries', 0);
    const maxCostMicros = integer(input.budget?.maxCostMicros ?? 5_000_000, 'maxCostMicros', 0);
    const policyVersion = input.policyVersion ?? 'gss.deterministic-planner.v1';
    const runId = `RUN-${sha256Canonical({ caseId: input.caseId, policyVersion }).slice(0, 32)}`;
    const result = await this.pool.query<RunRow>(`INSERT INTO investigation_runs
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

  public async commitObservationAndDecision(input: CommitObservationInput): Promise<CommitObservationResult> {
    return this.transaction(client => commitObservationAndDecisionWithClient(client, input));
  }

  public async recordModelUsage(record: ModelUsageRecord): Promise<{ created: boolean }> {
    for (const [name, value] of Object.entries({
      inputTokens: record.inputTokens, outputTokens: record.outputTokens, cachedTokens: record.cachedTokens,
      latencyMs: record.latencyMs, retryCount: record.retryCount, estimatedCostMicros: record.estimatedCostMicros,
    })) integer(value, name, 0);
    const result = await this.pool.query<{ inserted: boolean }>(`INSERT INTO model_usage
      (usage_id,case_id,task_id,trace_id,model,reasoning_effort,route_reason,input_tokens,output_tokens,cached_tokens,
       latency_ms,retry_count,estimated_cost_micros,status,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (usage_id) DO NOTHING RETURNING true AS inserted`,
      [record.usageId, record.caseId, record.taskId ?? null, record.traceId, record.model, record.reasoningEffort,
        record.routeReason, record.inputTokens, record.outputTokens, record.cachedTokens, record.latencyMs,
        record.retryCount, record.estimatedCostMicros, record.status, record.createdAt]);
    return { created: result.rows[0]?.inserted ?? false };
  }

  public async claimOutbox(workerId: string, limit = 25, lockTtlMs = 60_000): Promise<ClaimedOutboxEvent[]> {
    integer(limit, 'limit', 1, 100);
    integer(lockTtlMs, 'lockTtlMs', 1_000, 600_000);
    const result = await this.pool.query<{ payload: Record<string, unknown>; event_id: string; aggregate_id: string;
      event_type: ControlOutboxEvent['eventType']; event_hash: string; created_at: Date | string; attempts: number }>(`WITH candidates AS (
        SELECT event_id FROM control_outbox
        WHERE published_at IS NULL AND event_type = 'TASK_DISPATCH_REQUESTED' AND next_attempt_at <= now()
          AND (locked_at IS NULL OR locked_at < now() - ($3 * interval '1 millisecond'))
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2
      )
      UPDATE control_outbox o SET locked_by=$1, locked_at=now(), attempts=o.attempts+1
      FROM candidates c WHERE o.event_id=c.event_id
      RETURNING o.event_id,o.aggregate_id,o.event_type,o.payload,o.event_hash,o.created_at,o.attempts`,
      [workerId, limit, lockTtlMs]);
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
