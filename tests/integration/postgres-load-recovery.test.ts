import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresRuntimeStore } from '../../packages/persistence/src/runtime-store.ts';
import type { GssResultContract, GssTaskContract, ObservationPack } from '../../packages/sdk/src/index.ts';

const enabled = Boolean(process.env.DATABASE_URL);
const caseCount = Math.min(50, Math.max(5, Number(process.env.GSS_LOAD_CASES ?? 12)));
let pool: Pool | undefined;
let store: PostgresRuntimeStore | undefined;

beforeAll(async () => {
  if (!enabled) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  store = new PostgresRuntimeStore(pool);
  await store.ready();
});
afterAll(async () => { await store?.close(); });

describe.skipIf(!enabled)('PostgreSQL concurrent load and restart recovery', () => {
  it('preserves one logical transition per case across concurrent writes and a fresh store instance', async () => {
    if (!store || !pool || !process.env.DATABASE_URL) throw new Error('PostgreSQL test store was not initialized');
    const scenarios = Array.from({ length: caseCount }, (_, index) => {
      const suffix = `${index}-${randomUUID()}`;
      const caseId = `load-case-${suffix}`, taskId = `TSK-${suffix}`;
      const task: GssTaskContract = { schemaVersion: 'gss.task.v1', taskId, caseId, idempotencyKey: `idem-${suffix}`,
        source: 'standalone', target: 'cli', action: 'inspect_hostname', parameters: {}, riskLevel: 'read_only',
        contextRefs: [], timeoutMs: 15_000, createdAt: new Date().toISOString() };
      const observation: ObservationPack = { observationId: `OBS-${suffix}`, caseId, taskId, summary: `host-${index}`,
        facts: [{ key: 'host.name', value: `host-${index}` }], evidenceRefs: [`EVD-${suffix}`], originalBytes: 8,
        packedBytes: 8, createdAt: new Date().toISOString() };
      const result: GssResultContract = { schemaVersion: 'gss.result.v1', taskId, caseId, executor: 'cli', status: 'COMPLETED',
        result: { summary: observation.summary, action: task.action }, evidenceRefs: observation.evidenceRefs,
        errors: [], metrics: { durationMs: 1, outputBytes: 8 }, completedAt: new Date().toISOString() };
      return { caseId, task, observation, result };
    });

    const committed = await Promise.all(scenarios.map(async scenario => {
      await store!.ensureCase(scenario.caseId, 'load-test');
      const run = await store!.ensureInvestigationRun(scenario.caseId, 'load-test');
      await store!.createTask(scenario.task, 'load-test', { runId: run.runId });
      const loop = await store!.recordResult(scenario.result, scenario.observation, { runId: run.runId, source: 'cli',
        proposal: { kind: 'FINALIZE', reasonCode: 'LOAD_TEST_COMPLETE', rationale: 'bounded load verification' } });
      return { ...scenario, runId: run.runId, loop };
    }));
    expect(committed.every(item => item.loop && 'created' in item.loop && item.loop.created)).toBe(true);

    const restartPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    const restarted = new PostgresRuntimeStore(restartPool);
    try {
      await restarted.ready();
      for (const item of committed) {
        expect((await restarted.getInvestigationRun(item.runId))?.caseId).toBe(item.caseId);
        expect((await restarted.getEvidenceFrontier(item.runId))?.version).toBe(1);
        const replay = await restarted.recordResult(item.result, item.observation, { runId: item.runId, source: 'cli',
          proposal: { kind: 'FINALIZE', reasonCode: 'REPLAY_MUST_NOT_WIN', rationale: 'replay' } });
        expect(replay && 'created' in replay && replay.created).toBe(false);
      }
    } finally { await restarted.close(); }

    const runIds = committed.map(item => item.runId);
    const counts = await pool.query<{ frontiers: string; decisions: string }>(`SELECT
      (SELECT count(*) FROM evidence_frontiers WHERE run_id = ANY($1::text[]))::text AS frontiers,
      (SELECT count(*) FROM next_step_decisions WHERE run_id = ANY($1::text[]))::text AS decisions`, [runIds]);
    expect(counts.rows[0]).toEqual({ frontiers: String(caseCount), decisions: String(caseCount) });
  }, 30_000);
});
