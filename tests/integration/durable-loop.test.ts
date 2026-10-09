import { controlPlaneFixture } from '../helpers/control-plane-fixture.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import {
  INVESTIGATION_RUN_SCHEMA_VERSION,
  TokenSigner,
  createControlOutboxEvent,
  actionFingerprint,
  planNextStep,
  reduceEvidenceFrontier,
  type CaseState,
  type EvidenceFrontier,
  type GssResultContract,
  type GssTaskContract,
  type InvestigationRun,
  type NextStepProposal,
  type ObservationPack,
  type TaskStatus,
} from '../../packages/sdk/src/index.ts';
import { FilesystemArtifactStore } from '../../packages/persistence/src/artifact-store.ts';
import type { ClaimedDispatch, CommitObservationResult, RuntimeStore } from '../../packages/persistence/src/index.ts';
import { CentralCommandOrchestrator } from '../../services/standalone/src/command-center.ts';

class DurableMemoryStore implements RuntimeStore {
  tasks: GssTaskContract[] = [];
  results: GssResultContract[] = [];
  states: CaseState[] = [];
  frontier?: EvidenceFrontier;
  publishedEvents: string[] = [];
  private readonly idempotencyKeys = new Set<string>();
  private fingerprints: string[] = [];
  private run?: InvestigationRun;

  async ready() {}
  async close() {}
  async ensureCase() {}
  async appendMessage() { return randomUUID(); }
  async transitionCase(_caseId: string, state: CaseState) { this.states.push(state); }
  async ensureInvestigationRun(caseId: string): Promise<InvestigationRun> {
    if (!this.run) {
      const now = new Date().toISOString();
      this.run = {
        schemaVersion: INVESTIGATION_RUN_SCHEMA_VERSION,
        runId: 'run-loop-1', caseId, state: 'ACTIVE', frontierVersion: 0, depth: 0,
        budget: { maxDepth: 5, deadlineAt: new Date(Date.now() + 60_000).toISOString(), maxExternalQueries: 5, maxCostMicros: 1_000_000 },
        usage: { externalQueries: 0, costMicros: 0 }, policyVersion: 'gss.test-planner.v1', createdAt: now, updatedAt: now,
      };
    }
    return this.run;
  }
  async createTask(task: GssTaskContract) {
    if (this.idempotencyKeys.has(task.idempotencyKey)) return { created: false };
    this.idempotencyKeys.add(task.idempotencyKey);
    this.tasks.push(task);
    return { created: true };
  }
  async updateTask(_taskId: string, _status: TaskStatus) {}
  async markOutboxPublished(eventId: string) { this.publishedEvents.push(eventId); return true; }
  async recordResult(result: GssResultContract, observation?: ObservationPack, loop?: {
    runId: string; source: string; artifactHash?: string; proposal: NextStepProposal;
  }): Promise<void | CommitObservationResult> {
    this.results.push(result);
    if (!observation || !loop || !this.run) return;
    const frontier = reduceEvidenceFrontier({
      runId: loop.runId, caseId: this.run.caseId, observation, source: loop.source,
      ...(loop.artifactHash ? { artifactHash: loop.artifactHash } : {}),
      ...(this.frontier ? { current: this.frontier } : {}),
    });
    const decision = planNextStep({
      run: this.run, frontier, proposal: loop.proposal, previousActionFingerprints: this.fingerprints,
    });
    if (decision.action) this.fingerprints.push(decision.action.fingerprint);
    const outbox = createControlOutboxEvent(decision);
    const state = decision.kind === 'DISPATCH' ? 'ACTIVE' : decision.kind === 'FINALIZE' ? 'FINALIZED' :
      decision.kind === 'WAIT_APPROVAL' ? 'WAITING_APPROVAL' : 'BLOCKED';
    this.run = { ...this.run, state, depth: this.run.depth + 1, frontierVersion: frontier.version, updatedAt: decision.createdAt };
    this.frontier = frontier;
    return { created: true, run: this.run, frontier, decision, outbox };
  }
}

class RecoverableMemoryStore extends DurableMemoryStore {
  private delivered = false;

  constructor(private readonly recovered: CommitObservationResult) { super(); }

  async claimPendingDispatches(claimOwner: string): Promise<ClaimedDispatch[]> {
    if (this.delivered) return [];
    this.delivered = true;
    return [{ claimOwner, parentTaskId: 'task-before-restart', loop: this.recovered }];
  }

  async releaseOutbox(): Promise<boolean> {
    this.delivered = false;
    return true;
  }
}

const signer = new TokenSigner('durable-loop-integration-secret-32-chars');
const sockets: WebSocket[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
const roots: string[] = [];

async function connect(port: number, agentId: string, role: string, permissions: string[]): Promise<WebSocket> {
  const token = signer.sign({ agentId, role, permissions, timestamp: Date.now(), expiresAt: Date.now() + 60_000 });
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Authorization: `Bearer ${token}` } });
  sockets.push(socket);
  await once(socket, 'open');
  return socket;
}

function nextTask(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error('Missing follow-up task')); }, 5_000);
    function receive(raw: any) {
      const message = JSON.parse(raw.toString());
      if (message.type === 'TASK') { clearTimeout(timeout); socket.off('message', receive); resolve(message); }
    }
    socket.on('message', receive);
  });
}

