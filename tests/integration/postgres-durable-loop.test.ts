import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresRuntimeStore } from '../../packages/persistence/src/runtime-store.ts';
import { PostgresArtifactRegistry } from '../../packages/persistence/src/artifact-store.ts';
import type { GssResultContract, GssTaskContract, NextStepProposal, ObservationPack } from '../../packages/sdk/src/index.ts';

const enabled = Boolean(process.env.DATABASE_URL);
let pool: Pool | undefined;
let store: PostgresRuntimeStore | undefined;

beforeAll(async () => {
  if (!enabled) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  store = new PostgresRuntimeStore(pool);
  await store.ready();
});

afterAll(async () => { await store?.close(); });

describe.skipIf(!enabled)('PostgreSQL durable investigation loop', () => {
  it('stores unknown usage as NULL, with UNKNOWN cost status, not zero', async () => {
    if (!store || !pool) throw new Error('PostgreSQL unavailable');
    const suffix = randomUUID(); const caseId = `usage-${suffix}`;
    await store.ensureCase(caseId,'ci');
    const run=await store.ensureInvestigationRun(caseId,'ci');
    const input = { schemaVersion:'gss.model-usage.v1' as const,usageId:suffix,caseId,traceId:'fixture-trace',
      model:'gpt-5.6-sol',reasoningEffort:'medium',routeReason:'fixture',inputTokens:null,outputTokens:null,cachedTokens:null,
      cacheWriteTokens:null,latencyMs:1,retryCount:0,estimatedCostMicros:null,status:'FAILED' as const,createdAt:new Date().toISOString() };
    expect(await store.recordModelUsage(input)).toEqual({created:true});
    expect(await store.recordModelUsage(input)).toEqual({created:false});
    await expect(store.recordModelUsage({...input,outputTokens:1})).rejects.toThrow('model_usage_id_payload_mismatch');
    expect((await store.getInvestigationRun(run.runId))?.usage.costUnknown).toBe(true);
    const row = (await pool.query('SELECT input_tokens,output_tokens,cached_tokens,estimated_cost_micros,cost_status FROM model_usage WHERE usage_id=$1',[suffix])).rows[0];
    expect(row).toEqual({input_tokens:null,output_tokens:null,cached_tokens:null,estimated_cost_micros:null,cost_status:'UNKNOWN'});
  });
  it('persists idempotent task creation, frontier, decision and outbox atomically', async () => {
    if (!store || !pool) throw new Error('PostgreSQL test store was not initialized');
    const suffix = randomUUID();
    const caseId = `ci-case-${suffix}`;
    const task: GssTaskContract = {
      schemaVersion: 'gss.task.v1', taskId: `TSK-${suffix}`, caseId, idempotencyKey: `idem-${suffix}`,
      source: 'standalone', target: 'cli', action: 'inspect_hostname', parameters: {}, riskLevel: 'read_only',
      contextRefs: [], timeoutMs: 15_000, createdAt: new Date().toISOString(),
    };
    const observation: ObservationPack = {
      observationId: `OBS-${suffix}`, caseId, taskId: task.taskId, summary: 'hostname verified',
      facts: [{ key: 'host.name', value: 'staging-host' }], evidenceRefs: [`EVD-${suffix}`],
      originalBytes: 16, packedBytes: 16, createdAt: new Date().toISOString(),
    };
    const proposal: NextStepProposal = {
      kind: 'DISPATCH', reasonCode: 'CI_FOLLOW_UP', rationale: 'continue bounded read-only collection',
      action: { target: 'cli', action: 'inspect_system', parameters: {}, riskLevel: 'read_only' },
    };
    const result: GssResultContract = {
      schemaVersion: 'gss.result.v1', taskId: task.taskId, caseId, executor: 'cli', status: 'COMPLETED',
      result: { summary: observation.summary, action: task.action }, evidenceRefs: observation.evidenceRefs,
      errors: [], metrics: { durationMs: 4, outputBytes: 16 }, completedAt: new Date().toISOString(),
    };

    await store.ensureCase(caseId, 'ci');
    const run = await store.ensureInvestigationRun(caseId, 'ci');
    expect((await store.createTask(task, 'ci', { runId: run.runId })).created).toBe(true);
    expect((await store.createTask(task, 'ci', { runId: run.runId })).created).toBe(false);
    const artifacts = new PostgresArtifactRegistry(pool);
    const artifactInput = { caseId, taskId: task.taskId, sha256: 'a'.repeat(64), bytes: 16,
      ref: `artifact://evidence/${caseId}/${task.taskId}.txt`, storageProvider: 'filesystem' as const, mediaType: 'text/plain' };
    expect((await artifacts.register(artifactInput)).created).toBe(true);
    expect((await artifacts.register(artifactInput)).created).toBe(false);
    await expect(artifacts.register({ ...artifactInput, ref: `${artifactInput.ref}.mutated` }))
      .rejects.toThrow(/conflicts with immutable metadata/);
    expect(await artifacts.exists(caseId, task.taskId, artifactInput.sha256)).toBe(true);
    await expect(pool.query('UPDATE artifact_registry SET storage_ref=$1 WHERE case_id=$2',[artifactInput.ref+'.changed',caseId]))
      .rejects.toThrow('artifact_metadata_immutable');

    const committed = await store.recordResult(result, observation, {
      runId: run.runId, source: 'cli', proposal,
    });
    expect(committed && 'decision' in committed && committed.created).toBe(true);
    if (!committed || !('decision' in committed)) throw new Error('loop commit did not return a decision');
    expect(committed.frontier.version).toBe(1);
    expect(committed.decision.kind).toBe('DISPATCH');

    const replay = await store.recordResult(result, observation, { runId: run.runId, source: 'cli', proposal });
    expect(replay && 'decision' in replay && replay.created).toBe(false);

    const counts = await pool.query<{ frontiers: string; decisions: string; outbox: string }>(
      `SELECT
        (SELECT count(*) FROM evidence_frontiers WHERE run_id=$1)::text AS frontiers,
        (SELECT count(*) FROM next_step_decisions WHERE run_id=$1)::text AS decisions,
        (SELECT count(*) FROM control_outbox WHERE aggregate_id=$1)::text AS outbox`, [run.runId]);
    expect(counts.rows[0]).toEqual({ frontiers: '1', decisions: '1', outbox: '2' });
  });
});
