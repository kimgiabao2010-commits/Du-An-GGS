import { PgBoss } from 'pg-boss';
import type { Pool } from 'pg';

/** Queue is a delivery mechanism, never a second task lifecycle writer. */
export class PostgresDispatchQueue {
  private boss?: PgBoss;
  constructor(private readonly pool: Pool) {}
  async start(): Promise<void> {
    const schema = String((await this.pool.query('SELECT current_schema() AS schema')).rows[0].schema);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Unsafe queue schema');
    this.boss = new PgBoss({ schema, db: { executeSql: (sql, values) => this.pool.query(sql, values) },
      registerInstance: false, supervise: false, schedule: false, migrate: true, createSchema: false,
      openTelemetry: { enabled: false } });
    this.boss.on('error', () => { console.error('[Queue] PostgreSQL queue operation failed'); });
    await this.boss.start();
    for (const name of ['gss-initial','gss-decision']) await this.boss.createQueue(name, {
      policy: 'exclusive', expireInSeconds: 60, retryLimit: 20, retryDelay: 5, retryBackoff: true, retryDelayMax: 60,
    });
  }
  async acquire(kind: 'initial' | 'decision', limit: number): Promise<{ eventIds: string[]; settle: (claimed: string[]) => Promise<void> }> {
    if (!this.boss) throw new Error('Queue not ready');
    const boss = this.boss, name = 'gss-' + kind;
    // Recover jobs after authority restart. pg-boss owns job expiry/retry; the outbox remains authoritative.
    await boss.supervise(name);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const state = (await c.query('SELECT halted FROM control_runtime_state WHERE singleton=true FOR SHARE')).rows[0];
      if (!state || state.halted) { await c.query('ROLLBACK'); return { eventIds: [], settle: async () => {} }; }
      const rows = await c.query(`SELECT event_id FROM control_outbox WHERE published_at IS NULL
        AND event_type='TASK_DISPATCH_REQUESTED' AND next_attempt_at<=now()
        AND (locked_at IS NULL OR locked_at<now()-interval '60 seconds')
        AND CASE WHEN $1='initial' THEN payload->>'schemaVersion'='gss.initial-dispatch.v1'
          ELSE COALESCE(payload->>'schemaVersion','')<>'gss.initial-dispatch.v1' END
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2`, [kind, limit]);
      for (const row of rows.rows) await boss.send(name, { eventId: row.event_id }, {
        singletonKey: row.event_id, db: { executeSql: (sql, values) => c.query(sql, values) },
      });
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
    const jobs = await boss.fetch<{ eventId: string }>(name, { batchSize: limit, includeMetadata: true });
    return { eventIds: jobs.map(j => j.data.eventId), settle: async claimed => {
      // Completed means durable acquisition/handoff, not worker execution or result success.
      for (const job of jobs) {
        if (claimed.includes(job.data.eventId)) await boss.complete(name, job);
        else await boss.fail(name, job, { reason: 'Outbox lease unavailable or intent retired' });
      }
    } };
  }
  async close(): Promise<void> { await this.boss?.stop({ graceful: false }); }
}
