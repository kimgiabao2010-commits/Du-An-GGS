import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PostgresControlStateStore } from '../../packages/persistence/src/control-state-store.ts';
import { PostgresRuntimeStore } from '../../packages/persistence/src/runtime-store.ts';
import { PostgresInvestigationStore } from '../../packages/persistence/src/investigation-store.ts';
import { PostgresIdentityStore } from '../../packages/persistence/src/identity-store.ts';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
import { HttpControlPlaneClient } from '../../services/standalone/src/control-plane-client.ts';
import type { GssTaskContract } from '../../packages/sdk/src/index.ts';

const enabled = Boolean(process.env.DATABASE_URL);
const schema = 'gss_control_' + randomUUID().replaceAll('-','');
let admin: Pool, db: Pool, store: PostgresControlStateStore, runtime: PostgresRuntimeStore;
let server: ControlPlaneServer, cp: HttpControlPlaneClient;
const token = 'durable-control-test-token-at-least-32-characters';
function task(): GssTaskContract {
  return { schemaVersion: 'gss.task.v1', taskId: randomUUID(), caseId: randomUUID(), idempotencyKey: randomUUID(),
    source: 'standalone', target: 'cli', action: 'inspect_hostname', riskLevel: 'read_only', parameters: {},
    contextRefs: [], timeoutMs: 15000, createdAt: new Date().toISOString() };
}
beforeAll(async () => {
  if (!enabled) return;
  admin = new Pool({ connectionString: process.env.DATABASE_URL });
  if (!/^gss_control_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', '-c search_path=' + schema);
  vi.stubEnv('DATABASE_URL', url.toString()); vi.stubEnv('GSS_CONTROL_PLANE_TOKEN', token);
  db = new Pool({ connectionString: url.toString() });
  for (const file of (await readdir(resolve('infra/postgres/migrations'))).filter(f => f.endsWith('.sql')).sort()) {
    await db.query(await readFile(resolve('infra/postgres/migrations', file), 'utf8'));
  }
  store = new PostgresControlStateStore(db); runtime = new PostgresRuntimeStore(db);
  server = new ControlPlaneServer(0); cp = new HttpControlPlaneClient('http://127.0.0.1:' + await server.ready(), token);
}, 20000);
afterAll(async () => {
  await server?.close(); await db?.end();
  if (admin) {
    if (!/^gss_control_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test cleanup');
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
  vi.unstubAllEnvs();
});
describe.skipIf(!enabled)('durable control authority on isolated PostgreSQL', () => {
  it('commits incident access and revocation audit atomically, deduplicates concurrent grants', async () => {
    const identityStore = new PostgresIdentityStore(db);
    const caseId = randomUUID(); await runtime.ensureCase(caseId, 'admin');
    const receipts = await Promise.all(Array.from({length:4},()=>identityStore.grantCase(caseId,'fixture-issuer','analyst','admin')));
    expect(receipts.filter(r=>!r.replay)).toHaveLength(1);
    await identityStore.revoke('fixture-issuer','analyst','admin');
    const events = (await db.query("SELECT event_type,event_hash FROM audit_events WHERE action_payload->>'subject'='analyst'" )).rows;
    expect(events.map(e=>e.event_type).sort()).toEqual(['CASE_ACCESS_GRANTED','IDENTITY_REVOKED']);
    expect(events.every(e=>/^[a-f0-9]{64}$/.test(e.event_hash))).toBe(true);
  });
  it('rolls back identity mutation if security audit insert fails', async () => {
    const identityStore = new PostgresIdentityStore(db);
    const caseId = randomUUID(); await runtime.ensureCase(caseId, 'admin');
    await db.query(`CREATE FUNCTION reject_identity_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type IN ('CASE_ACCESS_GRANTED','IDENTITY_REVOKED') THEN RAISE EXCEPTION 'audit_fixture_failure'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER reject_identity_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_identity_audit()');
    try {
      await expect(identityStore.grantCase(caseId,'fixture-issuer','blocked','admin')).rejects.toThrow('audit_fixture_failure');
      await expect(identityStore.revoke('fixture-issuer','blocked','admin')).rejects.toThrow('audit_fixture_failure');
      expect((await db.query("SELECT count(*)::int n FROM case_access WHERE subject='blocked'")).rows[0].n).toBe(0);
      expect((await db.query("SELECT count(*)::int n FROM identity_revocations WHERE subject='blocked'")).rows[0].n).toBe(0);
    } finally {
      await db.query('DROP TRIGGER reject_identity_audit ON audit_events');
      await db.query('DROP FUNCTION reject_identity_audit()');
    }
  });
  it('persists intake and one user message, binds body, actor and case across concurrent replay', async () => {
    const input = { commandId: randomUUID(), caseId: randomUUID(), actorId: 'analyst', content: 'fixture read-only investigation' };
    const receipts = await Promise.all(Array.from({ length: 5 }, () => cp.receiveIntake(input)));
    expect(receipts.filter(r => !r.replay)).toHaveLength(1);
    await expect(cp.receiveIntake({ ...input, content: 'changed' })).rejects.toThrow('command_id_payload_mismatch');
    await expect(cp.receiveIntake({ ...input, actorId: 'other' })).rejects.toThrow('command_id_payload_mismatch');
    expect((await db.query('SELECT count(*)::int AS n FROM case_messages WHERE case_id=$1', [input.caseId])).rows[0].n).toBe(1);
  });
  it('leases one intake to one owner and recovers a frozen decision after restart', async () => {
    const input = { commandId: randomUUID(), caseId: randomUUID(), actorId: 'analyst', content: 'fixture chat' };
    await cp.receiveIntake(input);
    const claims = (await Promise.all([cp.claimIntakes('a'), cp.claimIntakes('b')])).flat();
    const claim = claims.find(c => c.commandId === input.commandId)!;
    expect(claim).toBeDefined(); expect(claims.filter(c => c.commandId === input.commandId)).toHaveLength(1);
    const decision = { agent: 'chat', instruction: 'fixture response, not evidence' };
    await cp.saveIntakeDecision(input.commandId, claim.claimOwner!, decision);
    await expect(cp.saveIntakeDecision(input.commandId, claim.claimOwner!, { ...decision, instruction: 'changed' })).rejects.toThrow('intake_decision_conflict');
    await db.query("UPDATE command_intakes SET lease_until=now()-interval '1 second' WHERE command_id=$1", [input.commandId]);
    await server.close(); server = new ControlPlaneServer(0); cp = new HttpControlPlaneClient('http://127.0.0.1:' + await server.ready(), token);
    const replay = (await cp.claimIntakes('restarted')).find(c => c.commandId === input.commandId)!;
    expect(replay.decision).toEqual(decision);
    await expect(cp.finishIntake(input.commandId, claim.claimOwner!, 'wrong-owner')).rejects.toThrow('intake_claim_lost');
    await cp.finishIntake(input.commandId, 'restarted', decision.instruction);
    await cp.finishIntake(input.commandId, 'restarted', decision.instruction);
    expect((await db.query('SELECT count(*)::int AS n FROM case_messages WHERE case_id=$1', [input.caseId])).rows[0].n).toBe(2);
  });
  it('requires assigned worker and publishes dispatch only with durable acceptance', async () => {
    const t = task(); await cp.createTask(t, 'test');
    await cp.updateTask(t.taskId, 'DISPATCHED', 'cli-worker-agent');
    expect((await db.query("SELECT count(*)::int AS n FROM control_outbox WHERE payload->'task'->>'taskId'=$1 AND published_at IS NOT NULL", [t.taskId])).rows[0].n).toBe(0);
    await expect(cp.acceptTask(t.taskId, t.caseId, 'ide-worker-agent', 'execution')).rejects.toThrow('task_acceptance_provenance_mismatch');
    const result = await Promise.all(Array.from({ length: 5 }, () => cp.acceptTask(t.taskId, t.caseId, 'cli-worker-agent', 'execution')));
    expect(result.every(r => r.accepted)).toBe(true);
    expect((await db.query('SELECT count(*)::int AS n FROM worker_task_acceptances WHERE task_id=$1', [t.taskId])).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM control_outbox WHERE payload->'task'->>'taskId'=$1 AND published_at IS NOT NULL", [t.taskId])).rows[0].n).toBe(1);
    expect(await cp.acceptTask(t.taskId, t.caseId, 'cli-worker-agent', 'new-worker-process')).toEqual({ accepted: false, reason: 'EXECUTION_STATE_UNKNOWN' });
  });
  it('does not regress running or cancelled tasks into dispatched state', async () => {
    const t = task(); await runtime.createTask(t, 'test'); await runtime.updateTask(t.taskId, 'RUNNING');
    await runtime.updateTask(t.taskId, 'DISPATCHED');
    expect((await db.query('SELECT status FROM runtime_tasks WHERE task_id=$1', [t.taskId])).rows[0].status).toBe('RUNNING');
    await runtime.updateTask(t.taskId, 'CANCELLED');
    await expect(runtime.updateTask(t.taskId, 'DISPATCHED')).rejects.toThrow('terminal_task_transition_denied');
  });
  it('revalidates approved requests on expiry, hash mismatch and requester self approval', async () => {
    const approvals = new PostgresInvestigationStore(db);
    const caseId = randomUUID(); await runtime.ensureCase(caseId, 'test');
    const id = await approvals.createApproval({ incidentId: caseId, action: 'CREATE_GITOPS_PR', artifactHash: 'a'.repeat(64),
      parameters: { proposal: true }, policyVersion: 'test', requestedBy: 'requester', expiresAt: new Date(Date.now()+60000), payload: {} });
    expect((await approvals.approve(id, 'lead1', 'a'.repeat(64))).status).toBe('PENDING');
    expect((await approvals.approve(id, 'lead1', 'a'.repeat(64))).approvalCount).toBe(1);
    expect((await approvals.approve(id, 'lead2', 'a'.repeat(64))).status).toBe('APPROVED_FOR_PROPOSAL');
    expect((await approvals.approve(id, 'lead2', 'b'.repeat(64))).status).toBe('ARTIFACT_MISMATCH');
    expect((await approvals.approve(id, 'requester', 'a'.repeat(64))).status).toBe('REQUESTER_CANNOT_APPROVE');
    await expect(db.query("UPDATE approval_requests SET artifact_hash=$2 WHERE approval_id=$1",[id,'b'.repeat(64)]))
      .rejects.toThrow('approval_binding_immutable');
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);
    try { expect((await approvals.approve(id, 'lead2', 'a'.repeat(64))).status).toBe('EXPIRED'); }
    finally { clock.mockRestore(); }
  });
  it('durably halts all queued work across restart and denies task/intake/acceptance writes', async () => {
    const t = task(); await cp.createTask(t, 'test'); await cp.updateTask(t.taskId, 'DISPATCHED', 'cli-worker-agent');
    await cp.halt('admin', 'test-only halt');
    await server.close(); server = new ControlPlaneServer(0); cp = new HttpControlPlaneClient('http://127.0.0.1:' + await server.ready(), token);
    expect((await cp.runtimeState()).halted).toBe(true);
    await expect(cp.createTask(task(), 'test')).rejects.toThrow('control_halted');
    await expect(cp.receiveIntake({ commandId: randomUUID(), caseId: randomUUID(), actorId: 'test', content: 'denied' })).rejects.toThrow('control_halted');
    await expect(cp.acceptTask(t.taskId, t.caseId, 'cli-worker-agent', 'execution')).rejects.toThrow('control_halted');
    expect((await db.query('SELECT status FROM runtime_tasks WHERE task_id=$1', [t.taskId])).rows[0].status).toBe('CANCELLED');
    expect((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE event_type='CONTROL_HALTED'")).rows[0].n).toBe(1);
  });
});
