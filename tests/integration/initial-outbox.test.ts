import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { initialTaskDispatchEvent, sha256Canonical, TokenSigner, type GssTaskContract } from '../../packages/sdk/src/index.ts';
import { PostgresRuntimeStore } from '../../packages/persistence/src/runtime-store.ts';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
import { HttpControlPlaneClient } from '../../services/standalone/src/control-plane-client.ts';
import { CentralCommandOrchestrator } from '../../services/standalone/src/command-center.ts';

const enabled = Boolean(process.env.DATABASE_URL);
const schema = 'gss_initial_' + randomUUID().replaceAll('-', '');
const token = 'initial-dispatch-test-authority-token-32chars';
let administrator: Pool, database: Pool, store: PostgresRuntimeStore;
let control: ControlPlaneServer, client: HttpControlPlaneClient;
let controlUrl: string;
let app: CentralCommandOrchestrator | undefined;
const sockets: WebSocket[] = [];
function task(): GssTaskContract {
  return { schemaVersion: 'gss.task.v1', taskId: randomUUID(), caseId: randomUUID(), idempotencyKey: randomUUID(),
    source: 'standalone', target: 'cli', action: 'inspect_hostname', parameters: {}, riskLevel: 'read_only',
    contextRefs: [], timeoutMs: 15_000, createdAt: new Date().toISOString() };
}
beforeAll(async () => {
  if (!enabled) return;
  if (!/^gss_initial_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema');
  administrator = new Pool({ connectionString: process.env.DATABASE_URL });
  await administrator.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  vi.stubEnv('DATABASE_URL', url.toString());
  vi.stubEnv('GSS_CONTROL_PLANE_TOKEN', token);
  database = new Pool({ connectionString: url.toString() });
  for (const file of (await readdir(resolve('infra/postgres/migrations'))).filter(file => file.endsWith('.sql')).sort()) {
    await database.query(await readFile(resolve('infra/postgres/migrations', file), 'utf8'));
  }
  store = new PostgresRuntimeStore(database);
  control = new ControlPlaneServer(0);
  controlUrl = 'http://127.0.0.1:' + await control.ready();
  client = new HttpControlPlaneClient(controlUrl, token);
}, 20_000);
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await app?.close(); await control?.close(); await database?.end();
  if (administrator) {
    if (!/^gss_initial_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test cleanup');
    await administrator.query(`DROP SCHEMA ${schema} CASCADE`); await administrator.end();
  }
  vi.unstubAllEnvs();
},20_000);

