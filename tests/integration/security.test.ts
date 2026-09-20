import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { TokenSigner } from '../../packages/sdk/src/security/token-signer.ts';
import { WsCommandServer } from '../../packages/sdk/src/transport/ws-server.ts';
import { ASQWebSocketClient } from '../../packages/sdk/src/transport/ws-client.ts';
import { ASQgRPCClient } from '../../packages/sdk/src/transport/grpc-client.ts';
import { ControlledExecutor, instructionHash, parseReadOnlyCommand } from '../../services/cli-worker/src/controlled-executor.ts';
import { CentralCommandOrchestrator } from '../../services/standalone/src/command-center.ts';
import { ProgressiveAutonomyController } from '../../services/standalone/src/autonomy/progressive-controller.ts';
import type { RuntimeStore } from '../../packages/persistence/src/runtime-store.ts';
import type { CaseState, GssResultContract, GssTaskContract, ObservationPack, TaskStatus } from '../../packages/sdk/src/runtime/contracts.ts';

const secret = 'integration-test-secret-only-32-characters';
const signer = new TokenSigner(secret);
const session = (agentId: string, role = 'CISO_Admin', permissions = ['CONTROL']) =>
  signer.sign({ agentId, role, permissions, timestamp: Date.now(), expiresAt: Date.now() + 60000 });
const frame = (payload: any, extra: any = {}) => ({ type: 'COMMAND', message_id: randomUUID(),
  incident_id: 'case-1', timestamp: Date.now(), payload, ...extra });
