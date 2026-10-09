import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { ASQWebSocketClient, TokenSigner, workerDeliveryId, type WorkerDeliveryInput,
  type GssTaskContract, type ResultSubmission, ReliableResultQueue } from '../../packages/sdk/src/index.ts';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
import { HttpControlPlaneClient } from '../../services/standalone/src/control-plane-client.ts';
import { CentralCommandOrchestrator } from '../../services/standalone/src/command-center.ts';
import { FilesystemArtifactStore } from '../../packages/persistence/src/artifact-store.ts';

const enabled = Boolean(process.env.DATABASE_URL);
const token = 'result-delivery-test-authority-token-32chars';
const signer = new TokenSigner('result-delivery-test-session-secret-32chars');
let control: ControlPlaneServer, db: Pool, url: string;
let app: CentralCommandOrchestrator | undefined, worker: ASQWebSocketClient | undefined;
const roots: string[] = [];
const router = { routePrompt: async () => ({ agent: 'chat', instruction: 'test-only unused router' }) };
const fresh = () => new HttpControlPlaneClient(url, token);
beforeAll(async () => {
  if (!enabled) return;
  // The suite launcher provides the isolated schema and all migrations before tests load.
  if (!new URL(process.env.DATABASE_URL!).searchParams.get('options')?.includes('gss_suite_')) {
    throw new Error('Run this fault-injection test via npm run test:integration');
  }
  vi.stubEnv('GSS_CONTROL_PLANE_TOKEN', token);
  vi.stubEnv('GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64', '');
  vi.stubEnv('GSS_REQUIRE_ARTIFACT_SIGNATURE', 'false');
  db = new Pool({ connectionString: process.env.DATABASE_URL });
  control = new ControlPlaneServer(0); url = 'http://127.0.0.1:' + await control.ready();
}, 20_000);
afterAll(async () => {
  worker?.disconnect(); await app?.close(); await control?.close(); await db?.end(); vi.unstubAllEnvs();
  for (const root of roots) {
    if (!root.startsWith(join(tmpdir(), 'gss-delivery-'))) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const input: GssTaskContract = { schemaVersion: 'gss.task.v1', taskId: randomUUID(), caseId: randomUUID(),
    idempotencyKey: randomUUID(), source: 'standalone', target: 'cli', action: 'inspect_hostname',
    parameters: {}, riskLevel: 'read_only', contextRefs: [], timeoutMs: 15_000, createdAt: new Date().toISOString() };
  const client = fresh(); await client.createTask(input, 'test-only fixture');
  await client.updateTask(input.taskId, 'DISPATCHED', 'cli-worker-agent');
  // This models a known dispatched task, not actual hostname execution.
  const payload = { taskId: input.taskId, status: 'FAILED', output: 'labeled worker failure fixture' };
  const body = { taskId: input.taskId, caseId: input.caseId, workerId: 'cli-worker-agent', payload };
  const delivery: WorkerDeliveryInput = { schemaVersion: 'gss.worker-delivery.v1', ...body, deliveryId: workerDeliveryId(body) };
  const submission: ResultSubmission = { result: { schemaVersion: 'gss.result.v1', taskId: input.taskId,
    caseId: input.caseId, executor: 'cli', status: 'FAILED', result: { summary: payload.output }, evidenceRefs: [],
    errors: [{ code: 'FIXTURE_FAILURE', message: payload.output }], metrics: { durationMs: 1 }, completedAt: input.createdAt } };
  return { input, delivery, submission, client };
}
async function startWorker(port: number, root: string, role = 'CLI_DAEMON', permissions = ['REPORT']) {
  const authorization = signer.sign({ agentId: 'cli-worker-agent', role, permissions,
    timestamp: Date.now(), expiresAt: Date.now() + 60_000 });
  const client = new ASQWebSocketClient('ws://127.0.0.1:' + port, authorization, 5,
    { workerId: 'cli-worker-agent', directory: root });
  await new Promise<void>(resolve => { client.subscribe('system:connected', () => resolve()); client.connect(); });
  return client;
}
describe.skipIf(!enabled)('durable worker result delivery', () => {
  it('rejects mismatched worker role and missing REPORT permission', async () => {
    for (const credentials of [{ role: 'IDE_AGENT', permissions: ['REPORT'] }, { role: 'CLI_DAEMON', permissions: [] }]) {
    const { client, input, delivery } = await fixture();
    const root = await mkdtemp(join(tmpdir(), 'gss-delivery-')); roots.push(root);
    app = new CentralCommandOrchestrator(0, router, signer, client, new FilesystemArtifactStore(root));
    worker = await startWorker(await app.ready(), root, credentials.role, credentials.permissions);
    worker.publishResult(input.caseId, delivery.payload);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(Number((await db.query('SELECT count(*) FROM worker_result_deliveries WHERE task_id=$1', [input.taskId])).rows[0].count)).toBe(0);
    expect((await readdir(root)).filter(file => file.endsWith('.json'))).toHaveLength(1);
    worker.disconnect(); await app.close(); app = undefined;
    }
  });
  it('binds receipt to task/case/assigned worker, rejects conflicts, and raw receipt is not evidence', async () => {
    const { client, delivery, input } = await fixture();
    const wrongBody = { workerId: 'ide-worker-agent', taskId: input.taskId, caseId: input.caseId, payload: delivery.payload };
    await expect(client.receiveWorkerDelivery({ schemaVersion: 'gss.worker-delivery.v1', ...wrongBody,
      deliveryId: workerDeliveryId(wrongBody) })).rejects.toThrow('provenance_denied');
    const receipts = await Promise.all(Array.from({ length: 6 }, () => client.receiveWorkerDelivery(delivery)));
    expect(receipts.every(receipt => !receipt.committed)).toBe(true);
    expect(new Set(receipts.map(receipt => receipt.receivedAt)).size).toBe(1);
    const mutated = { ...delivery, payload: { ...delivery.payload, output: 'mutated' } };
    mutated.deliveryId = workerDeliveryId({ workerId: mutated.workerId, caseId: mutated.caseId, taskId: mutated.taskId, payload: mutated.payload });
    await expect(client.receiveWorkerDelivery(mutated)).rejects.toThrow('payload_mismatch');
    expect(Number((await db.query('SELECT count(*) FROM runtime_executions WHERE task_id=$1', [input.taskId])).rows[0].count)).toBe(0);
  });

  it('freezes the prepared envelope and atomically commits its delivery ACK state with one receipt', async () => {
    const { client, delivery, submission, input } = await fixture();
    await client.receiveWorkerDelivery(delivery);
    const prepared = await client.prepareWorkerDelivery(delivery.deliveryId, submission);
    const mutated = { result: { ...submission.result, completedAt: new Date().toISOString(), result: { summary: 'mutated' } } };
    expect(await client.prepareWorkerDelivery(delivery.deliveryId, mutated)).toEqual(prepared);
    await expect(client.recordResult(mutated.result, undefined, undefined, delivery.deliveryId)).rejects.toThrow('prepared_result_mismatch');
    expect((await client.recordResult(prepared.result, undefined, undefined, delivery.deliveryId)).replay).toBe(false);
    expect((await client.recordResult(prepared.result, undefined, undefined, delivery.deliveryId)).replay).toBe(true);
    expect((await client.receiveWorkerDelivery(delivery)).committed).toBe(true);
    expect(Number((await db.query('SELECT count(*) FROM runtime_result_receipts WHERE task_id=$1', [input.taskId])).rows[0].count)).toBe(1);
  });

  it('cannot promote a failed worker delivery into successful evidence', async () => {
    const { client, delivery, submission } = await fixture(); await client.receiveWorkerDelivery(delivery);
    await expect(client.prepareWorkerDelivery(delivery.deliveryId, { result: { ...submission.result, status: 'COMPLETED' } }))
      .rejects.toThrow('cannot_create_evidence');
  });

  it('backs off a corrupted receipt without starving a valid pending result', async () => {
    const bad = await fixture(), good = await fixture();
    await bad.client.receiveWorkerDelivery(bad.delivery); await good.client.receiveWorkerDelivery(good.delivery);
    await db.query("UPDATE worker_result_deliveries SET payload=jsonb_set(payload,'{output}',to_jsonb('tampered'::text)) WHERE task_id=$1", [bad.input.taskId]);
    const pending = await good.client.pendingWorkerDeliveries();
    expect(pending.some(record => record.taskId === bad.input.taskId)).toBe(false);
    expect(pending.some(record => record.taskId === good.input.taskId)).toBe(true);
    const deferred = (await db.query('SELECT attempts,next_attempt_at,last_error FROM worker_result_deliveries WHERE task_id=$1', [bad.input.taskId])).rows[0];
    expect(deferred.attempts).toBe(1); expect(new Date(deferred.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(deferred.last_error).toMatch(/retained/);
  });

  it('commits exactly one labeled fixture frontier on result replay', async () => {
    const { client, delivery, submission, input } = await fixture();
    delivery.payload.status = 'SUCCESS'; delivery.payload.output = 'labeled hostname fixture';
    delivery.deliveryId = workerDeliveryId({ caseId: delivery.caseId, taskId: delivery.taskId,
      workerId: delivery.workerId, payload: delivery.payload });
    await client.receiveWorkerDelivery(delivery);
    const run = await client.ensureInvestigationRun(input.caseId, 'fixture');
    const evidenceRef = 'EVD-fixture-' + randomUUID();
    const envelope: ResultSubmission = { result: { ...submission.result, status: 'COMPLETED', errors: [], evidenceRefs: [evidenceRef] },
      observation: { observationId: randomUUID(), taskId: input.taskId, caseId: input.caseId, summary: 'labeled hostname fixture',
        facts: [{ key: 'fixture.host', value: 'test-only-host' }], evidenceRefs: [evidenceRef], originalBytes: 16, packedBytes: 16, createdAt: input.createdAt },
      loop: { runId: run.runId, source: 'cli', proposal: { kind: 'FINALIZE', reasonCode: 'FIXTURE_ONLY', rationale: 'fixture completed' } } };
    await client.prepareWorkerDelivery(delivery.deliveryId, envelope);
    for (let i = 0; i < 3; i++) expect((await client.recordResult(envelope.result, envelope.observation, envelope.loop, delivery.deliveryId)).replay).toBe(i > 0);
    const counts = await db.query(`SELECT
      (SELECT count(*) FROM evidence_frontiers WHERE run_id=$1)::int AS frontiers,
      (SELECT count(*) FROM next_step_decisions WHERE run_id=$1)::int AS decisions,
      (SELECT count(*) FROM runtime_result_receipts WHERE task_id=$2)::int AS receipts`, [run.runId, input.taskId]);
    expect(counts.rows[0]).toEqual({ frontiers: 1, decisions: 1, receipts: 1 });
  });

  it('does not commit a late result after durable cancellation', async () => {
    const { client, delivery, submission, input } = await fixture();
    await client.receiveWorkerDelivery(delivery); await client.prepareWorkerDelivery(delivery.deliveryId, submission);
    await client.updateTask(input.taskId, 'CANCELLED');
    await expect(client.recordResult(submission.result, undefined, undefined, delivery.deliveryId)).rejects.toThrow('terminal_task_result_denied');
    expect((await client.receiveWorkerDelivery(delivery)).committed).toBe(false);
  });

  it('rolls back result/receipt/ACK state together when receipt insertion fails', async () => {
    const { client, delivery, submission, input } = await fixture();
    await client.receiveWorkerDelivery(delivery); await client.prepareWorkerDelivery(delivery.deliveryId, submission);
    // Only this task is affected; other test files share the isolated suite schema.
    await db.query(`CREATE FUNCTION fail_delivery_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.task_id='${input.taskId}' THEN RAISE EXCEPTION 'test-only receipt failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_delivery_receipt BEFORE INSERT ON runtime_result_receipts FOR EACH ROW EXECUTE FUNCTION fail_delivery_receipt()`);
    try {
      await expect(client.recordResult(submission.result, undefined, undefined, delivery.deliveryId)).rejects.toThrow();
      const counts = await db.query(`SELECT
        (SELECT count(*) FROM runtime_executions WHERE task_id=$1)::int AS results,
        (SELECT committed_at FROM worker_result_deliveries WHERE task_id=$1) AS committed`, [input.taskId]);
      expect(counts.rows[0]).toEqual({ results: 0, committed: null });
    } finally { await db.query('DROP TRIGGER fail_delivery_receipt ON runtime_result_receipts; DROP FUNCTION fail_delivery_receipt()'); }
    expect((await client.recordResult(submission.result, undefined, undefined, delivery.deliveryId)).replay).toBe(false);
  });

  it('recovers a saved prepared result after orchestrator and worker restart, then clears the journal on commit ACK', async () => {
    const { client, input, delivery } = await fixture();
    const root = await mkdtemp(join(tmpdir(), 'gss-delivery-')); roots.push(root);
    const commit = client.recordResult.bind(client);
    client.recordResult = async () => { throw new Error('test-only crash window before commit'); };
    app = new CentralCommandOrchestrator(0, router, signer, client, new FilesystemArtifactStore(root));
    worker = await startWorker(await app.ready(), root);
    worker.publishResult(input.caseId, delivery.payload);
    await vi.waitFor(async () => {
      const saved = (await db.query('SELECT prepared_payload,committed_at FROM worker_result_deliveries WHERE task_id=$1', [input.taskId])).rows[0];
      expect(saved?.prepared_payload).toBeTruthy(); expect(saved.committed_at).toBeNull();
      expect((await readdir(root)).filter(file => file.endsWith('.json'))).toHaveLength(1);
    }, { timeout: 5_000 });
    worker.disconnect(); await app.close(); app = undefined;
    expect(new ReliableResultQueue('cli-worker-agent', root).pending()).toHaveLength(1);
    client.recordResult = commit;
    app = new CentralCommandOrchestrator(0, router, signer, fresh(), new FilesystemArtifactStore(root));
    const restartedPort = await app.ready();
    // Prove background recovery works without a worker resending the result.
    await vi.waitFor(async () => {
      expect(Number((await db.query('SELECT count(*) FROM runtime_result_receipts WHERE task_id=$1', [input.taskId])).rows[0].count)).toBe(1);
    }, { timeout: 8_000 });
    worker = await startWorker(restartedPort, root);
    await vi.waitFor(async () => {
      expect((await readdir(root)).filter(file => file.endsWith('.json'))).toHaveLength(0);
      expect(Number((await db.query('SELECT count(*) FROM runtime_result_receipts WHERE task_id=$1', [input.taskId])).rows[0].count)).toBe(1);
    }, { timeout: 8_000 });
    expect(Number((await db.query('SELECT count(*) FROM observation_packs WHERE task_id=$1', [input.taskId])).rows[0].count)).toBe(0);
    worker.disconnect(); await app.close(); app = undefined;
  }, 15_000);

  it('re-ACKs committed results when the commit response was lost, without another result transition', async () => {
    const { client, input, delivery } = await fixture();
    const root = await mkdtemp(join(tmpdir(), 'gss-delivery-')); roots.push(root);
    const commit = client.recordResult.bind(client); let calls = 0;
    client.recordResult = async (...args) => { const result = await commit(...args); calls++; throw new Error('test-only lost commit response'); };
    app = new CentralCommandOrchestrator(0, router, signer, client, new FilesystemArtifactStore(root));
    worker = await startWorker(await app.ready(), root);
    worker.publishResult(input.caseId, delivery.payload);
    await vi.waitFor(async () => {
      expect((await readdir(root)).filter(file => file.endsWith('.json'))).toHaveLength(0);
      expect(calls).toBe(1);
      const counts = await db.query('SELECT count(*)::int AS count FROM runtime_result_receipts WHERE task_id=$1', [input.taskId]);
      expect(counts.rows[0].count).toBe(1);
    }, { timeout: 8_000 });
    worker.disconnect(); await app.close(); app = undefined;
  }, 15_000);
});
