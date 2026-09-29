import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  RESULT_SCHEMA_VERSION,
  sha256Canonical,
  TASK_SCHEMA_VERSION,
  type CaseState,
  type ModelUsageRecord,
  type TaskStatus,
  type GssResultContract,
  type GssTaskContract,
  type CapabilityAction,
} from '@asq/sdk';
import { PostgresInvestigationStore, PostgresRuntimeStore } from '@asq/persistence';

const MAX_BODY_BYTES = 1_000_000;
const ACTIONS = new Set<CapabilityAction>([
  'inspect_hostname', 'inspect_system', 'inspect_network_config', 'inspect_network_connections',
  'analyze_code', 'search_code', 'search_siem',
]);
const TARGETS: Record<CapabilityAction, GssTaskContract['target']> = {
  inspect_hostname: 'cli', inspect_system: 'cli', inspect_network_config: 'cli', inspect_network_connections: 'cli',
  analyze_code: 'ide', search_code: 'ide', search_siem: 'siem',
};
const CASE_STATES = new Set<CaseState>(['NEW', 'TRIAGING', 'COLLECTING_EVIDENCE', 'INVESTIGATING', 'ANALYZING', 'RESPONDING', 'CLOSED']);
const MESSAGE_ROLES = new Set(['USER', 'ASSISTANT', 'SYSTEM', 'WORKER']);

type Json = Record<string, unknown> | unknown[];

function json(response: ServerResponse, status: number, body: Json): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function actor(request: IncomingMessage): string {
  return String(request.headers['x-gss-actor'] ?? 'control-api');
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('JSON object required');
    return value as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { statusCode: 422 });
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`${name} is required`), { statusCode: 422 });
  return value.trim();
}

function taskFrom(input: Record<string, unknown>, request: IncomingMessage): GssTaskContract {
  const action = requiredString(input.action, 'action') as CapabilityAction;
  if (!ACTIONS.has(action)) throw Object.assign(new Error('action is not allowlisted'), { statusCode: 403 });
  const target = requiredString(input.target, 'target');
  if (!['cli', 'ide', 'siem'].includes(target)) throw Object.assign(new Error('target is invalid'), { statusCode: 422 });
  if (TARGETS[action] !== target) throw Object.assign(new Error('action is not valid for target'), { statusCode: 403 });
  const caseId = requiredString(input.caseId, 'caseId');
  const idempotencyKey = requiredString(input.idempotencyKey ?? request.headers['idempotency-key'], 'idempotencyKey');
  return {
    schemaVersion: TASK_SCHEMA_VERSION,
    taskId: typeof input.taskId === 'string' && input.taskId ? input.taskId : randomUUID(),
    caseId,
    idempotencyKey,
    source: 'standalone',
    target: target as GssTaskContract['target'],
    action,
    parameters: (input.parameters && typeof input.parameters === 'object' ? input.parameters : {}) as Record<string, unknown>,
    riskLevel: 'read_only',
    contextRefs: Array.isArray(input.contextRefs) ? input.contextRefs.filter(item => typeof item === 'string') as string[] : [],
    timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : 15_000,
    createdAt: new Date().toISOString(),
  };
}

export class ControlPlaneServer {
  private readonly server;
  private readonly pool: Pool;
  private readonly runtime: PostgresRuntimeStore;
  private readonly investigations: PostgresInvestigationStore;

