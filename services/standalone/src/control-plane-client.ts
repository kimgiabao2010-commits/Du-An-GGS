import type { ArtifactSignature, CaseState, GssResultContract, GssTaskContract, InvestigationRun, ModelUsageRecord, NextStepProposal, ObservationPack } from '@asq/sdk';
import type { ClaimedDispatch } from '@asq/persistence';
import type { TaskStatus } from '@asq/sdk';

export interface TaskLinkage {
  runId?: string;
  parentTaskId?: string;
  actionFingerprint?: string;
}

export interface ControlPlaneTaskClient {
  ensureCase(caseId: string, actorId: string): Promise<void>;
  ensureInvestigationRun(caseId: string, requestedBy: string): Promise<InvestigationRun>;
  appendMessage(caseId: string, role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'WORKER', content: string, metadata?: Record<string, unknown>): Promise<string>;
  transitionCase(caseId: string, state: CaseState): Promise<void>;
  updateTask(taskId: string, status: TaskStatus, assignedWorker?: string): Promise<void>;
  claimPendingDispatches(claimOwner: string, limit?: number): Promise<ClaimedDispatch[]>;
  markOutboxPublished(eventId: string, claimOwner?: string): Promise<boolean>;
  releaseOutbox(eventId: string, claimOwner: string, error: string, retryAt: string): Promise<boolean>;
  recordModelUsage(record: ModelUsageRecord): Promise<{ created: boolean }>;
  signArtifact(input: { artifactHash: string; caseId: string; taskId: string; createdAt: string }): Promise<ArtifactSignature>;
  createTask(task: GssTaskContract, requestedBy: string, linkage?: TaskLinkage): Promise<{ created: boolean; task?: GssTaskContract }>;
  recordResult(result: GssResultContract, observation?: ObservationPack, loop?: {
    runId: string;
    source: string;
    artifactHash?: string;
    proposal: NextStepProposal;
  }): Promise<{ replay: boolean; loop?: unknown }>;
}

export class HttpControlPlaneClient implements ControlPlaneTaskClient {
  public constructor(private readonly baseUrl: string) {}

  private async request(path: string, init: RequestInit, expected: number[]): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
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

  public async markOutboxPublished(eventId: string, claimOwner?: string): Promise<boolean> {
    const payload = await this.request(`/control/v1/outbox/${encodeURIComponent(eventId)}/publish`, {
      method: 'POST', headers: { 'x-gss-actor': claimOwner ?? 'command-center' }, body: JSON.stringify({ claimOwner }),
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
  }) {
    const payload = await this.request('/control/v1/results', {
      method: 'POST',
      headers: { 'x-gss-actor': result.executor },
      body: JSON.stringify({ result, ...(observation ? { observation } : {}), ...(loop ? { loop } : {}) }),
    }, [200]);
    return { replay: payload.replay === true, loop: payload.loop };
  }
}

export function controlPlaneClientFromEnvironment(): ControlPlaneTaskClient | null {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  return baseUrl ? new HttpControlPlaneClient(baseUrl.replace(/\/$/, '')) : null;
}
