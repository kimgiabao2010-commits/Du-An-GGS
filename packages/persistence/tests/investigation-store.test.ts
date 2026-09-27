import { describe, expect, it, vi } from 'vitest';
import { sha256Canonical } from '@asq/sdk';
import { PostgresInvestigationStore } from '../src/investigation-store.js';

function mockPool(handler: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>) {
  const query = vi.fn((sql: unknown, values?: unknown[]) => handler(String(sql), values));
  const client = { query, release: vi.fn() };
  return { pool: { connect: vi.fn().mockResolvedValue(client) } as any, query };
}

describe('durable approval boundary', () => {
  it('binds an idempotent request to canonical parameters, artifact and policy', async () => {
    const { pool, query } = mockPool(async () => ({ rows: [], rowCount: 1 }));
    const store = new PostgresInvestigationStore(pool);
    const input = {
      incidentId: 'case-1', action: 'CREATE_GITOPS_PR' as const, artifactHash: 'A'.repeat(64),
      parameters: { branch: 'codex/proposal', nested: { b: 2, a: 1 } }, policyVersion: 'gss.approval.v1',
      requestedBy: 'requester-1', expiresAt: new Date('2099-01-01T00:00:00.000Z'), payload: { note: 'proposal only' },
    };

    const first = await store.createApproval(input);
    const second = await store.createApproval(input);
    expect(first).toBe(second);
    expect(first).toMatch(/^APR-[a-f0-9]{32}$/);
    const insert = query.mock.calls.find(call => String(call[0]).includes('INSERT INTO approval_requests'));
    expect(insert).toBeDefined();
    expect(String(insert?.[0])).toContain('request_hash');
    expect(insert?.[1]?.[3]).toBe(input.artifactHash.toLowerCase());
    expect(insert?.[1]?.[8]).toBe(sha256Canonical(input.parameters));
    expect(insert?.[1]?.[9]).toBe(input.policyVersion);
  });

  it('requires two distinct non-requester approvers and only authorizes a proposal', async () => {
    const approvers = new Set<string>();
    let status = 'PENDING';
    const artifactHash = 'b'.repeat(64);
    const { pool } = mockPool(async (sql, values) => {
      if (sql.includes('SELECT incident_id')) return { rows: [{
        incident_id: 'case-1', requested_by: 'requester-1', artifact_hash: artifactHash,
        expires_at: new Date('2099-01-01T00:00:00.000Z'), status,
      }], rowCount: 1 };
      if (sql.includes('INSERT INTO approval_approvals')) {
        approvers.add(String(values?.[1]));
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT count(*)')) return { rows: [{ count: String(approvers.size) }], rowCount: 1 };
      if (sql.includes("SET status = 'APPROVED_FOR_PROPOSAL'")) status = 'APPROVED_FOR_PROPOSAL';
      return { rows: [], rowCount: 1 };
    });
    const store = new PostgresInvestigationStore(pool);

    await expect(store.approve('approval-1', 'requester-1', artifactHash))
      .resolves.toEqual({ status: 'REQUESTER_CANNOT_APPROVE' });
    await expect(store.approve('approval-1', 'lead-1', artifactHash))
      .resolves.toEqual({ status: 'PENDING', approvalCount: 1 });
    await expect(store.approve('approval-1', 'lead-1', artifactHash))
      .resolves.toEqual({ status: 'PENDING', approvalCount: 1 });
    await expect(store.approve('approval-1', 'lead-2', artifactHash))
      .resolves.toEqual({ status: 'APPROVED_FOR_PROPOSAL', approvalCount: 2 });
    expect(status).toBe('APPROVED_FOR_PROPOSAL');
  });

  it('fails closed when the approved artifact hash changes', async () => {
    const { pool } = mockPool(async sql => sql.includes('SELECT incident_id') ? { rows: [{
      incident_id: 'case-1', requested_by: 'requester-1', artifact_hash: 'c'.repeat(64),
      expires_at: new Date('2099-01-01T00:00:00.000Z'), status: 'PENDING',
    }], rowCount: 1 } : { rows: [], rowCount: 1 });
    const store = new PostgresInvestigationStore(pool);
    await expect(store.approve('approval-1', 'lead-1', 'd'.repeat(64)))
      .resolves.toEqual({ status: 'ARTIFACT_MISMATCH' });
  });
});
