import { sha256Canonical, type ModelUsageRecord } from './investigation-loop.js';

export interface ModelReservationInput {
  schemaVersion: 'gss.model-reservation.v1';
  usageId: string;
  caseId: string;
  provider: 'openai' | 'groq';
  model: string;
  requestHash: string;
  requestBytes: number;
  maxOutputTokens: number;
}
export type ModelReservationReceipt = { enabled: false } | {
  enabled: true; reservationId: string; state: 'RESERVED' | 'STARTED' | 'SETTLED' | 'UNKNOWN' | 'BREACHED'; replay: boolean;
};
export interface ModelCallGate {
  reserve(input: Omit<ModelReservationInput, 'schemaVersion' | 'usageId' | 'caseId'>): Promise<ModelReservationReceipt>;
  start(reservationId: string, attemptId: string): Promise<{ started: boolean }>;
}

export function modelUsagePayloadHash(record: ModelUsageRecord): string {
  return sha256Canonical({ caseId:record.caseId,taskId:record.taskId ?? null,model:record.model,
    reasoningEffort:record.reasoningEffort,routeReason:record.routeReason,inputTokens:record.inputTokens,
    outputTokens:record.outputTokens,cachedTokens:record.cachedTokens,cacheWriteTokens:record.cacheWriteTokens ?? null,
    estimatedCostMicros:record.estimatedCostMicros,status:record.status,latencyMs:record.latencyMs,retryCount:record.retryCount,
    ...(record.reservationId ? {reservationId:record.reservationId, invocationAttemptId:record.invocationAttemptId ?? null} : {}) });
}
