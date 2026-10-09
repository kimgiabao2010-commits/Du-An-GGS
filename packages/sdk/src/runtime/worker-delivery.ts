import type { GssTaskContract, GssResultContract, ObservationPack } from './contracts.js';
import { sha256Canonical, type NextStepProposal } from './investigation-loop.js';

export interface ResultSubmission {
  result: GssResultContract;
  observation?: ObservationPack;
  loop?: { runId: string; source: string; artifactHash?: string; proposal: NextStepProposal };
}
export interface WorkerDeliveryInput {
  schemaVersion: 'gss.worker-delivery.v1';
  deliveryId: string;
  workerId: string;
  caseId: string;
  taskId: string;
  payload: Record<string, unknown>;
}
export interface WorkerDeliveryRecord extends WorkerDeliveryInput {
  task: GssTaskContract;
  runId?: string;
  receivedAt: string;
  startedAt: string;
  prepared?: ResultSubmission;
  committed: boolean;
  retryAt?: string;
}
export function workerDeliveryId(input: Omit<WorkerDeliveryInput, 'schemaVersion' | 'deliveryId'>): string {
  return sha256Canonical(input);
}
export function resultSubmissionHash(input: ResultSubmission): string {
  return sha256Canonical(JSON.parse(JSON.stringify({ result: input.result,
    observation: input.observation ?? null, loop: input.loop ?? null })));
}
