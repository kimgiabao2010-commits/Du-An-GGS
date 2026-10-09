import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createHash, createPrivateKey, randomUUID, timingSafeEqual, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import { OidcAuthority, authorizeOperator, type OperatorIdentity } from './identity.js';
import {
  RESULT_SCHEMA_VERSION,
  withGssSpan, currentTraceparent, validTraceparent, initializeTracing,
  signArtifact,
  sha256Canonical,
  TokenSigner,
  taskAuthorizationHash, signTaskAuthorization,
  serviceTlsOptions,
  WorkloadPeerPolicy,
  type ArtifactSignature,
  TASK_SCHEMA_VERSION,
  type CaseState,
  type ModelUsageRecord,
  type TaskStatus,
  type GssResultContract,
  type GssTaskContract,
  type CapabilityAction,
  type WorkerDeliveryInput, type ResultSubmission,
  type ModelReservationInput,
} from '@asq/sdk';
import { PostgresArtifactRegistry, PostgresInvestigationStore, PostgresRuntimeStore, PostgresWorkerDeliveryStore, PostgresControlStateStore, PostgresDispatchQueue, PostgresIdentityStore, PostgresModelBudgetStore, modelBudgetPolicyFromEnvironment, PostgresWorkerPresenceStore, PostgresWorkloadRevocationStore, type WorkloadRevocationInput, type WorkerConnectionInput, type WorkerHeartbeatInput } from '@asq/persistence';

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
const operatorIdentities = new WeakMap<IncomingMessage, OperatorIdentity>();

function json(response: ServerResponse, status: number, body: Json): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function actor(request: IncomingMessage): string {
  const identity = operatorIdentities.get(request);
  if (identity) return identity.issuer + '#' + identity.subject;
  return String(request.headers['x-gss-actor'] ?? 'control-api');
}

function authorized(request: IncomingMessage, expectedToken: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
  if (input.schemaVersion !== TASK_SCHEMA_VERSION || input.source !== 'standalone') {
    throw Object.assign(new Error('valid gss.task.v1 envelope is required'), { statusCode: 422 });
  }
  if (input.riskLevel !== 'read_only') throw Object.assign(new Error('only read-only tasks are allowed'), { statusCode: 403 });
  if (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters) ||
      !Array.isArray(input.contextRefs) || !input.contextRefs.every(item => typeof item === 'string') ||
      !Number.isSafeInteger(input.timeoutMs) || Number(input.timeoutMs) < 1_000 || Number(input.timeoutMs) > 120_000) {
    throw Object.assign(new Error('invalid parameters, contextRefs or timeoutMs'), { statusCode: 422 });
  }
  if (request.headers['idempotency-key'] && input.idempotencyKey !== request.headers['idempotency-key']) {
    throw Object.assign(new Error('idempotency header/body mismatch'), { statusCode: 422 });
  }
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
    ...(validTraceparent(input.traceparent) ? { traceparent: input.traceparent } : {}),
  };
}

export class ControlPlaneServer {
  private readonly server;
  private readonly pool: Pool;
  private readonly runtime: PostgresRuntimeStore;
  private readonly deliveries: PostgresWorkerDeliveryStore;
  private readonly controlState: PostgresControlStateStore;
  private readonly fleet: PostgresWorkerPresenceStore;
  private readonly queue: PostgresDispatchQueue;
  private readonly oidc?: OidcAuthority;
  private readonly identities: PostgresIdentityStore;
  private readonly modelBudget: PostgresModelBudgetStore;
  private readonly investigations: PostgresInvestigationStore;
  private readonly artifacts: PostgresArtifactRegistry;
  private readonly artifactSigningPrivateKey?: KeyObject;
  private readonly artifactSigningKeyId?: string;
  private readonly internalToken: string;
  private watchdog?: ReturnType<typeof setInterval>;
  private recoveringTimeouts = false;
  private readonly peerPolicy:WorkloadPeerPolicy;
  private readonly workloadRevocations:PostgresWorkloadRevocationStore;

