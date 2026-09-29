import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { sha256Canonical, type EvidenceFrontier, type NextStepDecision, type ObservationPack } from '@asq/sdk';
import { PostgresInvestigationLoopStore, commitObservationAndDecisionWithClient } from '../src/loop-store.js';

const now = '2026-09-27T00:00:00.000Z';
const runRow = {
  run_id: 'run-1', case_id: 'case-1', state: 'ACTIVE', frontier_version: 0, depth: 0,
  max_depth: 5, deadline_at: '2026-09-28T00:00:00.000Z', external_queries_used: 0,
  max_external_queries: 5, cost_micros_used: 0, max_cost_micros: 1_000_000,
  policy_version: 'gss.planner.v1', created_at: now, updated_at: now,
};
const observation: ObservationPack = {
  observationId: 'obs-1', caseId: 'case-1', taskId: 'task-1', summary: 'verified',
  facts: [{ key: 'hostname', value: 'host-a' }], evidenceRefs: ['EVD-1'],
  originalBytes: 10, packedBytes: 8, createdAt: now,
};

function sqlText(value: unknown): string {
  return String(value).replace(/\s+/g, ' ').trim();
}

describe('PostgreSQL investigation loop transaction', () => {
  it('writes frontier, decision and outbox in deterministic order', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: unknown) => {
      const text = sqlText(sql);
      queries.push(text);
      if (text.startsWith('SELECT * FROM investigation_runs')) return { rows: [runRow], rowCount: 1 };
      if (text.includes('observation_id = $2')) return { rows: [], rowCount: 0 };
      if (text.includes('ORDER BY version DESC LIMIT 1')) return { rows: [], rowCount: 0 };
      if (text.includes("payload ? 'action'")) return { rows: [], rowCount: 0 };
      if (text.startsWith('UPDATE investigation_runs')) return {
        rows: [{ ...runRow, state: 'FINALIZED', frontier_version: 1, depth: 1, updated_at: now }], rowCount: 1,
      };
      return { rows: [], rowCount: 1 };
    });
    const result = await commitObservationAndDecisionWithClient({ query } as unknown as PoolClient, {
      runId: 'run-1', observation, source: 'ide', now,
      proposal: { kind: 'FINALIZE', reasonCode: 'VERIFIED', rationale: 'enough evidence' },
    });

    expect(result.created).toBe(true);
    expect(result.frontier.version).toBe(1);
    expect(result.decision.kind).toBe('FINALIZE');
    expect(result.run.state).toBe('FINALIZED');
    const frontierInsert = queries.findIndex(item => item.startsWith('INSERT INTO evidence_frontiers'));
    const decisionInsert = queries.findIndex(item => item.startsWith('INSERT INTO next_step_decisions'));
    const outboxInsert = queries.findIndex(item => item.startsWith('INSERT INTO control_outbox'));
    const runUpdate = queries.findIndex(item => item.startsWith('UPDATE investigation_runs'));
    expect(frontierInsert).toBeGreaterThan(-1);
    expect(decisionInsert).toBeGreaterThan(frontierInsert);
    expect(outboxInsert).toBeGreaterThan(decisionInsert);
    expect(runUpdate).toBeGreaterThan(outboxInsert);
  });

  it('returns the existing atomic decision when the same observation is replayed', async () => {
    const frontier: EvidenceFrontier = {
      schemaVersion: 'gss.evidence-frontier.v1', runId: 'run-1', caseId: 'case-1', version: 1,
      facts: [], contradictions: [], evidenceRefs: ['EVD-1'], sourceObservationIds: ['obs-1'], updatedAt: now,
    };
    const decision: NextStepDecision = {
      schemaVersion: 'gss.next-step.v1', decisionId: 'DEC-existing', runId: 'run-1', caseId: 'case-1',
      frontierVersion: 1, kind: 'BLOCKED', reasonCode: 'KNOWN', rationale: 'known',
      policyVersion: 'gss.planner.v1', createdAt: now,
    };
    const query = vi.fn(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.startsWith('SELECT * FROM investigation_runs')) return { rows: [runRow], rowCount: 1 };
      if (text.includes('observation_id = $2')) return { rows: [{ payload: frontier }], rowCount: 1 };
      if (text.includes('FROM next_step_decisions')) return { rows: [{ payload: decision }], rowCount: 1 };
      throw new Error(`Unexpected replay query: ${text}`);
    });
    const result = await commitObservationAndDecisionWithClient({ query } as unknown as PoolClient, {
      runId: 'run-1', observation, source: 'ide', now,
      proposal: { kind: 'FINALIZE', reasonCode: 'IGNORED_ON_REPLAY', rationale: 'ignored' },
    });
    expect(result.created).toBe(false);
    expect(result.decision).toEqual(decision);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('defines all durable M6 tables, idempotency constraints and outbox lease fields', async () => {
    const migration = await readFile(resolve('../../infra/postgres/migrations/003_investigation_loop.sql'), 'utf8');
    for (const table of ['investigation_runs', 'evidence_frontiers', 'next_step_decisions', 'control_outbox', 'model_usage']) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(migration).toContain('UNIQUE (run_id, observation_id)');
    expect(migration).toContain('UNIQUE (run_id, frontier_version)');
    expect(migration).toContain('locked_by TEXT');
    expect(migration).toContain('published_at TIMESTAMPTZ');
  });

  it('defines immutable durable artifact metadata', async () => {
    const migration = await readFile(resolve('../../infra/postgres/migrations/005_artifact_registry.sql'), 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS artifact_registry');
    expect(migration).toContain('UNIQUE (case_id, task_id, sha256)');
    expect(migration).toContain("storage_provider IN ('filesystem', 's3')");
  });

  it('rejects a persisted frontier whose payload no longer matches its hash', async () => {
    const frontier: EvidenceFrontier = {
      schemaVersion: 'gss.evidence-frontier.v1', runId: 'run-1', caseId: 'case-1', version: 1,
      facts: [], contradictions: [], evidenceRefs: ['EVD-1'], sourceObservationIds: ['obs-1'], updatedAt: now,
    };
    const query = vi.fn().mockResolvedValue({ rows: [{ payload: frontier, payload_hash: '0'.repeat(64) }], rowCount: 1 });
    const store = new PostgresInvestigationLoopStore({ query } as any);
    await expect(store.getFrontier('run-1', 1)).rejects.toThrow('Evidence frontier integrity check failed');

    query.mockResolvedValueOnce({ rows: [{ payload: frontier, payload_hash: sha256Canonical(frontier) }], rowCount: 1 });
    await expect(store.getFrontier('run-1', 1)).resolves.toEqual(frontier);
  });
});
