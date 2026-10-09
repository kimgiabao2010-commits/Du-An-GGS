import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
import { CentralCommandOrchestrator } from '../../services/standalone/src/command-center.ts';
import { HttpControlPlaneClient, controlPlaneClientFromEnvironment } from '../../services/standalone/src/control-plane-client.ts';
import { TokenSigner } from '../../packages/sdk/src/security/token-signer.ts';
import type { GssTaskContract, GssResultContract, ObservationPack } from '../../packages/sdk/src/runtime/contracts.ts';

const enabled = Boolean(process.env.DATABASE_URL);
const token = 'http-contract-test-token-at-least-32-characters';
let server: ControlPlaneServer;
let unsigned: ControlPlaneServer;
let db: Pool;
let base: string;
let unsignedBase: string;
const caseId = 'closure-http-' + randomUUID();
function task(): GssTaskContract {
  return { schemaVersion: 'gss.task.v1', taskId: randomUUID(), caseId, idempotencyKey: randomUUID(),
    source: 'standalone', target: 'cli', action: 'inspect_hostname', riskLevel: 'read_only',
    parameters: {}, contextRefs: [], timeoutMs: 15_000, createdAt: new Date().toISOString() };
}
async function request(path: string, payload?: unknown, auth = token, origin = base) {
  return fetch(origin + path, { method: payload === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' },
    ...(payload !== undefined ? { body: typeof payload === 'string' ? payload : JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(10_000) });
}
beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv('GSS_CONTROL_PLANE_TOKEN', token);
  vi.stubEnv('GSS_REQUIRE_ARTIFACT_SIGNATURE', 'false');
  vi.stubEnv('GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64', '');
  unsigned = new ControlPlaneServer(0);
  unsignedBase = 'http://127.0.0.1:' + await unsigned.ready();
  const { privateKey } = generateKeyPairSync('ed25519');
  vi.stubEnv('GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64', Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'));
  vi.stubEnv('GSS_ARTIFACT_SIGNING_KEY_ID', 'ephemeral-test-key');
  server = new ControlPlaneServer(0);
  base = 'http://127.0.0.1:' + await server.ready();
  db = new Pool({ connectionString: process.env.DATABASE_URL });
}, 20_000);
afterAll(async () => {
  await server?.close(); await unsigned?.close(); await db?.end(); vi.unstubAllEnvs();
});

describe('Control Plane authority fail closed', () => {
  it('requires configured authority and refuses startup when it is unavailable', async () => {
    vi.stubEnv('CONTROL_PLANE_URL', '');
    expect(() => controlPlaneClientFromEnvironment()).toThrow(/required/);
    const app = new CentralCommandOrchestrator(0, undefined,
      new TokenSigner('authority-test-secret-at-least-32-characters'),
      new HttpControlPlaneClient('http://127.0.0.1:1', token));
    try { await expect(app.ready()).rejects.toThrow(); }
    finally { await app.close(); }
  });
});

describe.skipIf(!enabled)('Control Plane HTTP contract with live PostgreSQL', () => {
  it('returns 201/200/409 and serializes concurrent payload conflicts across restart', async () => {
    const t = task();
    expect((await request('/control/v1/tasks', t)).status).toBe(201);
    for (let i = 0; i < 3; i++) expect((await request('/control/v1/tasks', t)).status).toBe(200);
    expect((await request('/control/v1/tasks', { ...t, parameters: { altered: true } })).status).toBe(409);
    expect((await request('/control/v1/tasks/' + t.taskId)).status).toBe(200);
    const race = task();
    const responses = await Promise.all([request('/control/v1/tasks', race),
      request('/control/v1/tasks', { ...race, taskId: randomUUID(), parameters: { conflict: true } })]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(Number((await db.query('SELECT count(*) FROM runtime_tasks WHERE idempotency_key=$1', [t.idempotencyKey])).rows[0].count)).toBe(1);
    expect(Number((await db.query('SELECT count(*) FROM runtime_tasks WHERE idempotency_key=$1', [race.idempotencyKey])).rows[0].count)).toBe(1);
    await server.close(); server = new ControlPlaneServer(0); base = 'http://127.0.0.1:' + await server.ready();
    expect((await request('/control/v1/tasks', t)).status).toBe(200);
  });
  it('rejects 401/403/413/422 without creating tasks or cases', async () => {
    const t = task();
    expect((await request('/control/v1/tasks', t, '')).status).toBe(401);
    expect((await request('/control/v1/tasks', t, 'invalid')).status).toBe(401);
    expect((await request('/control/v1/tasks', { ...t, action: 'deploy' })).status).toBe(403);
    expect((await request('/control/v1/tasks', { ...t, target: 'ide' })).status).toBe(403);
    expect((await request('/control/v1/tasks', { ...t, riskLevel: 'approval_required' })).status).toBe(403);
    expect((await request('/control/v1/tasks', '{')).status).toBe(422);
    expect((await request('/control/v1/tasks', { ...t, timeoutMs: -1 })).status).toBe(422);
    expect((await request('/control/v1/tasks', { ...t, parameters: [] })).status).toBe(422);
    expect((await request('/control/v1/tasks', { ...t, schemaVersion: 'wrong' })).status).toBe(422);
    expect((await request('/control/v1/tasks', { ...t, padding: 'x'.repeat(1_000_001) })).status).toBe(413);
    expect(Number((await db.query('SELECT count(*) FROM runtime_tasks WHERE idempotency_key=$1', [t.idempotencyKey])).rows[0].count)).toBe(0);
  });
  it('returns 404 for missing task/artifact and 503 for unavailable signing', async () => {
    expect((await request('/livez')).status).toBe(200);
    expect((await request('/readyz')).status).toBe(200);
    expect((await request('/control/v1/tasks/missing')).status).toBe(404);
    const t = task(); expect((await request('/control/v1/tasks', t)).status).toBe(201);
    const input = { caseId, taskId: t.taskId, artifactHash: 'b'.repeat(64), createdAt: new Date().toISOString() };
    expect((await request('/control/v1/artifacts/sign', input)).status).toBe(404);
    expect((await request('/control/v1/artifacts/sign', input, token, unsignedBase)).status).toBe(503);
  });
  it('commits a result/frontier/decision/outbox once through HTTP after exact replay', async () => {
    const client = new HttpControlPlaneClient(base, token);
    const c = 'closure-loop-' + randomUUID();
    await client.ensureCase(c, 'test'); const run = await client.ensureInvestigationRun(c, 'test');
    const t = { ...task(), caseId: c }; await client.createTask(t, 'test', { runId: run.runId });
    const obs: ObservationPack = { observationId: randomUUID(), caseId: c, taskId: t.taskId, summary: 'fixture',
      facts: [{ key: 'hostname', value: 'test-fixture' }], evidenceRefs: ['EVD-http-test'],
      originalBytes: 12, packedBytes: 12, createdAt: new Date().toISOString() };
    const result: GssResultContract = { schemaVersion: 'gss.result.v1', taskId: t.taskId, caseId: c, executor: 'cli',
      status: 'COMPLETED', result: { summary: obs.summary }, evidenceRefs: obs.evidenceRefs, errors: [],
      metrics: { durationMs: 1 }, completedAt: obs.createdAt };
    const loop = { runId: run.runId, source: 'cli', proposal: { kind: 'DISPATCH' as const,
      reasonCode: 'TEST', rationale: 'bounded followup',
      action: { target: 'cli' as const, action: 'inspect_system' as const, parameters: {}, riskLevel: 'read_only' as const } } };
    for (let i = 0; i < 3; i++) {
      const response = await request('/control/v1/results', { result, observation: obs, loop });
      expect(response.status).toBe(200); expect((await response.json() as { replay: boolean }).replay).toBe(i > 0);
    }
    expect((await request('/control/v1/results', { result: { ...result, result: { summary: 'changed' } }, observation: obs, loop })).status).toBe(409);
    expect((await request('/control/v1/results', { result, observation: { ...obs, caseId: 'wrong' }, loop })).status).toBe(422);
    expect((await request('/control/v1/results', { result: { ...result, status: 'FAILED' }, observation: obs, loop })).status).toBe(422);
    await server.close(); server = new ControlPlaneServer(0); base = 'http://127.0.0.1:' + await server.ready();
    const restartedReplay = await request('/control/v1/results', { result, observation: obs, loop });
    expect(restartedReplay.status).toBe(200); expect((await restartedReplay.json() as { replay: boolean }).replay).toBe(true);
    const counts = await db.query(`SELECT
      (SELECT count(*) FROM evidence_frontiers WHERE run_id=$1)::int AS frontiers,
      (SELECT count(*) FROM next_step_decisions WHERE run_id=$1)::int AS decisions,
      (SELECT count(*) FROM control_outbox WHERE aggregate_id=$1)::int AS outbox`, [run.runId]);
    expect(counts.rows[0]).toEqual({ frontiers: 1, decisions: 1, outbox: 2 });
  });
  it('serializes competing results and persists failure without evidence', async () => {
    const t = task(); expect((await request('/control/v1/tasks', t)).status).toBe(201);
    const failed: GssResultContract = { schemaVersion: 'gss.result.v1', taskId: t.taskId, caseId, executor: 'cli',
      status: 'FAILED', result: { summary: 'provider failed' }, evidenceRefs: [], errors: [{ code: 'FAILED', message: 'fixture' }],
      metrics: { durationMs: 1 }, completedAt: new Date().toISOString() };
    const responses = await Promise.all([request('/control/v1/results', { result: failed }),
      request('/control/v1/results', { result: { ...failed, result: { summary: 'different' } } })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(Number((await db.query('SELECT count(*) FROM observation_packs WHERE task_id=$1', [t.taskId])).rows[0].count)).toBe(0);
    expect((await db.query('SELECT evidence_refs FROM runtime_executions WHERE task_id=$1', [t.taskId])).rows[0].evidence_refs).toEqual([]);
    expect((await request('/control/v1/tasks/' + t.taskId + '/status', { status: 'DISPATCHED' })).status).toBe(409);
    expect((await request('/control/v1/tasks/' + t.taskId + '/status', { status: 'FAILED' })).status).toBe(200);
    expect((await request('/control/v1/results', { result: { ...failed, taskId: 'missing' } })).status).toBe(404);
    expect((await request('/control/v1/results', { result: { ...failed, executor: 'ide' } })).status).toBe(422);
  });
});
