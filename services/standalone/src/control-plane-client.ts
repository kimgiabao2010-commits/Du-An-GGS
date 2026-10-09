import type { ArtifactSignature, CaseState, GssResultContract, GssTaskContract, InvestigationRun, ModelUsageRecord, NextStepProposal, ObservationPack } from '@asq/sdk';
import type { ClaimedDispatch, InitialTaskDispatch, CommandIntake, WorkerConnectionInput, WorkerHeartbeatInput } from '@asq/persistence';
import type { TaskStatus } from '@asq/sdk';
import { withGssSpan, currentTraceparent, serviceFetch, validateServiceUrl } from '@asq/sdk';
import type { WorkerDeliveryInput, WorkerDeliveryRecord, ResultSubmission } from '@asq/sdk';
import type { ModelReservationInput, ModelReservationReceipt } from '@asq/sdk';
import type { WorkloadIdentity } from '@asq/sdk';

export interface TaskLinkage {
  runId?: string;
  parentTaskId?: string;
  actionFingerprint?: string;
}

export interface ControlPlaneTaskClient {
  checkWorkload?(peer:WorkloadIdentity):Promise<void>;
  registerWorker?(input:WorkerConnectionInput):Promise<void>;
  heartbeatWorker?(input:WorkerHeartbeatInput):Promise<void>;
  disconnectWorker?(input:WorkerConnectionInput):Promise<void>;
  workerReady?(workerId:string):Promise<boolean>;
  reserveModelCall?(input:ModelReservationInput):Promise<ModelReservationReceipt>;
  startModelCall?(reservationId:string,attemptId:string):Promise<{started:boolean}>;
  authorizeTask?(taskId: string): Promise<string>;
  runtimeState?(): Promise<{ halted: boolean }>;
  halt?(actor: string, reason: string): Promise<void>;
  receiveIntake?(input: CommandIntake): Promise<{ replay: boolean }>;
  claimIntakes?(owner: string): Promise<CommandIntake[]>;
  saveIntakeDecision?(id: string, owner: string, decision: Record<string, unknown>): Promise<void>;
  finishIntake?(id: string, owner: string, message?: string, state?: string): Promise<void>;
  releaseIntake?(id: string, owner: string): Promise<void>;
  acceptTask?(taskId: string, caseId: string, workerId: string, executionId: string, connectionId?: string): Promise<{ accepted: boolean; reason?: string }>;
  receiveWorkerDelivery?(input: WorkerDeliveryInput): Promise<WorkerDeliveryRecord>;
  pendingWorkerDeliveries?(): Promise<WorkerDeliveryRecord[]>;
  prepareWorkerDelivery?(deliveryId: string, submission: ResultSubmission): Promise<ResultSubmission>;
  deferWorkerDelivery?(deliveryId: string): Promise<void>;
  ready(): Promise<void>;
  ensureCase(caseId: string, actorId: string): Promise<void>;
  ensureInvestigationRun(caseId: string, requestedBy: string): Promise<InvestigationRun>;
  appendMessage(caseId: string, role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'WORKER', content: string, metadata?: Record<string, unknown>): Promise<string>;
  transitionCase(caseId: string, state: CaseState): Promise<void>;
  updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void>;
  claimPendingDispatches(claimOwner: string, limit?: number): Promise<ClaimedDispatch[]>;
  claimInitialDispatches(claimOwner: string, limit?: number): Promise<InitialTaskDispatch[]>;
  markOutboxPublished(eventId: string, claimOwner: string): Promise<boolean>;
  releaseOutbox(eventId: string, claimOwner: string, error: string, retryAt: string): Promise<boolean>;
  recordModelUsage(record: ModelUsageRecord): Promise<{ created: boolean }>;
  registerArtifact(input: { caseId: string; taskId: string; sha256: string; bytes: number; ref: string;
    storageProvider: 'filesystem' | 's3'; mediaType: string; retentionUntil?: string }): Promise<{ artifactId: string; created: boolean }>;
  signArtifact(input: { artifactHash: string; caseId: string; taskId: string; createdAt: string }): Promise<ArtifactSignature>;
  createTask(task: GssTaskContract, requestedBy: string, linkage?: TaskLinkage): Promise<{ created: boolean; task?: GssTaskContract }>;
  recordResult(result: GssResultContract, observation?: ObservationPack, loop?: {
    runId: string;
    source: string;
    artifactHash?: string;
    proposal: NextStepProposal;
  }, deliveryId?: string): Promise<{ replay: boolean; loop?: unknown }>;
}

