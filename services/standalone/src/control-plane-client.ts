import type { GssResultContract, GssTaskContract, NextStepProposal, ObservationPack } from '@asq/sdk';

export interface TaskLinkage {
  runId?: string;
  parentTaskId?: string;
  actionFingerprint?: string;
}

export interface ControlPlaneTaskClient {
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
