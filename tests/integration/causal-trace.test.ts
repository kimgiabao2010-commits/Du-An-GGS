import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Pool } from 'pg';
import { initializeTracing, withGssSpan, currentTraceparent, TokenSigner } from '../../packages/sdk/src/index.ts';
import { FilesystemArtifactStore } from '../../packages/persistence/src/artifact-store.ts';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
import { HttpControlPlaneClient } from '../../services/standalone/src/control-plane-client.ts';
import { CentralCommandOrchestrator } from '../../services/standalone/src/command-center.ts';

const exporter = new InMemorySpanExporter();
const provider = initializeTracing(exporter);
const enabled = Boolean(process.env.DATABASE_URL);
const schema = 'gss_trace_' + randomUUID().replaceAll('-', '');
const token = 'causal-trace-test-only-authority-token-32chars';
const signer = new TokenSigner('causal-trace-test-only-session-secret-32chars');
let database: Pool, administrator: Pool, control: ControlPlaneServer, root: string;
let app: CentralCommandOrchestrator | undefined;
const sockets: WebSocket[] = [];
let client: HttpControlPlaneClient;
let controlUrl: string;
let allowClaims = false;
beforeAll(async () => {
  if (!enabled) return;
  administrator = new Pool({ connectionString: process.env.DATABASE_URL });
  if (!/^gss_trace_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe schema');
  await administrator.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  vi.stubEnv('DATABASE_URL', url.toString());
  vi.stubEnv('GSS_CONTROL_PLANE_TOKEN', token);
  vi.stubEnv('GSS_REQUIRE_ARTIFACT_SIGNATURE', 'false');
  vi.stubEnv('GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64', '');
  database = new Pool({ connectionString: url.toString() });
  for (const file of (await readdir(resolve('infra/postgres/migrations'))).filter(file => file.endsWith('.sql')).sort()) {
    await database.query(await readFile(resolve('infra/postgres/migrations', file), 'utf8'));
  }
  control = new ControlPlaneServer(0);
  controlUrl = 'http://127.0.0.1:' + await control.ready();
  client = new HttpControlPlaneClient(controlUrl, token);
  const claim = client.claimPendingDispatches.bind(client);
  client.claimPendingDispatches = async (...args) => allowClaims ? claim(...args) : [];
  root = await mkdtemp(join(tmpdir(), 'gss-trace-test-'));
}, 20_000);
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await app?.close(); await control?.close(); await database?.end();
  if (administrator) { await administrator.query(`DROP SCHEMA ${schema} CASCADE`); await administrator.end(); }
  if (root) { if (!root.startsWith(join(tmpdir(), 'gss-trace-test-'))) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }); }
  vi.unstubAllEnvs(); await provider.shutdown();
});
async function connect(port: number, agentId: string, role: string, permissions: string[]) {
  const socket = new WebSocket('ws://127.0.0.1:' + port, { headers: { authorization: 'Bearer ' +
    signer.sign({ agentId, role, permissions, timestamp: Date.now(), expiresAt: Date.now() + 60_000 }) } });
  sockets.push(socket); await once(socket, 'open'); return socket;
}
function frame(socket: WebSocket, predicate: (value: any) => boolean): Promise<any> {
  return new Promise((resolveFrame, reject) => {
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error('Trace fixture frame timeout')); }, 10_000);
    function receive(raw: any) { const value = JSON.parse(raw.toString()); if (predicate(value)) {
      clearTimeout(timer); socket.off('message', receive); resolveFrame(value);
    } }
    socket.on('message', receive);
  });
}