describe.skipIf(!enabled)('initial dispatch on isolated live PostgreSQL', () => {
  it('atomically rolls back case, run and task if inserting dispatch intent fails', async () => {
    const input = task();
    await database.query(`CREATE FUNCTION reject_initial_dispatch() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'test-only outbox failure'; END $$;
      CREATE TRIGGER reject_initial_dispatch BEFORE INSERT ON control_outbox
      FOR EACH ROW EXECUTE FUNCTION reject_initial_dispatch()`);
    try {
      await expect(store.createTask(input, 'test')).rejects.toThrow('test-only outbox failure');
      const counts = await database.query(`SELECT
        (SELECT count(*) FROM cases WHERE case_id=$1)::int AS cases,
        (SELECT count(*) FROM runtime_tasks WHERE case_id=$1)::int AS tasks,
        (SELECT count(*) FROM investigation_runs WHERE case_id=$1)::int AS runs`, [input.caseId]);
      expect(counts.rows[0]).toEqual({ cases: 0, tasks: 0, runs: 0 });
    } finally {
      await database.query('DROP TRIGGER reject_initial_dispatch ON control_outbox; DROP FUNCTION reject_initial_dispatch()');
    }
  });

  it('survives Control Plane restart between commit and claim, with concurrent replay creating one intent', async () => {
    const input = task();
    const creations = await Promise.all(Array.from({ length: 8 }, () => client.createTask(input, 'test')));
    expect(creations.filter(value => value.created)).toHaveLength(1);
    await expect(store.createTask({ ...input, parameters: { changed: true } }, 'test'))
      .rejects.toThrow('idempotency_key_payload_mismatch');
    await control.close(); control = new ControlPlaneServer(0);
    controlUrl = 'http://127.0.0.1:' + await control.ready();
    client = new HttpControlPlaneClient(controlUrl, token);
    expect(await client.claimPendingDispatches('decision-only')).toEqual([]);
    const claims = await client.claimInitialDispatches('restarted');
    expect(claims).toHaveLength(1); expect(claims[0].task.taskId).toBe(input.taskId);
    expect(claims[0].runId).toBeTruthy();
    expect(await client.markOutboxPublished(claims[0].eventId, 'restarted')).toBe(true);
    expect(await client.claimInitialDispatches('replayed')).toEqual([]);
    const rows = await database.query(`SELECT count(*)::int AS count FROM control_outbox
      WHERE payload->'task'->>'taskId'=$1`, [input.taskId]);
    expect(rows.rows[0].count).toBe(1);
  });

  it('leases concurrently without two owners and recovers an expired lease', async () => {
    const input = task(); await client.createTask(input, 'test');
    const concurrent = await Promise.all([client.claimInitialDispatches('owner-a'), client.claimInitialDispatches('owner-b')]);
    const claims = concurrent.flat(); expect(claims).toHaveLength(1);
    const denied = await fetch(controlUrl + '/control/v1/outbox/' + encodeURIComponent(claims[0].eventId) + '/publish', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(5_000),
    });
    expect(denied.status).toBe(422);
    await expect(store.markOutboxPublished(claims[0].eventId, '')).rejects.toThrow('claimOwner is required');
    await database.query("UPDATE control_outbox SET locked_at=now()-interval '70 seconds' WHERE event_id=$1", [claims[0].eventId]);
    const recovered = await client.claimInitialDispatches('owner-c'); expect(recovered).toHaveLength(1);
    expect(recovered[0].eventId).toBe(claims[0].eventId);
    expect(await client.markOutboxPublished(claims[0].eventId, claims[0].claimOwner)).toBe(false);
    expect(await client.markOutboxPublished(recovered[0].eventId, 'owner-c')).toBe(true);
  });

  it.each([false, true])('rejects mutated task payload even if hash is recomputed (%s)', async recompute => {
    const input = task(); await client.createTask(input, 'test');
    const row = (await database.query('SELECT * FROM control_outbox WHERE payload->\'task\'->>\'taskId\'=$1', [input.taskId])).rows[0];
    row.payload.task.parameters = { injected: true };
    const hash = recompute ? sha256Canonical({ aggregateId: row.aggregate_id, eventType: row.event_type, payload: row.payload }) : row.event_hash;
    await database.query('UPDATE control_outbox SET payload=$2,event_hash=$3 WHERE event_id=$1', [row.event_id, row.payload, hash]);
    expect(await client.claimInitialDispatches('tamper-check')).toEqual([]);
    const state = (await database.query('SELECT published_at,locked_by,last_error FROM control_outbox WHERE event_id=$1', [row.event_id])).rows[0];
    expect(state.published_at).toBeNull(); expect(state.locked_by).toBeNull(); expect(state.last_error).toMatch(/provenance/);
    expect(Number((await database.query('SELECT count(*) FROM evidence_frontiers')).rows[0].count)).toBe(0);
  });

  it.each(['FAILED', 'CANCELLED', 'COMPLETED'] as const)('does not redispatch a terminal %s task', async status => {
    const input = task(); await client.createTask(input, 'test');
    await client.updateTask(input.taskId, status);
    expect(await client.claimInitialDispatches('terminal-check')).toEqual([]);
  });

  it('does not dispatch after run deadline or finalization', async () => {
    for (const expired of [false, true]) {
      const input = task(); await client.createTask(input, 'test');
      await database.query(expired ? "UPDATE investigation_runs SET deadline_at=now()-interval '1 second' WHERE case_id=$1" :
        "UPDATE investigation_runs SET state='FINALIZED' WHERE case_id=$1", [input.caseId]);
      expect(await client.claimInitialDispatches('deadline-check')).toEqual([]);
    }
  });

  it('retries an offline initial task across orchestrator restart without inventing evidence', async () => {
    const input = task(); await client.createTask(input, 'test');
    const signer = new TokenSigner('initial-outbox-test-session-secret-32chars');
    const router = { routePrompt: async () => ({ agent: 'chat', instruction: 'not used' }) };
    app = new CentralCommandOrchestrator(0, router, signer, client);
    await app.ready();
    await vi.waitFor(async () => {
      const row = (await database.query('SELECT status FROM runtime_tasks WHERE task_id=$1', [input.taskId])).rows[0];
      expect(row.status).toBe('BLOCKED');
      const event = (await database.query('SELECT locked_by,published_at,last_error FROM control_outbox WHERE payload->\'task\'->>\'taskId\'=$1', [input.taskId])).rows[0];
      expect(event.locked_by).toBeNull(); expect(event.published_at).toBeNull(); expect(event.last_error).toMatch(/offline/);
    }, { timeout: 5_000, interval: 100 });
    await app.close(); app = undefined;
    await database.query("UPDATE control_outbox SET next_attempt_at=now() WHERE payload->'task'->>'taskId'=$1", [input.taskId]);
    app = new CentralCommandOrchestrator(0, router, signer, client);
    const port = await app.ready();
    const worker = new WebSocket('ws://127.0.0.1:' + port, { headers: { authorization: 'Bearer ' +
      signer.sign({ agentId: 'cli-worker-agent', role: 'CLI_DAEMON', permissions: ['REPORT'], timestamp: Date.now(), expiresAt: Date.now() + 60_000 }) } });
    sockets.push(worker); await once(worker, 'open');
    const deliveries: string[] = [];
    worker.on('message', raw => {
      const message = JSON.parse(raw.toString()); if (message.type !== 'TASK') return;
      deliveries.push(message.payload.taskId);
      worker.send(JSON.stringify({ type: 'RESULT', message_id: randomUUID(), incident_id: input.caseId, timestamp: Date.now(),
        payload: { taskId: input.taskId, status: 'FAILED', output: 'test-only worker failure' } }));
    });
    await vi.waitFor(async () => {
      expect(deliveries).toEqual([input.taskId]);
      const result = await database.query('SELECT status FROM runtime_executions WHERE task_id=$1', [input.taskId]);
      expect(result.rows[0]?.status).toBe('FAILED');
      expect(await client.claimInitialDispatches('after-delivery')).toEqual([]);
    }, { timeout: 10_000, interval: 100 });
    const counts = await database.query(`SELECT
      (SELECT count(*) FROM evidence_frontiers)::int AS evidence,
      (SELECT count(*) FROM runtime_result_receipts WHERE task_id=$1)::int AS receipts`, [input.taskId]);
    expect(counts.rows[0]).toEqual({ evidence: 0, receipts: 1 });
  }, 20_000);
});

it('initial outbox is a versioned canonical intent, never a next-step evidence decision', () => {
  const input = task();
  const first = initialTaskDispatchEvent(input, 'run-test');
  const reordered = { ...input, parameters: { b: 2, a: 1 } };
  expect(initialTaskDispatchEvent(reordered, 'run-test').eventHash).toBe(
    initialTaskDispatchEvent({ ...reordered, parameters: { a: 1, b: 2 } }, 'run-test').eventHash);
  expect(first.payload.schemaVersion).toBe('gss.initial-dispatch.v1');
  expect(first.payload).not.toHaveProperty('decision'); expect(first.payload).not.toHaveProperty('frontier');
});
