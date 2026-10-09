import { Pool, type PoolClient } from 'pg';
import { workerDeliveryId, resultSubmissionHash, type WorkerDeliveryInput,
  type WorkerDeliveryRecord, type ResultSubmission } from '@asq/sdk';

const failure = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const iso = (value: Date | string) => new Date(value).toISOString();
export class PostgresWorkerDeliveryStore {
  constructor(private readonly pool: Pool) {}

  public async receive(input: WorkerDeliveryInput): Promise<WorkerDeliveryRecord> {
    if (input.schemaVersion !== 'gss.worker-delivery.v1' || typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 256 ||
      typeof input.caseId !== 'string' || !input.caseId || input.caseId.length > 256 || typeof input.workerId !== 'string' ||
      !['cli-worker-agent', 'ide-worker-agent', 'siem-worker-agent'].includes(input.workerId) ||
      !/^[a-f0-9]{64}$/.test(input.deliveryId) ||
      !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload) ||
      input.payload.taskId !== input.taskId || Buffer.byteLength(JSON.stringify(input.payload)) > 48_000 ||
      input.deliveryId !== workerDeliveryId({ workerId: input.workerId, caseId: input.caseId,
        taskId: input.taskId, payload: input.payload })) throw failure('invalid_worker_delivery', 422);
    return this.transaction(async client => {
      const row = (await client.query('SELECT * FROM runtime_tasks WHERE task_id=$1 FOR UPDATE', [input.taskId])).rows[0];
      if (!row) throw failure('task_not_found', 404);
      if (row.case_id !== input.caseId || row.assigned_worker !== input.workerId ||
        input.workerId !== `${row.target}-worker-agent`) throw failure('worker_delivery_provenance_denied', 403);
      const existing = (await client.query('SELECT * FROM worker_result_deliveries WHERE task_id=$1', [input.taskId])).rows[0];
      if (existing) {
        if (existing.delivery_id !== input.deliveryId) throw failure('worker_delivery_payload_mismatch', 409);
        return this.map(row, existing);
      }
      if (!['DISPATCHED', 'RUNNING'].includes(row.status) ||
        (await client.query('SELECT 1 FROM runtime_executions WHERE task_id=$1', [input.taskId])).rowCount) {
        throw failure('worker_delivery_task_not_accepting_results', 409);
      }
      const delivery = (await client.query(`INSERT INTO worker_result_deliveries
        (task_id,delivery_id,worker_id,case_id,payload) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [input.taskId, input.deliveryId, input.workerId, input.caseId, input.payload])).rows[0];
      return this.map(row, delivery);
    });
  }

  public async prepare(deliveryId: string, submission: ResultSubmission): Promise<ResultSubmission> {
    return this.transaction(async client => {
      const task = (await client.query('SELECT * FROM runtime_tasks WHERE task_id=$1 FOR UPDATE', [submission.result.taskId])).rows[0];
      if (!task) throw failure('task_not_found', 404);
      const delivery = (await client.query('SELECT * FROM worker_result_deliveries WHERE task_id=$1', [task.task_id])).rows[0];
      if (!delivery || delivery.delivery_id !== deliveryId || task.case_id !== submission.result.caseId ||
        task.target !== submission.result.executor) throw failure('worker_delivery_provenance_denied', 403);
      if (submission.result.status === 'COMPLETED' && delivery.payload.status !== 'SUCCESS') {
        throw failure('failed_worker_delivery_cannot_create_evidence', 422);
      }
      if (submission.result.status !== 'COMPLETED' && (submission.observation || submission.loop || submission.result.evidenceRefs.length)) {
        throw failure('failed_worker_delivery_cannot_create_evidence', 422);
      }
      if (delivery.prepared_payload) {
        if (resultSubmissionHash(delivery.prepared_payload) !== delivery.prepared_hash) throw failure('prepared_result_integrity_failed', 409);
        return delivery.prepared_payload; // First prepared envelope wins; all retries reuse it exactly.
      }
      await client.query(`UPDATE worker_result_deliveries SET prepared_payload=$2,prepared_hash=$3 WHERE task_id=$1`,
        [task.task_id, JSON.stringify(submission), resultSubmissionHash(submission)]);
      return submission;
    });
  }

  public async pending(limit = 25): Promise<WorkerDeliveryRecord[]> {
    const rows = await this.pool.query(`SELECT to_jsonb(t) AS task,to_jsonb(d) AS delivery FROM worker_result_deliveries d
      JOIN runtime_tasks t ON t.task_id=d.task_id WHERE d.committed_at IS NULL AND d.next_attempt_at <= now()
      ORDER BY d.received_at LIMIT $1`, [limit]);
    const records: WorkerDeliveryRecord[] = [];
    for (const row of rows.rows) {
      try { records.push(this.map(row.task, row.delivery)); }
      catch { await this.defer(row.delivery.delivery_id); } // A poisoned receipt cannot starve other valid results.
    }
    return records;
  }
  public async defer(deliveryId: string): Promise<void> {
    await this.pool.query(`UPDATE worker_result_deliveries SET attempts=attempts+1,
      next_attempt_at=now()+LEAST(300,POWER(2,LEAST(attempts+1,8)))*interval '1 second',
      last_error='Result processing failed; receipt retained for bounded retry/reconciliation'
      WHERE delivery_id=$1 AND committed_at IS NULL`, [deliveryId]);
  }
  private map(task: any, delivery: any): WorkerDeliveryRecord {
    if (workerDeliveryId({ workerId: delivery.worker_id, caseId: delivery.case_id,
      taskId: delivery.task_id, payload: delivery.payload }) !== delivery.delivery_id) {
      throw failure('worker_delivery_integrity_failed', 409);
    }
    if (delivery.prepared_payload && resultSubmissionHash(delivery.prepared_payload) !== delivery.prepared_hash) {
      throw failure('prepared_result_integrity_failed', 409);
    }
    return { schemaVersion: 'gss.worker-delivery.v1', deliveryId: delivery.delivery_id, workerId: delivery.worker_id,
      caseId: delivery.case_id, taskId: delivery.task_id, payload: delivery.payload,
      task: { schemaVersion: 'gss.task.v1', taskId: task.task_id, caseId: task.case_id, idempotencyKey: task.idempotency_key,
        source: task.source, target: task.target, action: task.action, parameters: task.parameters, riskLevel: task.risk_level,
        contextRefs: task.context_refs, timeoutMs: task.timeout_ms, createdAt: iso(task.created_at),
        ...(task.traceparent ? { traceparent: task.traceparent } : {}) },
      ...(task.run_id ? { runId: task.run_id } : {}), receivedAt: iso(delivery.received_at),
      startedAt: iso(task.started_at ?? delivery.received_at), committed: Boolean(delivery.committed_at),
      retryAt: iso(delivery.next_attempt_at),
      ...(delivery.prepared_payload ? { prepared: delivery.prepared_payload } : {}) };
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