const task = (instruction = 'hostname') => {
  const taskId = randomUUID(), incidentId = 'case-1';
  return { taskId, incidentId, instruction, token: signer.sign({
    agentId: 'cli-worker-agent', role: 'STANDALONE', permissions: ['EXECUTE_RECON'],
    timestamp: Date.now(), expiresAt: Date.now() + 60000, taskId, incidentId,
    instructionHash: instructionHash(instruction)
  }) };
};
const sockets: WebSocket[] = [];
const servers: { close(): Promise<void> }[] = [];
class MemoryRuntimeStore implements RuntimeStore {
  tasks: GssTaskContract[] = [];
  results: GssResultContract[] = [];
  messages: Array<{ caseId: string; role: string; content: string }> = [];
  states: CaseState[] = [];
  async ready() {}
  async close() {}
  async ensureCase() {}
  async transitionCase(_caseId: string, state: CaseState) { this.states.push(state); }
  async appendMessage(caseId: string, role: any, content: string) { this.messages.push({ caseId, role, content }); return randomUUID(); }
  async createTask(task: GssTaskContract) { this.tasks.push(task); return { created: true }; }
  async updateTask(_taskId: string, _status: TaskStatus, _worker?: string) {}
  async recordResult(result: GssResultContract, _observation?: ObservationPack) { this.results.push(result); }
}
async function connect(port: number, token: string) {
  const ws = new WebSocket('ws://127.0.0.1:' + port, { headers: { Authorization: 'Bearer ' + token } });
  sockets.push(ws);
  await once(ws, 'open');
  return ws;
}
async function nextStatus(ws: WebSocket, state: string) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => { ws.off('message', receive); reject(new Error('Missing status ' + state)); }, 3000);
    function receive(raw: any) {
      const message = JSON.parse(raw.toString());
      if (message.payload?.source === state) { clearTimeout(timeout); ws.off('message', receive); resolve(message); }
    }
    ws.on('message', receive);
  });
}
async function nextFrameType(ws: WebSocket, type: string) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => { ws.off('message', receive); reject(new Error('Missing frame ' + type)); }, 3000);
    function receive(raw: any) {
      const message = JSON.parse(raw.toString());
      if (message.type === type) { clearTimeout(timeout); ws.off('message', receive); resolve(message); }
    }
    ws.on('message', receive);
  });
}
afterEach(async () => {
  sockets.splice(0).forEach(s => s.terminate());
  await Promise.all(servers.splice(0).map(s => s.close()));
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe('Token boundary', () => {
  it('rejects missing secrets and malformed or expired signed claims', () => {
    expect(() => new TokenSigner('')).toThrow();
    for (const claims of [{ agentId: 'x', role: 'CISO_Admin', permissions: ['CONTROL'] },
      { agentId: 'x', role: 'CISO_Admin', permissions: ['CONTROL'], timestamp: 1, expiresAt: 2 }]) {
      const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const token = data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
      expect(signer.verify(token)).toBeNull();
    }
    const token = session('owner');
    expect(signer.verify(token)?.agentId).toBe('owner');
    expect(signer.verify('x' + token)).toBeNull();
    expect(signer.verify(token.split('.')[0] + '.x')).toBeNull();
  });
});

describe('Controlled host execution', () => {
  it.each(['hostname & whoami', 'hostname;whoami', 'hostname\nwhoami', 'hostnameevil',
    'ping 8.8.8.8', 'ipconfig /release', 'Please run hostname', '$(hostname)'])('rejects %s before execution', async command => {
    const run = vi.fn(async () => 'should not run');
    expect((await new ControlledExecutor(signer, run).execute(task(command))).status).toBe('DENIED');
    expect(parseReadOnlyCommand(command)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
  it('binds authorization to incident, command, and task; consumes each task only once', async () => {
    const run = vi.fn(async () => 'test-host');
    const worker = new ControlledExecutor(signer, run), authorized = task();
    expect((await worker.execute({ ...authorized, instruction: 'systeminfo' })).status).toBe('DENIED');
    expect((await worker.execute({ ...authorized, incidentId: 'other' })).status).toBe('DENIED');
    expect((await worker.execute({ ...authorized, taskId: 'other' })).status).toBe('DENIED');
    expect((await worker.execute(authorized)).status).toBe('SUCCESS');
    expect((await worker.execute(authorized)).status).toBe('DENIED');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('binds a structured capability to the exact resolved command', async () => {
    const run = vi.fn(async () => 'test-host');
    const worker = new ControlledExecutor(signer, run);
    expect((await worker.execute({ ...task('hostname'), action: 'inspect_system' })).status).toBe('DENIED');
    expect((await worker.execute({ ...task('hostname'), action: 'inspect_hostname' })).status).toBe('SUCCESS');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('cancels in-flight execution and denies new work after halt', async () => {
    const run = vi.fn((_file: string, _args: string[], signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')));
    }));
    const worker = new ControlledExecutor(signer, run);
    const pending = worker.execute(task());
    worker.halt();
    expect((await pending).status).toBe('CANCELLED');
    expect((await worker.execute(task())).status).toBe('DENIED');
  });
});

describe('Real WebSocket authorization', () => {
  it('allows multiple authenticated browser panels without allowing worker takeover', async () => {
    const server = new WsCommandServer(0, { signer }); servers.push(server);
    const port = await server.ready(), token = session('browser');
    const first = await connect(port, token), second = await connect(port, token);
    const a = once(first, 'message'), b = once(second, 'message');
    server.broadcast({ type: 'STATUS', payload: { status: 'ready' } });
    expect(JSON.parse((await a)[0].toString()).payload.status).toBe('ready');
    expect(JSON.parse((await b)[0].toString()).payload.status).toBe('ready');
  });
  it('disconnects expired observers even if they never send a message', async () => {
    const server = new WsCommandServer(0, { signer }); servers.push(server);
    const token = signer.sign({ agentId: 'short-session', role: 'CISO_Admin', permissions: ['CONTROL'],
      timestamp: Date.now(), expiresAt: Date.now() + 500 });
    const ws = await connect(await server.ready(), token);
    expect((await once(ws, 'close'))[0]).toBe(1008);
  });
  it('rejects cross-origin browser handshakes', async () => {
    const server = new WsCommandServer(0, { signer }); servers.push(server);
    const ws = new WebSocket('ws://127.0.0.1:' + await server.ready(), {
      origin: 'https://untrusted.invalid', headers: { Authorization: 'Bearer ' + session('browser') }
    });
    sockets.push(ws); ws.on('error', () => {});
    const [, response] = await once(ws, 'unexpected-response');
    expect(response.statusCode).toBe(403); ws.terminate();
  });
  it('rejects an unauthenticated handshake', async () => {
    const server = new WsCommandServer(0, { signer }); servers.push(server);
    const port = await server.ready();
    const ws = new WebSocket('ws://127.0.0.1:' + port); sockets.push(ws);
    ws.on('error', () => {});
    const [, response] = await once(ws, 'unexpected-response');
    expect(response.statusCode).toBe(401);
    ws.terminate();
  });
  it('uses authenticated identity even if the frame claims another identity, and rejects replay', async () => {
    const server = new WsCommandServer(0, { signer }); servers.push(server);
    const ws = await connect(await server.ready(), session('actual-user'));
    const incoming = once(server, 'message');
    const message = frame({ action: 'commander_prompt', content: 'hello' }, { agentId: 'forged', source: 'CLI_DAEMON' });
    ws.send(JSON.stringify(message));
    const [received] = await incoming;
    expect(received.agentId).toBe('actual-user');
    expect(received.source).toBe('CISO_Admin');
    const closed = once(ws, 'close');
    ws.send(JSON.stringify(message));
    expect((await closed)[0]).toBe(1008);
  });
  it('denies worker control commands and duplicate worker identities', async () => {
    const server = new WsCommandServer(0, { signer }); servers.push(server);
    const port = await server.ready(), token = session('cli-worker-agent', 'CLI_DAEMON', ['REPORT']);
    const worker = await connect(port, token);
    const duplicate = await connect(port, token);
    expect((await once(duplicate, 'close'))[0]).toBe(1008);
    const closed = once(worker, 'close');
    worker.send(JSON.stringify(frame({ action: 'trigger_killswitch' })));
    expect((await closed)[0]).toBe(1008);
  });
  it('delivers ASQ frames to SDK subscribers and intentional disconnect does not reconnect', async () => {
    const server = new WsCommandServer(0, { signer }); servers.push(server);
    const client = new ASQWebSocketClient('ws://127.0.0.1:' + await server.ready(), session('sdk'));
    await new Promise<void>(resolve => { client.subscribe('system:connected', () => resolve()); client.connect(); });
    const data = new Promise<any>(resolve => client.subscribe('message', resolve));
    server.sendToAgent('sdk', { type: 'STATUS', payload: { status: 'ready' } });
    expect((await data).payload.status).toBe('ready');
    client.disconnect();
    expect((client as any).stopped).toBe(true);
    expect((client as any).timer).toBeUndefined();
  });
});

describe('Orchestrator over real sockets', () => {
  it('dispatches a signed task and correlates actual execution evidence to the incident', async () => {
    const store = new MemoryRuntimeStore();
    const app = new CentralCommandOrchestrator(0, { routePrompt: async () => ({ agent: 'cli', action: 'inspect_hostname', instruction: 'hostname', parameters: {} }) }, signer, store);
    servers.push(app);
    const port = await app.ready();
    const worker = await connect(port, session('cli-worker-agent', 'CLI_DAEMON', ['REPORT']));
    const user = await connect(port, session('controller'));
    const evidence = nextStatus(user, 'SUCCESS');
    const dispatched = nextFrameType(worker, 'TASK');
    user.send(JSON.stringify(frame({ action: 'commander_prompt', content: 'hostname' })));
    const message = await dispatched;
    expect(message.type).toBe('TASK');
    expect(message.payload.schemaVersion).toBe('gss.task.v1');
    expect(message.payload.action).toBe('inspect_hostname');
    expect(message.payload.riskLevel).toBe('read_only');
    const result = await new ControlledExecutor(signer).execute(message.payload);
    expect(result.status).toBe('SUCCESS');
    expect(result.output.trim().length).toBeGreaterThan(0);
    worker.send(JSON.stringify(frame({ ...result, content: result.output }, { type: 'EVIDENCE', incident_id: message.incident_id })));
    const completed = await evidence;
    expect(completed.incident_id).toBe('case-1');
    expect(completed.payload.result.schemaVersion).toBe('gss.result.v1');
    expect(completed.payload.observation.evidenceRefs).toHaveLength(1);
    expect(store.tasks).toHaveLength(1);
    expect(store.results[0]?.status).toBe('COMPLETED');
    expect(store.states).toContain('COLLECTING_EVIDENCE');
    expect(store.states).toContain('ANALYZING');
  });
  it('returns a conversation response without fabricating an executor task', async () => {
    const store = new MemoryRuntimeStore();
    const app = new CentralCommandOrchestrator(0, { routePrompt: async () => ({ agent: 'chat', instruction: 'How can I help with this case?' }) }, signer, store);
    servers.push(app);
    const ws = await connect(await app.ready(), session('controller'));
    const chat = nextStatus(ws, 'CHAT');
    ws.send(JSON.stringify(frame({ action: 'commander_prompt', content: 'hello' })));
    expect((await chat).payload.message).toBe('How can I help with this case?');
    expect(store.tasks).toHaveLength(0);
    expect(store.messages.map(item => item.role)).toEqual(['USER', 'ASSISTANT']);
    expect(store.states).toContain('RESPONDING');
  });
  it('reports an offline worker instead of success', async () => {
    const app = new CentralCommandOrchestrator(0, { routePrompt: async () => ({ agent: 'cli', instruction: 'hostname' }) }, signer);
    servers.push(app);
    const ws = await connect(await app.ready(), session('controller'));
    const status = nextStatus(ws, 'OFFLINE');
    ws.send(JSON.stringify(frame({ action: 'commander_prompt', content: 'hostname' })));
    expect((await status).payload.source).toBe('OFFLINE');
  });
  it('does not dispatch a model decision which finishes after kill-switch activation', async () => {
    let finish!: (v: any) => void;
    const routePrompt = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
    const app = new CentralCommandOrchestrator(0, { routePrompt }, signer); servers.push(app);
    const port = await app.ready();
    const user = await connect(port, session('controller'));
    const worker = await connect(port, session('cli-worker-agent', 'CLI_DAEMON', ['REPORT']));
    const frames: any[] = []; worker.on('message', raw => frames.push(JSON.parse(raw.toString())));
    user.send(JSON.stringify(frame({ action: 'commander_prompt', content: 'hostname' })));
    await vi.waitFor(() => expect(routePrompt).toHaveBeenCalledOnce());
    const halted = nextStatus(user, 'HALTED');
    user.send(JSON.stringify(frame({ action: 'trigger_killswitch' })));
    await halted;
    finish({ agent: 'cli', instruction: 'hostname' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(frames.some(f => f.type === 'TASK')).toBe(false);
    expect(frames.some(f => f.payload?.action === 'system_halt')).toBe(true);
  });
});

describe('No fabricated external success', () => {
  it('refuses insecure live gRPC in production until an mTLS adapter exists', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new ASQgRPCClient('localhost:50051').connect()).toThrow();
  });
  it('forbids mock gRPC in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new ASQgRPCClient('unused', 'mock').connect()).toThrow(/forbidden/);
  });
  it('never grants itself human approval', async () => {
    const result = await new ProgressiveAutonomyController().coordinateDeployment(
      { score: 10, isSafeForAutoDeploy: true, criticalServicesAffected: [] }, 'patch');
    expect(result).toContain('PENDING_APPROVAL');
    expect(result).toContain('no deployment performed');
  });
});
