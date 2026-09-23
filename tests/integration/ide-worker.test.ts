import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { TokenSigner } from '../../packages/sdk/src/security/token-signer.ts';
import type { CaseState, GssResultContract, GssTaskContract, ObservationPack, TaskStatus } from '../../packages/sdk/src/runtime/contracts.ts';
import type { RuntimeStore } from '../../packages/persistence/src/runtime-store.ts';
import { FilesystemArtifactStore } from '../../packages/persistence/src/artifact-store.ts';
import { CentralCommandOrchestrator } from '../../services/standalone/src/command-center.ts';
import { IdeInvestigatorDaemon } from '../../services/ide-reasoning/src/engine.ts';
import { ReadonlyRepoInvestigator } from '../../services/ide-reasoning/src/readonly-investigator.ts';

const secret = 'ide-integration-secret-at-least-32-characters';
const signer = new TokenSigner(secret);
const session = (agentId: string, role = 'CISO_Admin', permissions = ['CONTROL']) =>
  signer.sign({ agentId, role, permissions, timestamp: Date.now(), expiresAt: Date.now() + 60_000 });

class MemoryRuntimeStore implements RuntimeStore {
  tasks: GssTaskContract[] = [];
  results: GssResultContract[] = [];
  observations: ObservationPack[] = [];
  states: CaseState[] = [];
  idempotencyKeys = new Set<string>();
  async ready() {}
  async close() {}
  async ensureCase() {}
  async transitionCase(_caseId: string, state: CaseState) { this.states.push(state); }
  async appendMessage() { return randomUUID(); }
  async createTask(task: GssTaskContract) {
    if (this.idempotencyKeys.has(task.idempotencyKey)) return { created: false };
    this.idempotencyKeys.add(task.idempotencyKey);
    this.tasks.push(task);
    return { created: true };
  }
  async updateTask(_taskId: string, _status: TaskStatus, _worker?: string) {}
  async recordResult(result: GssResultContract, observation?: ObservationPack) {
    this.results.push(result);
    if (observation) this.observations.push(observation);
  }
}

const temporaryRoots: string[] = [];
const sockets: WebSocket[] = [];
const daemons: IdeInvestigatorDaemon[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gss-ide-integration-'));
  temporaryRoots.push(root);
  return root;
}

async function connect(port: number, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Authorization: `Bearer ${token}` } });
  sockets.push(socket);
  await once(socket, 'open');
  return socket;
}

function nextStatus(socket: WebSocket, source: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error(`Missing status ${source}`)); }, 5000);
    function receive(raw: any) {
      const message = JSON.parse(raw.toString());
      if (message.payload?.source === source) {
        clearTimeout(timeout); socket.off('message', receive); resolve(message);
      }
    }
    socket.on('message', receive);
  });
}

function nextFrameType(socket: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error(`Missing frame ${type}`)); }, 5000);
    function receive(raw: any) {
      const message = JSON.parse(raw.toString());
      if (message.type === type) {
        clearTimeout(timeout); socket.off('message', receive); resolve(message);
      }
    }
    socket.on('message', receive);
  });
}