  public constructor(private readonly port = Number(process.env.CONTROL_PLANE_PORT ?? 4100)) {
    initializeTracing();
    this.peerPolicy=new WorkloadPeerPolicy();
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the Control Plane');
    this.internalToken = process.env.GSS_CONTROL_PLANE_TOKEN?.trim() ?? '';
    if (this.internalToken.length < 32) throw new Error('GSS_CONTROL_PLANE_TOKEN must contain at least 32 characters');
    this.pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000, query_timeout: 5_000,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
    this.runtime = new PostgresRuntimeStore(this.pool);
    this.deliveries = new PostgresWorkerDeliveryStore(this.pool);
    this.controlState = new PostgresControlStateStore(this.pool);
    this.fleet = new PostgresWorkerPresenceStore(this.pool);
    this.queue = new PostgresDispatchQueue(this.pool);
    this.identities = new PostgresIdentityStore(this.pool);
    this.workloadRevocations=new PostgresWorkloadRevocationStore(this.pool);
    this.modelBudget = new PostgresModelBudgetStore(this.pool,modelBudgetPolicyFromEnvironment());
    if (process.env.GSS_OIDC_ISSUER || process.env.GSS_RUNTIME_ENV === 'staging') this.oidc = new OidcAuthority(this.pool);
    this.investigations = new PostgresInvestigationStore(this.pool);
    this.artifacts = new PostgresArtifactRegistry(this.pool);
    const encodedSigningKey = process.env.GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64?.trim();
    this.artifactSigningPrivateKey = encodedSigningKey
      ? createPrivateKey(Buffer.from(encodedSigningKey, 'base64').toString('utf8')) : undefined;
    this.artifactSigningKeyId = process.env.GSS_ARTIFACT_SIGNING_KEY_ID?.trim() || undefined;
    if (process.env.GSS_REQUIRE_ARTIFACT_SIGNATURE === 'true' &&
      (!this.artifactSigningPrivateKey || !this.artifactSigningKeyId)) {
      throw new Error('artifact signatures are required but the Control Plane signing key is not configured');
    }
    const tls = serviceTlsOptions();
    if(this.peerPolicy.enabled && !tls)throw new Error('Workload binding requires mTLS');
    const handler = (request: IncomingMessage,response: ServerResponse) => { void this.handle(request,response); };
    this.server = tls ? createSecureServer({...tls,requestCert:true,rejectUnauthorized:true,handshakeTimeout:5000},handler) : createServer(handler);
    this.server.requestTimeout = 15000;
    this.server.headersTimeout = 10000;
  }

  public async ready(): Promise<number> {
    await this.runtime.ready();
    await this.queue.start();
    this.watchdog = setInterval(() => {
      if (this.recoveringTimeouts) return;
      this.recoveringTimeouts = true;
      void this.controlState.recoverExpiredExecutions().catch(() => {
        console.error('[ControlPlane] Execution watchdog failed safely');
      }).finally(() => { this.recoveringTimeouts = false; });
    }, 1000);
    this.watchdog.unref?.();
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Control Plane did not bind a TCP port');
    return address.port;
  }

