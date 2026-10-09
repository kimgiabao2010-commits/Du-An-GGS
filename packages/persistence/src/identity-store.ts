import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { sha256Canonical } from '@asq/sdk';

/** Identity mutations and their security audit commit or roll back together. */
export class PostgresIdentityStore {
  constructor(private readonly pool: Pool) {}

  async revoke(issuer: string, subject: string, actorId: string): Promise<void> {
    this.validate(issuer, subject, actorId);
    await this.transaction(async client => {
      await client.query(`INSERT INTO identity_revocations(issuer,subject,actor_id) VALUES($1,$2,$3)
        ON CONFLICT(issuer,subject) DO UPDATE SET revoked_before=now(),actor_id=EXCLUDED.actor_id`,
        [issuer, subject, actorId]);
      await this.audit(client, 'IDENTITY_REVOKED', actorId, 'identity', { issuer, subject });
    });
  }

  async grantCase(caseId: string, issuer: string, subject: string, actorId: string): Promise<{ replay: boolean }> {
    this.validate(issuer, subject, actorId);
    if (!caseId || caseId.length > 256) throw Object.assign(new Error('invalid_case_id'), { statusCode: 422 });
    return this.transaction(async client => {
      const result = await client.query(`INSERT INTO case_access(case_id,issuer,subject,granted_by)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING case_id`, [caseId, issuer, subject, actorId]);
      if (!result.rowCount) return { replay: true };
      await this.audit(client, 'CASE_ACCESS_GRANTED', actorId, caseId, { caseId, issuer, subject }, caseId);
      return { replay: false };
    });
  }

  private validate(issuer: string, subject: string, actorId: string): void {
    if (![issuer, subject, actorId].every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 2048)) {
      throw Object.assign(new Error('invalid_identity_binding'), { statusCode: 422 });
    }
  }

  private async audit(client: PoolClient, type: string, actorId: string, target: string,
    payload: Record<string, string>, caseId?: string): Promise<void> {
    const eventHash = sha256Canonical({ eventId: randomUUID(), type, actorId, target, payload });
    await client.query(`INSERT INTO audit_events(event_type,severity,actor_id,target_resource,action_payload,incident_id,event_hash)
      VALUES($1,'WARNING',$2,$3,$4,$5,$6)`, [type, actorId, target, JSON.stringify(payload), caseId ?? null, eventHash]);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await operation(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