export class HttpControlPlaneClient implements ControlPlaneTaskClient {
  public async checkWorkload(peer:WorkloadIdentity):Promise<void> {
    const result=await this.request('/control/v1/workload-certificates/check',{
      method:'POST',body:JSON.stringify({fingerprint:peer.fingerprint}),signal:AbortSignal.timeout(2000)},[200]);
    if(result.allowed!==true || !Number.isSafeInteger(result.revision) || Number(result.revision)<0)throw new Error('invalid_workload_revocation_receipt');
  }
  public async workerReady(workerId:string):Promise<boolean> {
    const result=await this.request('/control/v1/workers',{method:'GET'},[200]);
    return Array.isArray(result.workers) && result.workers.some(w=>w.workerId===workerId && w.presence==='ONLINE' && w.reportedReadiness==='READY');
  }
  public async registerWorker(input:WorkerConnectionInput):Promise<void> {
    await this.request('/control/v1/workers/connect',{method:'POST',body:JSON.stringify(input)},[200]);
  }
  public async heartbeatWorker(input:WorkerHeartbeatInput):Promise<void> {
    await this.request('/control/v1/workers/heartbeat',{method:'POST',body:JSON.stringify(input)},[200]);
  }
  public async disconnectWorker(input:WorkerConnectionInput):Promise<void> {
    await this.request('/control/v1/workers/disconnect',{method:'POST',body:JSON.stringify(input)},[200]);
  }
  public async reserveModelCall(input:ModelReservationInput):Promise<ModelReservationReceipt> {
    return await this.request('/control/v1/model-reservations',{method:'POST',body:JSON.stringify(input)},[200,201]) as unknown as ModelReservationReceipt;
  }
  public async startModelCall(reservationId:string,attemptId:string):Promise<{started:boolean}> {
    const response=await this.request('/control/v1/model-reservations/start',{method:'POST',body:JSON.stringify({reservationId,attemptId})},[200]);
    return {started:response.started===true};
  }
  public async authorizeTask(taskId: string): Promise<string> {
    const response = await this.request('/control/v1/tasks/authorize', { method:'POST',body:JSON.stringify({ taskId }) },[200]);
    return String(response.token);
  }
  public async runtimeState(): Promise<{ halted: boolean }> {
    return await this.request('/control/v1/runtime-state', { method: 'GET' }, [200]) as { halted: boolean };
  }
  public async halt(actor: string, reason: string): Promise<void> {
    await this.request('/control/v1/halt', { method: 'POST', headers: { 'x-gss-actor': actor }, body: JSON.stringify({ reason }) }, [200]);
  }
  public async receiveIntake(input: CommandIntake): Promise<{ replay: boolean }> {
    return await this.request('/control/v1/intakes', { method: 'POST', headers: { 'x-gss-actor': input.actorId }, body: JSON.stringify(input) }, [200,201]) as { replay: boolean };
  }
  public async claimIntakes(owner: string): Promise<CommandIntake[]> {
    const result = await this.request('/control/v1/intakes/claim', { method: 'POST', body: JSON.stringify({ claimOwner: owner }) }, [200]);
    return result.intakes as CommandIntake[];
  }
  public async saveIntakeDecision(id: string, owner: string, decision: Record<string, unknown>): Promise<void> {
    await this.request('/control/v1/intakes/decision', { method: 'POST', body: JSON.stringify({ commandId: id, claimOwner: owner, decision }) }, [200]);
  }
  public async finishIntake(id: string, owner: string, message?: string, state?: string): Promise<void> {
    await this.request('/control/v1/intakes/finish', { method: 'POST', body: JSON.stringify({ commandId: id, claimOwner: owner, message, state }) }, [200]);
  }
  public async releaseIntake(id: string, owner: string): Promise<void> {
    await this.request('/control/v1/intakes/release', { method: 'POST', body: JSON.stringify({ commandId: id, claimOwner: owner }) }, [200]);
  }
  public async acceptTask(taskId: string, caseId: string, workerId: string, executionId: string, connectionId?: string): Promise<{ accepted: boolean; reason?: string }> {
    return await this.request('/control/v1/tasks/accept', { method: 'POST', body: JSON.stringify({ taskId, caseId, workerId, executionId, connectionId }) }, [200]) as { accepted: boolean; reason?: string };
  }
  public async deferWorkerDelivery(deliveryId: string): Promise<void> {
    await this.request('/control/v1/worker-deliveries/retry', { method: 'POST', body: JSON.stringify({ deliveryId }) }, [200]);
  }
  public async receiveWorkerDelivery(input: WorkerDeliveryInput): Promise<WorkerDeliveryRecord> {
    const payload = await this.request('/control/v1/worker-deliveries', { method: 'POST', body: JSON.stringify(input) }, [200]);
    return payload.delivery as WorkerDeliveryRecord;
  }
  public async pendingWorkerDeliveries(): Promise<WorkerDeliveryRecord[]> {
    const payload = await this.request('/control/v1/worker-deliveries/pending', { method: 'GET' }, [200]);
    return payload.deliveries as WorkerDeliveryRecord[];
  }
  public async prepareWorkerDelivery(deliveryId: string, submission: ResultSubmission): Promise<ResultSubmission> {
    const payload = await this.request('/control/v1/worker-deliveries/prepare', {
      method: 'POST', body: JSON.stringify({ deliveryId, submission }),
    }, [200]);
    return payload.submission as ResultSubmission;
  }
  public constructor(private readonly baseUrl: string, private readonly token = process.env.GSS_CONTROL_PLANE_TOKEN?.trim()) {
    if (!token || token.length < 32) throw new Error('GSS_CONTROL_PLANE_TOKEN must contain at least 32 characters');
    validateServiceUrl(baseUrl);
  }