  public async close(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    await this.queue.close();
    await this.pool.end();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    return withGssSpan('gss.control.handle', { 'http.request.method': request.method ?? 'GET' },
      () => this.handleRequest(request, response), request.headers.traceparent);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    try {
      const peer=this.peerPolicy.authenticate(request.socket);
      if(peer && !['command-center','ui-gateway'].includes(peer.workloadId))return json(response,403,{error:'control_peer_workload_denied'});
      if(peer)await this.workloadRevocations.check(peer.fingerprint);
      if(peer && url.pathname.startsWith('/control/')) {
        const service=authorized(request,this.internalToken);
        if((service && peer.workloadId!=='command-center') || (!service && peer.workloadId!=='ui-gateway')) {
          return json(response,403,{error:'credential_certificate_identity_mismatch'});
        }
      }
      if (method === 'GET' && url.pathname === '/livez') return json(response, 200, { status: 'ok' });
      if (method === 'GET' && url.pathname === '/readyz') {
        try { await this.runtime.ready(); }
        catch { return json(response, 503, { status: 'not_ready', error: 'storage_unavailable' }); }
        return json(response, 200, {
          status: 'ready', storage: 'postgresql',
          artifactSigning: this.artifactSigningPrivateKey && this.artifactSigningKeyId ? 'configured' : 'unsigned_local',
        });
      }
      if (url.pathname.startsWith('/control/') && !authorized(request, this.internalToken)) {
        let identity: OperatorIdentity;
        const gateway = process.env.GSS_UI_GATEWAY_TOKEN;
        if (process.env.GSS_RUNTIME_ENV !== 'staging' && process.env.ASQ_LOCAL_RUNTIME === 'true' && gateway && gateway.length>=32 && authorized(request, gateway)) {
          const session = new TokenSigner().verify(String(request.headers['x-gss-session'] ?? ''));
          if (!session || !['SOC_ANALYST','SOC_LEAD','CONTROL_OPERATOR','SECURITY_ADMIN','AUDITOR'].includes(session.role)) return json(response, 401, { error: 'invalid_local_session' });
          identity = { issuer: 'gss-local-demo', subject: session.agentId, issuedAt: session.timestamp/1000, role: session.role as OperatorIdentity['role'] };
        } else {
          if (!this.oidc) return json(response, 401, { error: 'unauthorized' });
          identity = await this.oidc.authenticate(request);
        }
        operatorIdentities.set(request, identity);
        authorizeOperator(identity, method, url.pathname);
      }
      if (process.env.GSS_RUNTIME_ENV === 'staging' && url.pathname.includes('/approvals') && !operatorIdentities.has(request)) {
        return json(response, 403, { error: 'approval_requires_oidc_operator' });
      }
      if (method === 'POST' && url.pathname === '/control/v1/identity/revoke') {
        const identity = operatorIdentities.get(request);
        if (identity?.role !== 'SECURITY_ADMIN') return json(response, 403, { error: 'security_admin_required' });
        const input = await body(request);
        await this.identities.revoke(identity.issuer, requiredString(input.subject,'subject'), actor(request));
        return json(response, 200, { revoked: true });
      }
      if(method==='POST' && url.pathname==='/control/v1/workload-certificates/check') {
        if(!authorized(request,this.internalToken))return json(response,403,{error:'service_authority_required'});
        const input=await body(request);
        return json(response,200,await this.workloadRevocations.check(requiredString(input.fingerprint,'fingerprint')));
      }
      if(method==='POST' && url.pathname==='/control/v1/workload-certificates/revocations') {
        const identity=operatorIdentities.get(request);
        if(identity?.role!=='SECURITY_ADMIN')return json(response,403,{error:'security_admin_required'});
        const input=await body(request);
        if(request.headers['idempotency-key'] && input.idempotencyKey!==request.headers['idempotency-key']) {
          return json(response,422,{error:'idempotency_header_body_mismatch'});
        }
        const receipt=await this.workloadRevocations.revoke(input as unknown as WorkloadRevocationInput,actor(request));
        return json(response,receipt.replay?200:201,receipt as unknown as Record<string,unknown>);
      }
      if(method==='GET' && url.pathname==='/control/v1/workload-certificates/revocations') {
        const identity=operatorIdentities.get(request);
        if(identity && !['SECURITY_ADMIN','AUDITOR'].includes(identity.role))return json(response,403,{error:'role_denied'});
        return json(response,200,{schemaVersion:'gss.workload-revocation-list.v1',revocations:await this.workloadRevocations.list()});
      }
      const accessMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/access$/);
      if (method === 'POST' && accessMatch) {
        const identity = operatorIdentities.get(request);
        if (identity?.role !== 'SECURITY_ADMIN') return json(response, 403, { error: 'security_admin_required' });
        const input = await body(request);
        const receipt = await this.identities.grantCase(decodeURIComponent(accessMatch[1]), identity.issuer,
          requiredString(input.subject,'subject'), actor(request));
        return json(response, 200, { granted: true, ...receipt });
      }
      const casePath = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\//);
      if (casePath) await this.checkCase(request, decodeURIComponent(casePath[1]));
      if(method==='GET' && casePath && url.pathname.endsWith('/model-budget')) {
        return json(response,200,await this.modelBudget.status(decodeURIComponent(casePath[1])));
      }
      if (method === 'GET' && url.pathname === '/control/v1/approvals') {
        const identity = operatorIdentities.get(request);
        const rows = await this.pool.query(`SELECT a.approval_id,a.incident_id,a.action,a.artifact_hash,a.requested_by,a.expires_at,
          CASE WHEN a.expires_at<=now() THEN 'EXPIRED' ELSE a.status END AS status,a.policy_version,a.canonical_parameters,
          (SELECT count(*)::int FROM approval_approvals v WHERE v.approval_id=a.approval_id) AS approval_count
          FROM approval_requests a WHERE ($1::text IS NULL OR EXISTS(SELECT 1 FROM case_access c WHERE c.case_id=a.incident_id AND c.issuer=$1 AND c.subject=$2))
          ORDER BY a.created_at DESC LIMIT 100`, [identity && identity.role !== 'SECURITY_ADMIN' ? identity.issuer : null, identity?.subject ?? null]);
        return json(response, 200, { approvals: rows.rows });
      }
      if (method === 'GET' && url.pathname === '/control/v1/runtime-state') return json(response, 200, await this.controlState.state());
      if (method === 'POST' && url.pathname === '/control/v1/halt') {
        const input = await body(request);
        await this.controlState.halt(actor(request), requiredString(input.reason, 'reason'));
        return json(response, 200, { halted: true });
      }
      if (method === 'POST' && url.pathname === '/control/v1/intakes') {
        const input = await body(request);
        const intake = { commandId: requiredString(input.commandId, 'commandId'), caseId: requiredString(input.caseId, 'caseId'),
          content: requiredString(input.content, 'content'), actorId: actor(request) };
        await this.checkCase(request, intake.caseId);
        const result = await this.controlState.receive(intake);
        return json(response, result.replay ? 200 : 201, result);
      }
      if (method === 'POST' && url.pathname.startsWith('/control/v1/intakes/')) {
        const input = await body(request);
        const owner = requiredString(input.claimOwner, 'claimOwner');
        if (url.pathname.endsWith('/claim')) return json(response, 200, { intakes: await this.controlState.claim(owner) });
        const id = requiredString(input.commandId, 'commandId');
        if (url.pathname.endsWith('/decision')) await this.controlState.saveDecision(id, owner, input.decision as Record<string, unknown>);
        else if (url.pathname.endsWith('/finish')) await this.controlState.finish(id, owner,
          typeof input.message === 'string' ? input.message : undefined, typeof input.state === 'string' ? input.state : undefined);
        else if (url.pathname.endsWith('/release')) await this.controlState.release(id, owner);
        else return json(response, 404, { error: 'not_found' });
        return json(response, 200, { accepted: true });
      }
      if (method === 'POST' && url.pathname === '/control/v1/tasks/accept') {
        const input = await body(request);
        return json(response, 200, await this.controlState.acceptTask(requiredString(input.taskId, 'taskId'),
          requiredString(input.caseId, 'caseId'), requiredString(input.workerId, 'workerId'), requiredString(input.executionId, 'executionId'),
          typeof input.connectionId==='string' ? input.connectionId : undefined));
      }
      if (method === 'POST' && url.pathname.startsWith('/control/v1/workers/')) {
        const input=await body(request);
        if (url.pathname==='/control/v1/workers/connect') return json(response,200,await this.fleet.register(input as unknown as WorkerConnectionInput));
        if (url.pathname==='/control/v1/workers/heartbeat') return json(response,200,await this.fleet.heartbeat(input as unknown as WorkerHeartbeatInput));
        if (url.pathname==='/control/v1/workers/disconnect') return json(response,200,await this.fleet.disconnect(input as unknown as WorkerConnectionInput));
        return json(response,404,{error:'not_found'});
      }
      if (method === 'POST' && url.pathname === '/control/v1/tasks/authorize') {
        const key = process.env.GSS_TASK_PRIVATE_KEY_BASE64, keyId = process.env.GSS_TASK_KEY_ID;
        if (!key || !keyId) return json(response, 503, { error: 'task_signing_not_configured' });
        if ((await this.controlState.state()).halted) return json(response, 503, { error: 'control_halted' });
        const input = await body(request);
        const t = (await this.pool.query('SELECT * FROM runtime_tasks WHERE task_id=$1',[requiredString(input.taskId,'taskId')])).rows[0];
        if (!t || t.risk_level !== 'read_only' || !['QUEUED','BLOCKED','DISPATCHED','RUNNING'].includes(t.status)) return json(response,403,{ error:'task_authorization_denied' });
        const instruction = ({ inspect_hostname:'hostname',inspect_system:'systeminfo',inspect_network_config:'ipconfig /all',inspect_network_connections:'netstat -ano' } as Record<string,string>)[t.action];
        const taskHash = taskAuthorizationHash({ taskId:t.task_id,caseId:t.case_id,target:t.target,action:t.action,parameters:t.parameters,contextRefs:t.context_refs });
        const now = Date.now();
        const signed = signTaskAuthorization({ agentId:t.target+'-worker-agent',role:'STANDALONE',permissions:['EXECUTE_READ_ONLY',...(t.target==='cli'?['EXECUTE_RECON']:[])],
          timestamp:now,expiresAt:now+60000,taskId:t.task_id,incidentId:t.case_id,taskHash,
          ...(instruction?{ instructionHash:createHash('sha256').update(instruction).digest('hex') }: {}) },Buffer.from(key,'base64').toString('utf8'),keyId);
        return json(response,200,{ token:signed });
      }
      if (method === 'POST' && url.pathname === '/control/v1/cases') return await this.createCase(request, response);
      const runMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/investigation-run$/);
      if (method === 'POST' && runMatch) return await this.ensureRun(decodeURIComponent(runMatch[1]), request, response);
      const messageMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/messages$/);
      if (method === 'POST' && messageMatch) return await this.appendMessage(decodeURIComponent(messageMatch[1]), request, response);
      const stateMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/state$/);
      if (method === 'POST' && stateMatch) return await this.transitionCase(decodeURIComponent(stateMatch[1]), request, response);
      if (method === 'POST' && url.pathname === '/control/v1/tasks') return await this.createTask(request, response);
      const taskStatusMatch = url.pathname.match(/^\/control\/v1\/tasks\/([^/]+)\/status$/);
      if (method === 'POST' && taskStatusMatch) return await this.updateTaskStatus(decodeURIComponent(taskStatusMatch[1]), request, response);
      if (method === 'POST' && url.pathname === '/control/v1/outbox/claim') return await this.claimOutbox(request, response);
      if (method === 'POST' && url.pathname === '/control/v1/worker-deliveries') {
        const input = await body(request);
        return json(response, 200, { delivery: await this.deliveries.receive(input as unknown as WorkerDeliveryInput) });
      }
      if (method === 'GET' && url.pathname === '/control/v1/worker-deliveries/pending') {
        return json(response, 200, { deliveries: await this.deliveries.pending() });
      }
      if (method === 'POST' && url.pathname === '/control/v1/worker-deliveries/prepare') {
        const input = await body(request);
        if (!input.submission || typeof input.submission !== 'object' || !(input.submission as ResultSubmission).result) {
          throw Object.assign(new Error('result submission is required'), { statusCode: 422 });
        }
        return json(response, 200, { submission: await this.deliveries.prepare(requiredString(input.deliveryId, 'deliveryId'),
          this.validateResultSubmission(input.submission as Record<string, unknown>)) });
      }
      if (method === 'POST' && url.pathname === '/control/v1/worker-deliveries/retry') {
        const input = await body(request);
        await this.deliveries.defer(requiredString(input.deliveryId, 'deliveryId'));
        return json(response, 200, { retained: true });
      }
      if (method === 'POST' && url.pathname === '/control/v1/outbox/initial/claim') return await this.claimOutbox(request, response, true);
      const publishMatch = url.pathname.match(/^\/control\/v1\/outbox\/([^/]+)\/publish$/);
      if (method === 'POST' && publishMatch) return await this.publishOutbox(decodeURIComponent(publishMatch[1]), request, response);
      const releaseMatch = url.pathname.match(/^\/control\/v1\/outbox\/([^/]+)\/release$/);
      if (method === 'POST' && releaseMatch) return await this.releaseOutbox(decodeURIComponent(releaseMatch[1]), request, response);
      if (method === 'GET' && /^\/control\/v1\/tasks\/[^/]+$/.test(url.pathname)) return await this.getTask(url.pathname.split('/').pop()!, response, request);
      if (method === 'POST' && url.pathname === '/control/v1/results') return await this.recordResult(request, response);
      if (method === 'POST' && url.pathname === '/control/v1/artifacts/register') return await this.registerArtifact(request, response);
      if (method === 'POST' && url.pathname === '/control/v1/artifacts/sign') return await this.signStoredArtifact(request, response);
      if (method === 'POST' && url.pathname === '/control/v1/model-reservations') {
        const input=await body(request) as unknown as ModelReservationInput;
        const receipt=await this.modelBudget.reserve(input);
        return json(response,receipt.enabled && !receipt.replay?201:200,receipt);
      }
      if (method === 'POST' && url.pathname === '/control/v1/model-reservations/start') {
        const input=await body(request);
        return json(response,200,await this.modelBudget.start(requiredString(input.reservationId,'reservationId'),requiredString(input.attemptId,'attemptId')));
      }
      if (method === 'POST' && url.pathname === '/control/v1/model-usage') return await this.recordModelUsage(request, response);
      const frontierMatch = url.pathname.match(/^\/control\/v1\/cases\/([^/]+)\/frontier$/);
      if (method === 'GET' && frontierMatch) return await this.getFrontier(decodeURIComponent(frontierMatch[1]), response);
      if (method === 'POST' && url.pathname === '/control/v1/approvals') return await this.createApproval(request, response);
      const approvalMatch = url.pathname.match(/^\/control\/v1\/approvals\/([^/]+)\/decision$/);
      if (method === 'POST' && approvalMatch) return await this.approve(decodeURIComponent(approvalMatch[1]), request, response);
      if (method === 'GET' && url.pathname === '/control/v1/audit') return await this.audit(url, response, request);
      if (method === 'GET' && url.pathname === '/control/v1/workers') return await this.workers(response);
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
      parameters: task.parameters, contextRefs: task.contextRefs, timeoutMs: task.timeoutMs,
      runId: input.runId ?? null, parentTaskId: input.parentTaskId ?? null });
    const existing = await this.pool.query<{ task_id: string; action_fingerprint: string | null }>(
      'SELECT task_id,action_fingerprint FROM runtime_tasks WHERE idempotency_key=$1', [task.idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].action_fingerprint !== actionFingerprint) {
        return json(response, 409, { error: 'idempotency_key_payload_mismatch', taskId: existing.rows[0].task_id });
      }
      return json(response, 200, { taskId: existing.rows[0].task_id, replay: true });
    }
    const result = await this.runtime.createTask(task, actor(request), {
      runId: typeof input.runId === 'string' ? input.runId : undefined,
      parentTaskId: typeof input.parentTaskId === 'string' ? input.parentTaskId : undefined,
      actionFingerprint,
    });
    if (!result.created) {
      const persisted = await this.pool.query('SELECT task_id FROM runtime_tasks WHERE idempotency_key=$1', [task.idempotencyKey]);
      return json(response, 200, { taskId: persisted.rows[0].task_id, replay: true });
    }
    return json(response, 201, { task, replay: false });
  }

  private async createCase(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const caseId = requiredString(input.caseId, 'caseId');
    await this.runtime.ensureCase(caseId, actor(request));
    const identity = operatorIdentities.get(request);
    if (identity) {
      // A caller cannot seize an existing case by replaying createCase.
      const owned = await this.pool.query('SELECT 1 FROM cases WHERE case_id=$1 AND created_by=$2', [caseId, actor(request)]);
      if (!owned.rows[0] && identity.role !== 'SECURITY_ADMIN') return json(response, 403, { error: 'incident_access_denied' });
      await this.pool.query('INSERT INTO case_access(case_id,issuer,subject,granted_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [caseId, identity.issuer, identity.subject, actor(request)]);
    }
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

  private async claimOutbox(request: IncomingMessage, response: ServerResponse, initial = false): Promise<void> {
    const input = await body(request);
    const owner = requiredString(input.claimOwner, 'claimOwner');
    const limit = typeof input.limit === 'number' ? input.limit : 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error('limit is invalid'), { statusCode: 422 });
    const acquired = await this.queue.acquire(initial ? 'initial' : 'decision', limit);
    const dispatches = initial ? await this.runtime.claimInitialDispatches(owner, limit, acquired.eventIds) :
      await this.runtime.claimPendingDispatches(owner, limit, acquired.eventIds);
    await acquired.settle(dispatches.map(d => 'eventId' in d ? d.eventId : d.loop.outbox.eventId));
    return json(response, 200, { dispatches });
  }

  private async publishOutbox(eventId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const claimOwner = requiredString(input.claimOwner, 'claimOwner');
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
    const run = await this.runtime.ensureInvestigationRun(caseId, actor(request), currentTraceparent());
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

  private async getTask(taskId: string, response: ServerResponse, request: IncomingMessage): Promise<void> {
    const result = await this.pool.query('SELECT task_id,case_id,status,target,action,parameters,risk_level,requested_by,run_id,parent_task_id,created_at,started_at,completed_at,updated_at FROM runtime_tasks WHERE task_id=$1', [taskId]);
    if (!result.rows[0]) return json(response, 404, { error: 'task_not_found' });
    await this.checkCase(request, result.rows[0].case_id);
    return json(response, 200, { task: result.rows[0] });
  }

  private validateResultSubmission(input: Record<string, unknown>): ResultSubmission {
    const result = input.result as GssResultContract | undefined;
    if (!result || result.schemaVersion !== RESULT_SCHEMA_VERSION || typeof result.taskId !== 'string' || typeof result.caseId !== 'string') {
      throw Object.assign(new Error('valid gss.result.v1 result is required'), { statusCode: 422 });
    }
    const observation = input.observation && typeof input.observation === 'object' ? input.observation as Parameters<PostgresRuntimeStore['recordResult']>[1] : undefined;
    const loop = input.loop && typeof input.loop === 'object' ? input.loop as Parameters<PostgresRuntimeStore['recordResult']>[2] : undefined;
    if (!['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(result.status) ||
        !['cli', 'ide', 'siem'].includes(result.executor) || !result.result || Array.isArray(result.result) ||
        typeof result.result !== 'object' || !Array.isArray(result.evidenceRefs) ||
        !result.evidenceRefs.every(ref => typeof ref === 'string') || !Array.isArray(result.errors) ||
        !result.metrics || !Number.isFinite(result.metrics.durationMs) || result.metrics.durationMs < 0 ||
        typeof result.completedAt !== 'string' || Number.isNaN(Date.parse(result.completedAt))) {
      throw Object.assign(new Error('invalid result contract'), { statusCode: 422 });
    }
    if (observation && (observation.taskId !== result.taskId || observation.caseId !== result.caseId ||
        !Array.isArray(observation.facts) || !Array.isArray(observation.evidenceRefs) ||
        result.status !== 'COMPLETED')) throw Object.assign(new Error('invalid observation provenance'), { statusCode: 422 });
    if (result.status !== 'COMPLETED' && (result.evidenceRefs.length || loop || result.result.evidence || result.result.verdict)) {
      throw Object.assign(new Error('failed result cannot create evidence'), { statusCode: 422 });
    }
    if (loop && !observation) throw Object.assign(new Error('loop requires observation'), { statusCode: 422 });
    if (observation && (typeof observation.observationId !== 'string' || !observation.observationId ||
        typeof observation.summary !== 'string' || typeof observation.createdAt !== 'string' ||
        Number.isNaN(Date.parse(observation.createdAt)) ||
        !Number.isSafeInteger(observation.originalBytes) || observation.originalBytes < 0 ||
        !Number.isSafeInteger(observation.packedBytes) || observation.packedBytes < 0 ||
        !observation.facts.every(fact => fact && typeof fact.key === 'string' && typeof fact.value === 'string') ||
        !observation.evidenceRefs.every(ref => typeof ref === 'string' && result.evidenceRefs.includes(ref)))) {
      throw Object.assign(new Error('invalid observation contract'), { statusCode: 422 });
    }
    if (loop && (typeof loop.runId !== 'string' || loop.source !== result.executor || !loop.proposal ||
        !['DISPATCH', 'WAIT_APPROVAL', 'FINALIZE', 'BLOCKED'].includes(loop.proposal.kind) ||
        typeof loop.proposal.reasonCode !== 'string' || typeof loop.proposal.rationale !== 'string' ||
        (loop.artifactHash && !/^[a-f0-9]{64}$/.test(loop.artifactHash)))) {
      throw Object.assign(new Error('invalid loop contract'), { statusCode: 422 });
    }
    return { result, ...(observation ? { observation } : {}), ...(loop ? { loop } : {}) };
  }

  private async recordResult(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const { result, observation, loop } = this.validateResultSubmission(input);
    const stored = await this.runtime.recordResultReceipt(result, observation, loop,
      typeof input.deliveryId === 'string' ? input.deliveryId : undefined);
    return json(response, 200, { accepted: true, ...stored });
  }

  private async signStoredArtifact(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.artifactSigningPrivateKey || !this.artifactSigningKeyId) {
      return json(response, 503, { error: 'artifact_signing_not_configured' });
    }
    const input = await body(request);
    const artifactHash = requiredString(input.artifactHash, 'artifactHash').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(artifactHash)) {
      throw Object.assign(new Error('artifactHash must be SHA-256'), { statusCode: 422 });
    }
    const caseId = requiredString(input.caseId, 'caseId');
    const taskId = requiredString(input.taskId, 'taskId');
    const createdAt = requiredString(input.createdAt, 'createdAt');
    if (Number.isNaN(Date.parse(createdAt))) {
      throw Object.assign(new Error('createdAt must be an ISO timestamp'), { statusCode: 422 });
    }
    const task = await this.pool.query('SELECT 1 FROM runtime_tasks WHERE task_id=$1 AND case_id=$2', [taskId, caseId]);
    if (!task.rows[0]) return json(response, 404, { error: 'task_not_found' });
    if (!await this.artifacts.exists(caseId, taskId, artifactHash)) return json(response, 404, { error: 'artifact_not_registered' });
    const signature: ArtifactSignature = signArtifact({
      artifactHash, caseId, taskId, keyId: this.artifactSigningKeyId, createdAt,
    }, this.artifactSigningPrivateKey);
    return json(response, 200, { signature });
  }

  private async registerArtifact(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = await body(request);
    const caseId = requiredString(input.caseId, 'caseId');
    const taskId = requiredString(input.taskId, 'taskId');
    const sha256 = requiredString(input.sha256, 'sha256').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw Object.assign(new Error('sha256 must be a SHA-256 hex digest'), { statusCode: 422 });
    const bytes = input.bytes;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw Object.assign(new Error('bytes must be a non-negative integer'), { statusCode: 422 });
    }
    const storageProvider = requiredString(input.storageProvider, 'storageProvider');
    if (!['filesystem', 's3'].includes(storageProvider)) throw Object.assign(new Error('storageProvider is invalid'), { statusCode: 422 });
    const retentionUntil = typeof input.retentionUntil === 'string' ? input.retentionUntil : undefined;
    if (retentionUntil && Number.isNaN(Date.parse(retentionUntil))) {
      throw Object.assign(new Error('retentionUntil must be an ISO timestamp'), { statusCode: 422 });
    }
    const task = await this.pool.query('SELECT 1 FROM runtime_tasks WHERE task_id=$1 AND case_id=$2', [taskId, caseId]);
    if (!task.rows[0]) return json(response, 404, { error: 'task_not_found' });
    let result: { artifactId: string; created: boolean };
    try {
      result = await this.artifacts.register({
        caseId, taskId, sha256, bytes,
        ref: requiredString(input.ref, 'ref'),
        storageProvider: storageProvider as 'filesystem' | 's3',
        mediaType: requiredString(input.mediaType, 'mediaType'),
        ...(retentionUntil ? { retentionUntil } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('conflicts with immutable metadata')) {
        throw Object.assign(error, { statusCode: 409 });
      }
      throw error;
    }
    return json(response, result.created ? 201 : 200, result);
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
    await this.checkCase(request, requiredString(input.incidentId, 'incidentId'));
    if (input.action !== 'CREATE_GITOPS_PR') throw Object.assign(new Error('Only proposal approval is enabled; deployment and rollback are disabled'), { statusCode: 403 });
    const provenance = await this.pool.query('SELECT 1 FROM artifact_registry WHERE case_id=$1 AND sha256=$2', [input.incidentId, input.artifactHash]);
    if (!provenance.rows[0]) throw Object.assign(new Error('approval artifact provenance missing'), { statusCode: 422 });
    if (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters)) throw Object.assign(new Error('canonical parameters required'), { statusCode: 422 });
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
    const approval = (await this.pool.query('SELECT incident_id FROM approval_requests WHERE approval_id=$1', [approvalId])).rows[0];
    if (approval) await this.checkCase(request, approval.incident_id);
    const result = await this.investigations.approve(approvalId, actor(request), requiredString(input.artifactHash, 'artifactHash'));
    const status = result.status === 'NOT_FOUND' ? 404 : result.status === 'ARTIFACT_MISMATCH' || result.status === 'REQUESTER_CANNOT_APPROVE' ? 403 : 200;
    return json(response, status, result as unknown as Record<string, unknown>);
  }

  private async audit(url: URL, response: ServerResponse, request: IncomingMessage): Promise<void> {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const identity = operatorIdentities.get(request);
    const result = await this.pool.query(`SELECT id,event_type,severity,actor_id,target_resource,action_payload,incident_id,event_hash,created_at FROM audit_events a
      WHERE ($2::text IS NULL OR EXISTS(SELECT 1 FROM case_access c WHERE c.case_id=a.incident_id AND c.issuer=$2 AND c.subject=$3))
      ORDER BY created_at DESC LIMIT $1`, [Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100,
        identity && identity.role !== 'SECURITY_ADMIN' ? identity.issuer : null, identity?.subject ?? null]);
    return json(response, 200, { events: result.rows });
  }

  private async workers(response: ServerResponse): Promise<void> {
    return json(response, 200, { schemaVersion:'gss.worker-presence.v1', workers: await this.fleet.list() });
  }
  private async checkCase(request: IncomingMessage, caseId: string): Promise<void> {
    const identity = operatorIdentities.get(request);
    if (!identity || identity.role === 'SECURITY_ADMIN') return;
    const allowed = await this.pool.query('SELECT 1 FROM case_access WHERE case_id=$1 AND issuer=$2 AND subject=$3', [caseId,identity.issuer,identity.subject]);
    if (!allowed.rows[0]) throw Object.assign(new Error('incident_access_denied'), { statusCode: 403 });
  }
}