it('telemetry drops unapproved attributes and does not serialize exception text', async () => {
  await expect(withGssSpan('gss.test.failure', { prompt: 'SECRET_SENTINEL', token: 'SECRET_SENTINEL' },
    async () => { throw new Error('SECRET_SENTINEL'); })).rejects.toThrow('SECRET_SENTINEL');
  const spans = exporter.getFinishedSpans().filter(span => span.name === 'gss.test.failure');
  expect(spans).toHaveLength(1); expect(spans[0].status.code).toBe(2);
  expect(JSON.stringify(spans.map(span => ({ attributes: span.attributes, events: span.events, status: span.status })))).not.toContain('SECRET_SENTINEL');
});
describe.skipIf(!enabled)('causal tracing over live PostgreSQL + HTTP + WebSocket', () => {
  it('retains one causal four-step trace through outbox recovery and correlates model usage', async () => {
    const caseId = 'trace-case-' + randomUUID();
    const router = { routePrompt: async () => ({ agent: 'cli' as const, action: 'inspect_hostname' as const,
      instruction: 'hostname', modelUsage: { model: 'test-only-fixture', reasoningEffort: 'medium', routeReason: 'fixture',
        inputTokens: 10, outputTokens: 2, cachedTokens: 0, latencyMs: 1, retryCount: 0, estimatedCostMicros: 0, status: 'SUCCEEDED' as const } }) };
    app = new CentralCommandOrchestrator(0, router, signer, client, new FilesystemArtifactStore(root));
    let port = await app.ready();
    let worker = await connect(port, 'cli-worker-agent', 'CLI_DAEMON', ['REPORT']);
    let user = await connect(port, 'controller', 'SECURITY_ADMIN', ['CONTROL']);
    let upcoming = frame(worker, value => value.type === 'TASK');
    user.send(JSON.stringify({ type: 'COMMAND', message_id: randomUUID(), incident_id: caseId, timestamp: Date.now(),
      payload: { action: 'commander_prompt', content: 'PRIVATE_PROMPT_SENTINEL' } }));
    const taskIds: string[] = [], parents: string[] = [];
    for (let step = 0; step < 4; step++) {
      const task = await upcoming;
      taskIds.push(task.payload.taskId); parents.push(task.payload.traceparent);
      const completed = frame(user, value => value.payload?.source === 'SUCCESS');
      if (step > 0 && step < 3) upcoming = frame(worker, value => value.type === 'TASK');
      await withGssSpan('gss.worker.execute', { 'gss.task_id': task.payload.taskId, 'gss.target': 'cli' }, async () => {
        worker.send(JSON.stringify({ type: 'RESULT', message_id: randomUUID(), incident_id: caseId, timestamp: Date.now(),
          payload: { taskId: task.payload.taskId, status: 'SUCCESS', output: 'PRIVATE_OUTPUT_SENTINEL-' + step,
            traceparent: currentTraceparent() } }));
      }, task.payload.traceparent);
      await completed;
      if (step === 0) {
        worker.terminate(); user.terminate(); await app.close(); app = undefined;
        allowClaims = true;
        app = new CentralCommandOrchestrator(0, router, signer, client, new FilesystemArtifactStore(root));
        port = await app.ready();
        worker = await connect(port, 'cli-worker-agent', 'CLI_DAEMON', ['REPORT']);
        user = await connect(port, 'controller', 'SECURITY_ADMIN', ['CONTROL']);
        upcoming = frame(worker, value => value.type === 'TASK');
      }
    }
    await new Promise(resolveTimer => setTimeout(resolveTimer, 100));
    await provider.forceFlush();
    const traceIds = parents.map(parent => parent.split('-')[1]);
    expect(new Set(traceIds).size).toBe(1);
    const spans = exporter.getFinishedSpans().filter(span => span.spanContext().traceId === traceIds[0]);
    const byId = new Map(spans.map(span => [span.spanContext().spanId, span]));
    for (const span of spans) if (span.parentSpanContext) expect(byId.has(span.parentSpanContext.spanId)).toBe(true);
    // Recovery can attempt delivery while the worker reconnects; only actual executions/results must be exactly four.
    expect(spans.filter(span => span.name === 'gss.task.dispatch').length).toBeGreaterThanOrEqual(4);
    expect(new Set(taskIds).size).toBe(4);
    for (const name of ['gss.worker.execute', 'gss.result.receive']) expect(spans.filter(span => span.name === name)).toHaveLength(4);
    expect(spans.some(span => span.name === 'gss.outbox.dispatch')).toBe(true);
    expect(spans.some(span => span.name === 'gss.control.handle')).toBe(true);
    const usage = await database.query('SELECT trace_id FROM model_usage WHERE case_id=$1', [caseId]);
    expect(usage.rows).toEqual([{ trace_id: traceIds[0] }]);
    const run = await database.query('SELECT frontier_version,state,traceparent FROM investigation_runs WHERE case_id=$1', [caseId]);
    expect(run.rows[0].frontier_version).toBe(4); expect(run.rows[0].state).toBe('FINALIZED');
    expect(run.rows[0].traceparent.split('-')[1]).toBe(traceIds[0]);
    expect(Number((await database.query('SELECT count(*) FROM runtime_result_receipts WHERE task_id=ANY($1)', [taskIds])).rows[0].count)).toBe(4);
    const serialized = JSON.stringify(spans.map(span => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })));
    expect(serialized).not.toContain('PRIVATE_PROMPT_SENTINEL'); expect(serialized).not.toContain('PRIVATE_OUTPUT_SENTINEL'); expect(serialized).not.toContain(token);
    // Exercise the real migration dependency, without stopping the user's PostgreSQL service.
    await database.query('ALTER TABLE runtime_result_receipts RENAME TO unavailable_receipts');
    try {
      expect((await fetch(controlUrl + '/readyz', { signal: AbortSignal.timeout(5_000) })).status).toBe(503);
      expect((await fetch(controlUrl + '/livez', { signal: AbortSignal.timeout(5_000) })).status).toBe(200);
    } finally { await database.query('ALTER TABLE unavailable_receipts RENAME TO runtime_result_receipts'); }
  }, 30_000);
});