function nextSuccess(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error('Missing completion status')); }, 5_000);
    function receive(raw: any) {
      const message = JSON.parse(raw.toString());
      if (message.payload?.source === 'SUCCESS') { clearTimeout(timeout); socket.off('message', receive); resolve(message); }
    }
    socket.on('message', receive);
  });
}

afterEach(async () => {
  sockets.splice(0).forEach(socket => socket.terminate());
  await Promise.all(servers.splice(0).map(server => server.close()));
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'gss-loop-integration-'))) throw new Error('Unsafe test cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});

describe('durable evidence-driven runtime loop', () => {
  it('executes a bounded four-step read-only chain and finalizes from verified observations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gss-loop-integration-'));
    roots.push(root);
    const store = new DurableMemoryStore();
    const router = { routePrompt: async () => ({ agent: 'cli', action: 'inspect_hostname' as const, instruction: 'hostname', parameters: {} }) };
    const app = new CentralCommandOrchestrator(0, router, signer, controlPlaneFixture(store), new FilesystemArtifactStore(root));
    servers.push(app);
    const port = await app.ready();
    const worker = await connect(port, 'cli-worker-agent', 'CLI_DAEMON', ['REPORT']);
    const user = await connect(port, 'controller', 'CISO_Admin', ['CONTROL']);

    let awaitedTask = nextTask(worker);
    user.send(JSON.stringify({
      type: 'COMMAND', message_id: 'request-loop-1', incident_id: 'case-loop-1', timestamp: Date.now(),
      payload: { action: 'commander_prompt', content: 'Run bounded host triage' },
    }));

    const actions: string[] = [];
    for (let index = 0; index < 4; index++) {
      const taskFrame = await awaitedTask;
      actions.push(taskFrame.payload.action);
      const completion = nextSuccess(user);
      const followUp = index < 3 ? nextTask(worker) : undefined;
      worker.send(JSON.stringify({
        type: 'RESULT', message_id: randomUUID(), incident_id: taskFrame.incident_id, timestamp: Date.now(),
        payload: { taskId: taskFrame.payload.taskId, status: 'SUCCESS', output: `${taskFrame.payload.action}=verified-${index}` },
      }));
      await completion;
      if (followUp) awaitedTask = followUp;
    }

    expect(actions).toEqual(['inspect_hostname', 'inspect_system', 'inspect_network_config', 'inspect_network_connections']);
    expect(store.tasks).toHaveLength(4);
    expect(store.results).toHaveLength(4);
    expect(store.frontier?.version).toBe(4);
    expect(store.frontier?.facts).toHaveLength(4);
    expect(store.publishedEvents).toHaveLength(4);
    expect(store.states).toContain('COLLECTING_EVIDENCE');
    expect(store.states.at(-1)).toBe('ANALYZING');
  });

  it('leases and dispatches an unpublished follow-up after command-center restart', async () => {
    const now = new Date().toISOString();
    const run: InvestigationRun = {
      schemaVersion: INVESTIGATION_RUN_SCHEMA_VERSION,
      runId: 'run-recovery-1', caseId: 'case-recovery-1', state: 'ACTIVE', frontierVersion: 1, depth: 1,
      budget: { maxDepth: 5, deadlineAt: new Date(Date.now() + 60_000).toISOString(), maxExternalQueries: 5, maxCostMicros: 1_000_000 },
      usage: { externalQueries: 0, costMicros: 0 }, policyVersion: 'gss.test-planner.v1', createdAt: now, updatedAt: now,
    };
    const frontier: EvidenceFrontier = {
      schemaVersion: 'gss.evidence-frontier.v1', runId: run.runId, caseId: run.caseId, version: 1,
      facts: [], contradictions: [], evidenceRefs: ['EVD-recovery'], sourceObservationIds: ['obs-recovery'], updatedAt: now,
    };
    const proposedAction = { target: 'cli' as const, action: 'inspect_system' as const, parameters: {}, riskLevel: 'read_only' as const };
    const decision = {
      schemaVersion: 'gss.next-step.v1' as const, decisionId: 'DEC-recovery-1', runId: run.runId, caseId: run.caseId,
      frontierVersion: 1, kind: 'DISPATCH' as const, reasonCode: 'RECOVER_PENDING_DISPATCH', rationale: 'resume safely',
      policyVersion: run.policyVersion, action: { ...proposedAction, fingerprint: actionFingerprint(proposedAction) }, createdAt: now,
    };
    const store = new RecoverableMemoryStore({
      created: false, run, frontier, decision, outbox: createControlOutboxEvent(decision, 'task-before-restart'),
    });
    const app = new CentralCommandOrchestrator(0, { routePrompt: async () => ({ agent: 'chat', instruction: 'unused' }) }, signer, controlPlaneFixture(store));
    servers.push(app);
    const port = await app.ready();
    const worker = await connect(port, 'cli-worker-agent', 'CLI_DAEMON', ['REPORT']);

    const recoveredTask = await nextTask(worker);
    expect(recoveredTask.payload.action).toBe('inspect_system');
    expect(recoveredTask.payload.contextRefs).toEqual(['EVD-recovery']);
    expect(store.tasks).toHaveLength(1);
    expect(store.publishedEvents).toEqual([createControlOutboxEvent(decision, 'task-before-restart').eventId]);
  });
});
