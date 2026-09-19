import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { InvestigationOutcome, InvestigationRequest } from '@asq/sdk';

export interface ApprovalRequestInput {
  incidentId: string;
  action: 'CREATE_GITOPS_PR' | 'DEPLOY_CANARY' | 'ROLLBACK';
  artifactHash: string;
  requestedBy: string;
  expiresAt: Date;
  payload: Record<string, unknown>;
}

export interface ApprovalDecision {
  status: 'PENDING' | 'APPROVED' | 'EXPIRED' | 'NOT_FOUND' | 'ARTIFACT_MISMATCH' | 'REQUESTER_CANNOT_APPROVE';
  approvalCount?: number;
}

export class PostgresInvestigationStore {
  public constructor(private readonly pool: Pool) {}

  public static fromEnvironment(): PostgresInvestigationStore | null {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    return new PostgresInvestigationStore(new Pool({ connectionString, max: 10, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined }));
  }

  public async close(): Promise<void> { await this.pool.end(); }

  public async recordOutcome(request: InvestigationRequest, outcome: InvestigationOutcome): Promise<{ created: boolean }> {
    return this.transaction(async client => {
      await client.query(`INSERT INTO incidents (incident_id, status) VALUES ($1, $2)
        ON CONFLICT (incident_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`, [request.incidentId, outcome.status]);
      const task = await client.query<{ inserted: boolean }>(`INSERT INTO investigation_tasks
        (task_id, incident_id, idempotency_key, requested_by, status, indicator_type, indicator_value, range_start, range_end)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
        RETURNING (xmax = 0) AS inserted`, [request.taskId, request.incidentId, request.idempotencyKey, request.requestedBy,
        outcome.status, request.indicator.type, request.indicator.value, request.timeRange.start, request.timeRange.end]);
      if (outcome.evidence) {
        const evidence = outcome.evidence;
        await client.query(`INSERT INTO siem_query_runs (query_hash, task_id, adapter, source_instance, queried_at, range_start, range_end, result_count, truncated, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUCCEEDED') ON CONFLICT (query_hash, task_id) DO NOTHING`,
          [evidence.provenance.queryHash, request.taskId, evidence.provenance.adapter, evidence.provenance.sourceInstance,
            evidence.provenance.queriedAt, evidence.provenance.timeRange.start, evidence.provenance.timeRange.end,
            evidence.provenance.resultCount, evidence.provenance.truncated]);
        await client.query(`INSERT INTO investigation_evidence (evidence_id, incident_id, task_id, event_ids, events, provenance)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (evidence_id) DO NOTHING`,
          [evidence.evidenceId, evidence.incidentId, evidence.taskId, evidence.eventIds, JSON.stringify(evidence.events), JSON.stringify(evidence.provenance)]);
      }
      await client.query(`INSERT INTO investigation_verdicts (incident_id, task_id, verdict, evidence_ids, policy_version, rationale)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (task_id) DO UPDATE SET verdict = EXCLUDED.verdict,
        evidence_ids = EXCLUDED.evidence_ids, policy_version = EXCLUDED.policy_version, rationale = EXCLUDED.rationale, created_at = now()`,
        [outcome.verdict.incidentId, outcome.verdict.taskId, outcome.verdict.verdict, outcome.verdict.evidenceIds,
          outcome.verdict.policyVersion, outcome.verdict.rationale]);
      await this.audit(client, request.requestedBy, request.incidentId, 'INVESTIGATION_OUTCOME', {
        taskId: request.taskId, status: outcome.status, failure: outcome.failure?.code ?? null,
        evidenceId: outcome.evidence?.evidenceId ?? null, verdict: outcome.verdict.verdict
      });
      return { created: task.rows[0]?.inserted ?? false };
    });
  }

  public async createApproval(input: ApprovalRequestInput): Promise<string> {
    if (!/^[a-f0-9]{64}$/i.test(input.artifactHash)) throw new Error('artifactHash must be a SHA-256 hex digest');
    if (input.expiresAt.getTime() <= Date.now()) throw new Error('approval expiry must be in the future');
    const id = randomUUID();
    await this.transaction(async client => {
      await client.query(`INSERT INTO approval_requests (approval_id, incident_id, action, artifact_hash, requested_by, expires_at, payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, input.incidentId, input.action, input.artifactHash, input.requestedBy,
        input.expiresAt, JSON.stringify(input.payload)]);
      await this.audit(client, input.requestedBy, input.incidentId, 'APPROVAL_REQUESTED', { approvalId: id, action: input.action, artifactHash: input.artifactHash });
    });
    return id;
  }

  public async approve(approvalId: string, approvedBy: string, artifactHash: string): Promise<ApprovalDecision> {
    return this.transaction(async client => {
      const found = await client.query<{ incident_id: string; requested_by: string; artifact_hash: string; expires_at: Date; status: string }>(
        'SELECT incident_id, requested_by, artifact_hash, expires_at, status FROM approval_requests WHERE approval_id = $1 FOR UPDATE', [approvalId]);
      const request = found.rows[0];
      if (!request) return { status: 'NOT_FOUND' };
      if (request.expires_at.getTime() <= Date.now()) {
        await client.query("UPDATE approval_requests SET status = 'EXPIRED' WHERE approval_id = $1", [approvalId]);
        return { status: 'EXPIRED' };
      }
      if (request.artifact_hash !== artifactHash) return { status: 'ARTIFACT_MISMATCH' };
      if (request.requested_by === approvedBy) return { status: 'REQUESTER_CANNOT_APPROVE' };
      await client.query('INSERT INTO approval_approvals (approval_id, approved_by) VALUES ($1,$2) ON CONFLICT DO NOTHING', [approvalId, approvedBy]);
      const count = await client.query<{ count: string }>('SELECT count(*) FROM approval_approvals WHERE approval_id = $1', [approvalId]);
      const approvalCount = Number(count.rows[0]?.count ?? 0);
      const approved = approvalCount >= 2;
      if (approved) await client.query("UPDATE approval_requests SET status = 'APPROVED', approved_at = now() WHERE approval_id = $1", [approvalId]);
      await this.audit(client, approvedBy, request.incident_id, 'APPROVAL_DECISION', { approvalId, approved, approvalCount, artifactHash });
      return { status: approved ? 'APPROVED' : 'PENDING', approvalCount };
    });
  }

  private async audit(client: PoolClient, actorId: string, incidentId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    const serialized = JSON.stringify(payload);
    const eventHash = createHash('sha256').update(`${eventType}:${incidentId}:${serialized}`).digest('hex');
    await client.query(`INSERT INTO audit_events (event_type, severity, actor_id, target_resource, action_payload, incident_id, event_hash)
      VALUES ($1,'INFO',$2,$3,$4,$5,$6)`, [eventType, actorId, incidentId, serialized, incidentId, eventHash]);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
