import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { HttpControlPlaneClient } from '../../services/standalone/src/control-plane-client.ts';
import type { GssTaskContract } from '../../packages/sdk/src/index.ts';

const requests: string[] = [];
const authorizationHeaders: Array<string | undefined> = [];
let server: ReturnType<typeof createServer>;
let baseUrl = '';

function reply(response: ServerResponse, body: Record<string, unknown>): void {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push(`${request.method} ${request.url}`);
    authorizationHeaders.push(request.headers.authorization);
    if (request.url?.endsWith('/investigation-run')) return reply(response, { run: { runId: 'RUN-test' } });
    if (request.url?.endsWith('/messages')) return reply(response, { messageId: 'MSG-test' });
    if (request.url?.endsWith('/outbox/claim')) return reply(response, { dispatches: [] });
    if (request.url?.endsWith('/outbox/publish')) return reply(response, { published: true });
    if (request.url?.endsWith('/outbox/release')) return reply(response, { released: true });
    if (request.url?.endsWith('/tasks')) return reply(response, { task: { taskId: 'TSK-test' }, replay: false });
    if (request.url?.endsWith('/artifacts/sign')) return reply(response, { signature: {
      algorithm: 'EdDSA', keyId: 'test-key', artifactHash: 'a'.repeat(64), compactJws: 'header.payload.signature',
    } });
    if (request.url?.endsWith('/artifacts/register')) return reply(response, { artifactId: 'ART-test', created: true });
    return reply(response, {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

describe('Control Plane HTTP client', () => {
  it('uses the authority endpoints for lifecycle, task, result and outbox writes', async () => {
    const client = new HttpControlPlaneClient(baseUrl, 'test-control-plane-token-32-characters');
    await client.ensureCase('CASE-test', 'analyst');
    await client.ensureInvestigationRun('CASE-test', 'analyst');
    await client.appendMessage('CASE-test', 'USER', 'investigate');
    await client.transitionCase('CASE-test', 'TRIAGING');
    const task: GssTaskContract = {
      schemaVersion: 'gss.task.v1', taskId: 'TSK-test', caseId: 'CASE-test', idempotencyKey: 'idem-test',
      source: 'standalone', target: 'cli', action: 'inspect_hostname', parameters: {}, riskLevel: 'read_only',
      contextRefs: [], timeoutMs: 15_000, createdAt: new Date().toISOString(),
    };
    await client.createTask(task, 'analyst');
    await client.updateTask(task.taskId, 'DISPATCHED', 'cli-worker-agent');
    await client.recordResult({
      schemaVersion: 'gss.result.v1', taskId: task.taskId, caseId: task.caseId, executor: 'cli', status: 'COMPLETED',
      result: { summary: 'ok', action: task.action }, evidenceRefs: [], errors: [], metrics: { durationMs: 1, outputBytes: 0 },
      completedAt: new Date().toISOString(),
    });
    await client.recordModelUsage({
      schemaVersion: 'gss.model-usage.v1', usageId: 'USG-test', caseId: task.caseId, traceId: 'trace-test',
      model: 'gpt-5.6-sol', reasoningEffort: 'medium', routeReason: 'test', inputTokens: 10, outputTokens: 5,
      cachedTokens: 0, latencyMs: 2, retryCount: 0, estimatedCostMicros: 0, status: 'SUCCEEDED', createdAt: new Date().toISOString(),
    });
    const signature = await client.signArtifact({ artifactHash: 'a'.repeat(64), caseId: task.caseId,
      taskId: task.taskId, createdAt: new Date().toISOString() });
    expect(signature.keyId).toBe('test-key');
    const artifact = await client.registerArtifact({ caseId: task.caseId, taskId: task.taskId, sha256: 'a'.repeat(64),
      bytes: 2, ref: 'artifact://evidence/test.txt', storageProvider: 'filesystem', mediaType: 'text/plain' });
    expect(artifact.created).toBe(true);
    await client.claimPendingDispatches('owner');
    await client.markOutboxPublished('EVT-test', 'owner');
    await client.releaseOutbox('EVT-test', 'owner', 'offline', new Date().toISOString());

    expect(requests).toEqual([
      'POST /control/v1/cases',
      'POST /control/v1/cases/CASE-test/investigation-run',
      'POST /control/v1/cases/CASE-test/messages',
      'POST /control/v1/cases/CASE-test/state',
      'POST /control/v1/tasks',
      'POST /control/v1/tasks/TSK-test/status',
      'POST /control/v1/results',
      'POST /control/v1/model-usage',
      'POST /control/v1/artifacts/sign',
      'POST /control/v1/artifacts/register',
      'POST /control/v1/outbox/claim',
      'POST /control/v1/outbox/EVT-test/publish',
      'POST /control/v1/outbox/EVT-test/release',
    ]);
    expect(authorizationHeaders.every(value => value === 'Bearer test-control-plane-token-32-characters')).toBe(true);
  });

  it('refuses to start without a strong service token', () => {
    expect(() => new HttpControlPlaneClient(baseUrl, 'short')).toThrow(/at least 32 characters/);
  });
});