  public async ready(): Promise<void> {
    const response = await serviceFetch(`${this.baseUrl}/readyz`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Control Plane unavailable: HTTP ${response.status}`);
    const payload = await response.json() as { status?: string };
    if (payload.status !== 'ready') throw new Error('Control Plane is not ready');
  }

  private async request(path: string, init: RequestInit, expected: number[]): Promise<Record<string, unknown>> {
    return withGssSpan('gss.control.client', { 'http.request.method': init.method ?? 'GET' },
      () => this.tracedRequest(path, init, expected));
  }

  private async tracedRequest(path: string, init: RequestInit, expected: number[]): Promise<Record<string, unknown>> {
    const traceparent = currentTraceparent();
    const response = await serviceFetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}`, ...(init.headers ?? {}),
        ...(traceparent ? { traceparent } : {}) },
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!expected.includes(response.status)) {
      const message = typeof payload.error === 'string' ? payload.error : `Control Plane returned HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  public async ensureCase(caseId: string, actorId: string): Promise<void> {
    await this.request('/control/v1/cases', { method: 'POST', headers: { 'x-gss-actor': actorId }, body: JSON.stringify({ caseId }) }, [200, 201]);
  }

  public async ensureInvestigationRun(caseId: string, requestedBy: string): Promise<InvestigationRun> {
    const payload = await this.request(`/control/v1/cases/${encodeURIComponent(caseId)}/investigation-run`, {
      method: 'POST', headers: { 'x-gss-actor': requestedBy }, body: JSON.stringify({}),
    }, [200, 201]);
    if (!payload.run || typeof payload.run !== 'object') throw new Error('Control Plane returned no investigation run');
    return payload.run as InvestigationRun;
  }

  public async appendMessage(caseId: string, role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'WORKER', content: string, metadata: Record<string, unknown> = {}): Promise<string> {
    const payload = await this.request(`/control/v1/cases/${encodeURIComponent(caseId)}/messages`, {
      method: 'POST', headers: { 'x-gss-actor': role }, body: JSON.stringify({ role, content, metadata }),
    }, [200, 201]);
    if (typeof payload.messageId !== 'string') throw new Error('Control Plane returned no message id');
    return payload.messageId;
  }

  public async transitionCase(caseId: string, state: CaseState): Promise<void> {
    await this.request(`/control/v1/cases/${encodeURIComponent(caseId)}/state`, {
      method: 'POST', headers: { 'x-gss-actor': 'command-center' }, body: JSON.stringify({ state }),
    }, [200]);
  }

  public async updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void> {
    await this.request(`/control/v1/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'POST', headers: { 'x-gss-actor': 'command-center' }, body: JSON.stringify({ status, assignedWorker }),
    }, [200]);
  }

  public async claimPendingDispatches(claimOwner: string, limit = 25): Promise<ClaimedDispatch[]> {
    const payload = await this.request('/control/v1/outbox/claim', {
      method: 'POST', headers: { 'x-gss-actor': claimOwner }, body: JSON.stringify({ claimOwner, limit }),
    }, [200]);
    return Array.isArray(payload.dispatches) ? payload.dispatches as ClaimedDispatch[] : [];
  }

  public async claimInitialDispatches(claimOwner: string, limit = 25): Promise<InitialTaskDispatch[]> {
    const payload = await this.request('/control/v1/outbox/initial/claim', {
      method: 'POST', headers: { 'x-gss-actor': claimOwner }, body: JSON.stringify({ claimOwner, limit }),
    }, [200]);
    return Array.isArray(payload.dispatches) ? payload.dispatches as InitialTaskDispatch[] : [];
  }

  public async markOutboxPublished(eventId: string, claimOwner: string): Promise<boolean> {
    const payload = await this.request(`/control/v1/outbox/${encodeURIComponent(eventId)}/publish`, {
      method: 'POST', headers: { 'x-gss-actor': claimOwner }, body: JSON.stringify({ claimOwner }),
    }, [200]);
    return payload.published === true;
  }

  public async releaseOutbox(eventId: string, claimOwner: string, error: string, retryAt: string): Promise<boolean> {
    const payload = await this.request(`/control/v1/outbox/${encodeURIComponent(eventId)}/release`, {
      method: 'POST', headers: { 'x-gss-actor': claimOwner }, body: JSON.stringify({ claimOwner, error, retryAt }),
    }, [200]);
    return payload.released === true;
  }

  public async recordModelUsage(record: ModelUsageRecord): Promise<{ created: boolean }> {
    const payload = await this.request('/control/v1/model-usage', {
      method: 'POST', headers: { 'x-gss-actor': 'command-center' }, body: JSON.stringify(record),
    }, [200, 201]);
    return { created: payload.created === true };
  }

  public async signArtifact(input: { artifactHash: string; caseId: string; taskId: string; createdAt: string }): Promise<ArtifactSignature> {
    const payload = await this.request('/control/v1/artifacts/sign', {
      method: 'POST', headers: { 'x-gss-actor': 'command-center' }, body: JSON.stringify(input),
    }, [200]);
    if (!payload.signature || typeof payload.signature !== 'object') throw new Error('Control Plane returned no artifact signature');
    return payload.signature as unknown as ArtifactSignature;
  }

  public async registerArtifact(input: { caseId: string; taskId: string; sha256: string; bytes: number; ref: string;
    storageProvider: 'filesystem' | 's3'; mediaType: string; retentionUntil?: string }) {
    const payload = await this.request('/control/v1/artifacts/register', {
      method: 'POST', headers: { 'x-gss-actor': 'command-center' }, body: JSON.stringify(input),
    }, [200, 201]);
    if (typeof payload.artifactId !== 'string') throw new Error('Control Plane returned no artifact id');
    return { artifactId: payload.artifactId, created: payload.created === true };
  }

  public async createTask(task: GssTaskContract, requestedBy: string, linkage: TaskLinkage = {}) {
    const payload = await this.request('/control/v1/tasks', {
      method: 'POST',
      headers: { 'x-gss-actor': requestedBy, 'idempotency-key': task.idempotencyKey },
      body: JSON.stringify({ ...task, ...linkage }),
    }, [200, 201]);
    return { created: payload.replay !== true, task: payload.task as GssTaskContract | undefined };
  }

  public async recordResult(result: GssResultContract, observation?: ObservationPack, loop?: {
    runId: string;
    source: string;
    artifactHash?: string;
    proposal: NextStepProposal;
  }, deliveryId?: string) {
    const payload = await this.request('/control/v1/results', {
      method: 'POST',
      headers: { 'x-gss-actor': result.executor },
      body: JSON.stringify({ result, ...(observation ? { observation } : {}), ...(loop ? { loop } : {}), ...(deliveryId ? { deliveryId } : {}) }),
    }, [200]);
    return { replay: payload.replay === true, loop: payload.loop };
  }
}

export function controlPlaneClientFromEnvironment(): ControlPlaneTaskClient {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) throw new Error('CONTROL_PLANE_URL is required; direct persistence fallback is disabled');
  return new HttpControlPlaneClient(baseUrl.replace(/\/$/, ''));
}