afterEach(async () => {
  daemons.splice(0).forEach(daemon => daemon.stop());
  sockets.splice(0).forEach(socket => socket.terminate());
  await Promise.all(servers.splice(0).map(server => server.close()));
  for (const root of temporaryRoots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'gss-ide-integration-'))) throw new Error('Refusing unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

describe('IDE read-only vertical slice over real WebSockets', () => {
  it('persists a correlated result and ObservationPack backed by an immutable artifact', async () => {
    const repositoryRoot = await temporaryRoot();
    const artifactRoot = await temporaryRoot();
    await mkdir(join(repositoryRoot, 'src'));
    await writeFile(join(repositoryRoot, 'src', 'evidence.ts'), 'export const GSS_IDE_MARKER = "verified";\n');
    const store = new MemoryRuntimeStore();
    const router = { routePrompt: async () => ({
      agent: 'ide', action: 'search_code' as const, instruction: 'Find GSS_IDE_MARKER',
      parameters: { question: 'Find GSS_IDE_MARKER', query: 'GSS_IDE_MARKER', path: 'src' },
    }) };
    const app = new CentralCommandOrchestrator(0, router, signer, store, new FilesystemArtifactStore(artifactRoot));
    servers.push(app);
    const port = await app.ready();
    const daemon = new IdeInvestigatorDaemon(`ws://127.0.0.1:${port}`,
      session('ide-worker-agent', 'IDE_AGENT', ['REPORT']), new ReadonlyRepoInvestigator([repositoryRoot]));
    daemons.push(daemon);
    await daemon.connect();
    const user = await connect(port, session('controller'));
    const completed = nextStatus(user, 'SUCCESS');
    user.send(JSON.stringify({
      type: 'COMMAND', message_id: randomUUID(), incident_id: 'case-ide', timestamp: Date.now(),
      payload: { action: 'commander_prompt', content: 'Find the IDE marker' },
    }));
    const status = await completed;
    expect(status.payload.result.schemaVersion).toBe('gss.result.v1');
    expect(status.payload.result.executor).toBe('ide');
    expect(status.payload.result.result.investigation.schemaVersion).toBe('gss.ide-investigation.v1');
    expect(status.payload.result.result.investigation.matches[0]).toMatchObject({ path: 'src/evidence.ts', line: 1 });
    expect(store.tasks).toHaveLength(1);
    expect(store.results[0]?.status).toBe('COMPLETED');
    expect(store.observations[0]?.evidenceRefs).toHaveLength(1);
    expect(store.observations[0]?.rawArtifactRef).toMatch(/^artifact:\/\/evidence\/case-ide\//);
    expect(store.states).toContain('COLLECTING_EVIDENCE');
    expect(store.states).toContain('ANALYZING');
    const artifactDirectory = join(artifactRoot, 'evidence', 'case-ide');
    const artifactFiles = await readdir(artifactDirectory);
    expect(artifactFiles).toHaveLength(1);
    const artifact = await readFile(join(artifactDirectory, artifactFiles[0]), 'utf8');
    expect(artifact).toContain('gss.ide-investigation.v1');
    expect(artifact).toContain('GSS_IDE_MARKER');
    expect(artifact).not.toContain(repositoryRoot);
  });

  it('rejects a worker SUCCESS frame without a valid correlated IDE investigation record', async () => {
    const artifactRoot = await temporaryRoot();
    const store = new MemoryRuntimeStore();
    const router = { routePrompt: async () => ({
      agent: 'ide', action: 'search_code' as const, instruction: 'Find marker',
      parameters: { question: 'Find marker', query: 'marker', path: 'src' },
    }) };
    const app = new CentralCommandOrchestrator(0, router, signer, store, new FilesystemArtifactStore(artifactRoot));
    servers.push(app);
    const port = await app.ready();
    const worker = await connect(port, session('ide-worker-agent', 'IDE_AGENT', ['REPORT']));
    const user = await connect(port, session('controller'));
    const taskFrame = nextFrameType(worker, 'TASK');
    user.send(JSON.stringify({
      type: 'COMMAND', message_id: randomUUID(), incident_id: 'case-ide-invalid', timestamp: Date.now(),
      payload: { action: 'commander_prompt', content: 'Find the marker' },
    }));
    const dispatched = await taskFrame;
    const failed = nextStatus(user, 'INVALID_RESULT');
    worker.send(JSON.stringify({
      type: 'RESULT', message_id: randomUUID(), incident_id: dispatched.incident_id, timestamp: Date.now(),
      payload: { taskId: dispatched.payload.taskId, status: 'SUCCESS', output: 'unverified worker prose' },
    }));
    const status = await failed;
    expect(status.payload.result.status).toBe('FAILED');
    expect(status.payload.result.evidenceRefs).toEqual([]);
    expect(status.payload.result.result.investigation).toBeUndefined();
    expect(store.results[0]?.status).toBe('FAILED');
  });

  it('does not create a duplicate IDE task when the same request is replayed after orchestrator restart', async () => {
    const store = new MemoryRuntimeStore();
    const router = { routePrompt: async () => ({
      agent: 'ide', action: 'search_code' as const, instruction: 'Find marker', parameters: { query: 'marker' },
    }) };
    const request = {
      type: 'COMMAND', message_id: 'stable-request-id', incident_id: 'case-ide-restart', timestamp: Date.now(),
      payload: { action: 'commander_prompt', content: 'Find the marker' },
    };
    const first = new CentralCommandOrchestrator(0, router, signer, store);
    servers.push(first);
    const firstPort = await first.ready();
    const worker = await connect(firstPort, session('ide-worker-agent', 'IDE_AGENT', ['REPORT']));
    const user = await connect(firstPort, session('controller-first'));
    const dispatched = nextFrameType(worker, 'TASK');
    user.send(JSON.stringify(request));
    await dispatched;
    expect(store.tasks).toHaveLength(1);
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = new CentralCommandOrchestrator(0, router, signer, store);
    servers.push(second);
    const secondUser = await connect(await second.ready(), session('controller-second'));
    const duplicate = nextStatus(secondUser, 'DUPLICATE');
    secondUser.send(JSON.stringify({ ...request, timestamp: Date.now() }));
    expect((await duplicate).payload.source).toBe('DUPLICATE');
    expect(store.tasks).toHaveLength(1);
  });
});