  public constructor(private readonly port = Number(process.env.CONTROL_PLANE_PORT ?? 4100)) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the Control Plane');
    this.pool = new Pool({ connectionString, max: 10, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
    this.runtime = new PostgresRuntimeStore(this.pool);
    this.investigations = new PostgresInvestigationStore(this.pool);
    this.server = createServer((request, response) => { void this.handle(request, response); });
  }

  public async ready(): Promise<number> {
    await this.runtime.ready();
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
    return this.port;
  }

  public async close(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    await this.pool.end();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    try {
      if (method === 'GET' && url.pathname === '/livez') return json(response, 200, { status: 'ok' });
      if (method === 'GET' && url.pathname === '/readyz') {
        await this.runtime.ready();
        return json(response, 200, { status: 'ready', storage: 'postgresql' });
      }
      if (method === 'POST' && url.pathname === '/control/v1/cases') return this.createCase(request, response);
      const runMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/investigation-run$/);
      if (method === 'POST' && runMatch) return this.ensureRun(decodeURIComponent(runMatch[1]), request, response);
      const messageMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/messages$/);
      if (method === 'POST' && messageMatch) return this.appendMessage(decodeURIComponent(messageMatch[1]), request, response);
      const stateMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/state$/);
      if (method === 'POST' && stateMatch) return this.transitionCase(decodeURIComponent(stateMatch[1]), request, response);
      if (method === 'POST' && url.pathname === '/control/v1/tasks') return this.createTask(request, response);
      const taskStatusMatch = url.pathname.match(/^\/control\/v1\/tasks\/([^/]+)\/status$/);
      if (method === 'POST' && taskStatusMatch) return this.updateTaskStatus(decodeURIComponent(taskStatusMatch[1]), request, response);
      if (method === 'POST' && url.pathname === '/control/v1/outbox/claim') return this.claimOutbox(request, response);
      const publishMatch = url.pathname.match(/^\/control\/v1\/outbox\/([^/]+)\/publish$/);
      if (method === 'POST' && publishMatch) return this.publishOutbox(decodeURIComponent(publishMatch[1]), request, response);
      const releaseMatch = url.pathname.match(/^\/control\/v1\/outbox\/([^/]+)\/release$/);
      if (method === 'POST' && releaseMatch) return this.releaseOutbox(decodeURIComponent(releaseMatch[1]), request, response);
      if (method === 'GET' && /^\/control\/v1\/tasks\/[^/]+$/.test(url.pathname)) return this.getTask(url.pathname.split('/').pop()!, response);
      if (method === 'POST' && url.pathname === '/control/v1/results') return this.recordResult(request, response);
      if (method === 'POST' && url.pathname === '/control/v1/model-usage') return this.recordModelUsage(request, response);
      const frontierMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/frontier$/);
      if (method === 'GET' && frontierMatch) return this.getFrontier(decodeURIComponent(frontierMatch[1]), response);
      if (method === 'POST' && url.pathname === '/control/v1/approvals') return this.createApproval(request, response);
      const approvalMatch = url.pathname.match(/^\/control\/v1\/approvals\/([^/]+)\/decision$/);
      if (method === 'POST' && approvalMatch) return this.approve(decodeURIComponent(approvalMatch[1]), request, response);
      if (method === 'GET' && url.pathname === '/control/v1/audit') return this.audit(url, response);
      if (method === 'GET' && url.pathname === '/control/v1/workers') return this.workers(response);
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      const status = typeof error === 'object' && error && 'statusCode' in error ? Number((error as { statusCode: number }).statusCode) : 500;
      console.error('[ControlPlane]', error instanceof Error ? error.message : error);
      return json(response, status, { error: status === 500 ? 'internal_error' : error instanceof Error ? error.message : 'request_failed' });
    }
  }

  private async createTask(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const task = taskFrom(input, request);
    const actionFingerprint = sha256Canonical({ caseId: task.caseId, target: task.target, action: task.action,
      parameters: task.parameters, contextRefs: task.contextRefs, timeoutMs: task.timeoutMs });
    const existing = await this.pool.query<{ task_id: string; action_fingerprint: string | null }>(
      'SELECT task_id,action_fingerprint FROM runtime_tasks WHERE idempotency_key=$1', [task.idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].action_fingerprint !== actionFingerprint) {
        return json(response, 409, { error: 'idempotency_key_payload_mismatch', taskId: existing.rows[0].task_id });
      }
      return json(response, 200, { taskId: existing.rows[0].task_id, replay: true });
    }
    await this.runtime.ensureCase(task.caseId, actor(request));
    const result = await this.runtime.createTask(task, actor(request), {
      runId: typeof input.runId === 'string' ? input.runId : undefined,
      actionFingerprint,
    });
    if (!result.created) return json(response, 200, { task, replay: true });
    return json(response, 201, { task, replay: false });
  }

  private async createCase(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const caseId = requiredString(input.caseId, 'caseId');
    await this.runtime.ensureCase(caseId, actor(request));
    return json(response, 201, { caseId, created: true });
  }

  private async updateTaskStatus(taskId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const status = requiredString(input.status, 'status') as TaskStatus;
    const allowed = new Set<TaskStatus>(['QUEUED', 'DISPATCHED', 'RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED']);
    if (!allowed.has(status)) throw Object.assign(new Error('task status is invalid'), { statusCode: 422 });
    await this.runtime.updateTask(taskId, status, typeof input.assignedWorker === 'string' ? input.assignedWorker : undefined);
    return json(response, 200, { taskId, status });
  }

  private async claimOutbox(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const owner = requiredString(input.claimOwner, 'claimOwner');
    const limit = typeof input.limit === 'number' ? input.limit : 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error('limit is invalid'), { statusCode: 422 });
    const dispatches = await this.runtime.claimPendingDispatches(owner, limit);
    return json(response, 200, { dispatches });
  }

  private async publishOutbox(eventId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const claimOwner = typeof input.claimOwner === 'string' ? input.claimOwner : undefined;
    const published = await this.runtime.markOutboxPublished(eventId, claimOwner);
    return json(response, 200, { published });
  }

  private async releaseOutbox(eventId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const claimOwner = requiredString(input.claimOwner, 'claimOwner');
    const error = requiredString(input.error, 'error');
    const retryAt = requiredString(input.retryAt, 'retryAt');
    const released = await this.runtime.releaseOutbox(eventId, claimOwner, error, retryAt);
    return json(response, 200, { released });
  }

  private async ensureRun(caseId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const run = await this.runtime.ensureInvestigationRun(caseId, actor(request));
    return json(response, 201, { run });
  }

  private async appendMessage(caseId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const role = requiredString(input.role, 'role');
    if (!MESSAGE_ROLES.has(role)) throw Object.assign(new Error('role is invalid'), { statusCode: 422 });
    const messageId = await this.runtime.appendMessage(caseId, role as 'USER' | 'ASSISTANT' | 'SYSTEM' | 'WORKER',
      requiredString(input.content, 'content'), input.metadata && typeof input.metadata === 'object' ? input.metadata as Record<string, unknown> : {});
    return json(response, 201, { messageId });
  }

  private async transitionCase(caseId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const state = requiredString(input.state, 'state') as CaseState;
    if (!CASE_STATES.has(state)) throw Object.assign(new Error('state is invalid'), { statusCode: 422 });
    await this.runtime.transitionCase(caseId, state);
    return json(response, 200, { caseId, state });
  }

  private async getTask(taskId: string, response: ServerResponse): Promise<void> {
    const result = await this.pool.query('SELECT task_id,case_id,status,target,action,parameters,risk_level,requested_by,run_id,parent_task_id,created_at,started_at,completed_at,updated_at FROM runtime_tasks WHERE task_id=$1', [taskId]);
    if (!result.rows[0]) return json(response, 404, { error: 'task_not_found' });
    return json(response, 200, { task: result.rows[0] });
  }

  private async recordResult(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const result = input.result as GssResultContract | undefined;
    if (!result || result.schemaVersion !== RESULT_SCHEMA_VERSION || typeof result.taskId !== 'string' || typeof result.caseId !== 'string') {
      throw Object.assign(new Error('valid gss.result.v1 result is required'), { statusCode: 422 });
    }
    const observation = input.observation && typeof input.observation === 'object' ? input.observation as Parameters<PostgresRuntimeStore['recordResult']>[1] : undefined;
    const loop = input.loop && typeof input.loop === 'object' ? input.loop as Parameters<PostgresRuntimeStore['recordResult']>[2] : undefined;
    const stored = await this.runtime.recordResult(result, observation, loop);
    return json(response, 200, { accepted: true, replay: !stored, ...(stored ? { loop: stored } : {}) });
  }

  private async recordModelUsage(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request) as unknown as ModelUsageRecord;
    if (input.schemaVersion !== 'gss.model-usage.v1' || typeof input.usageId !== 'string' || typeof input.caseId !== 'string' || typeof input.model !== 'string') {
      throw Object.assign(new Error('valid gss.model-usage.v1 record is required'), { statusCode: 422 });
    }
    const result = await this.runtime.recordModelUsage(input);
    return json(response, result.created ? 201 : 200, result);
  }

  private async getFrontier(caseId: string, response: ServerResponse): Promise<void> {
    const result = await this.pool.query<{ run_id: string }>('SELECT run_id FROM investigation_runs WHERE case_id=$1 ORDER BY updated_at DESC LIMIT 1', [caseId]);
    const runId = result.rows[0]?.run_id;
    if (!runId) return json(response, 404, { error: 'frontier_not_found' });
    const [run, frontier] = await Promise.all([this.runtime.getInvestigationRun(runId), this.runtime.getEvidenceFrontier(runId)]);
    return json(response, 200, { run, frontier });
  }

  private async createApproval(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const approvalId = await this.investigations.createApproval({
      incidentId: requiredString(input.incidentId, 'incidentId'),
      action: requiredString(input.action, 'action') as 'CREATE_GITOPS_PR' | 'DEPLOY_CANARY' | 'ROLLBACK',
      artifactHash: requiredString(input.artifactHash, 'artifactHash'),
      parameters: (input.parameters ?? {}) as Record<string, unknown>,
      policyVersion: requiredString(input.policyVersion, 'policyVersion'),
      requestedBy: actor(request),
      expiresAt: new Date(requiredString(input.expiresAt, 'expiresAt')),
      payload: (input.payload ?? {}) as Record<string, unknown>,
    });
    return json(response, 201, { approvalId, status: 'PENDING' });
  }

  private async approve(approvalId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const result = await this.investigations.approve(approvalId, actor(request), requiredString(input.artifactHash, 'artifactHash'));
    const status = result.status === 'NOT_FOUND' ? 404 : result.status === 'ARTIFACT_MISMATCH' || result.status === 'REQUESTER_CANNOT_APPROVE' ? 403 : 200;
    return json(response, status, result as unknown as Record<string, unknown>);
  }

  private async audit(url: URL, response: ServerResponse): Promise<void> {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const result = await this.pool.query('SELECT id,event_type,severity,actor_id,target_resource,action_payload,incident_id,event_hash,created_at FROM audit_events ORDER BY created_at DESC LIMIT $1', [Number.isFinite(limit) && limit > 0 ? limit : 100]);
    return json(response, 200, { events: result.rows });
  }

  private async workers(response: ServerResponse): Promise<void> {
    const result = await this.pool.query("SELECT actor_id, max(created_at) AS last_seen, count(*)::int AS event_count FROM audit_events WHERE actor_id IN ('cli','ide','siem','cli-worker-agent','ide-worker-agent','siem-worker-agent') GROUP BY actor_id ORDER BY actor_id");
    return json(response, 200, { workers: result.rows });
  }
}
