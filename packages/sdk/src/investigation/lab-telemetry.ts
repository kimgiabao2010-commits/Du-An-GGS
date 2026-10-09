import { sha256Canonical } from '../runtime/investigation-loop.js';
import type { InvestigationEvidence, InvestigationRequest } from './types.js';
import type { ObservationPack } from '../runtime/contracts.js';
import type { EvidenceFrontier } from '../runtime/investigation-loop.js';

export type SocProfile = 'lab' | 'replay' | 'staging';
export function socProfile(env: NodeJS.ProcessEnv = process.env): SocProfile {
  const value = env.GSS_SOC_PROFILE ?? 'staging'; // Existing Chronicle behavior stays the default.
  if (!['lab', 'replay', 'staging'].includes(value)) throw new Error('Invalid GSS_SOC_PROFILE');
  if (env.GSS_RUNTIME_ENV === 'staging' && value !== 'staging') throw new Error('Staging cannot use lab/replay telemetry');
  return value as SocProfile;
}

export interface LabEvent {
  recordId: string; eventCode: number; channel: 'Application' | 'System'; provider: string;
  eventTime: string; hostId: string; level: number;
}
export interface LabBatch {
  schemaVersion: 'gss.lab-telemetry.v1'; sourceId: string; sourceKind: 'LAB_LIVE' | 'REPLAY';
  collectedAt: string; events: LabEvent[]; truncated: boolean;
}
const fail = (message: string) => Object.assign(new Error(message), { statusCode: 422 });
const timestamp = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw fail('Unexpected telemetry fields');
}
export function validateLabBatch(value: unknown): LabBatch {
  exact(value, ['schemaVersion', 'sourceId', 'sourceKind', 'collectedAt', 'events', 'truncated']);
  if (value.schemaVersion !== 'gss.lab-telemetry.v1' || typeof value.sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.sourceId) ||
      typeof value.sourceKind !== 'string' || !['LAB_LIVE', 'REPLAY'].includes(value.sourceKind) || !timestamp(value.collectedAt) ||
      typeof value.truncated !== 'boolean' || !Array.isArray(value.events) || value.events.length > 1000) throw fail('Invalid telemetry batch');
  const ids = new Set<string>();
  for (const item of value.events) {
    exact(item, ['recordId', 'eventCode', 'channel', 'provider', 'eventTime', 'hostId', 'level']);
    if (typeof item.recordId !== 'string' || !/^\d{1,20}$/.test(item.recordId) ||
        !Number.isSafeInteger(item.eventCode) || Number(item.eventCode) < 0 || Number(item.eventCode) > 65535 ||
        typeof item.channel !== 'string' || !['Application', 'System'].includes(item.channel) || typeof item.provider !== 'string' ||
        !/^[a-zA-Z0-9 ._()/-]{1,160}$/.test(item.provider) || !timestamp(item.eventTime) ||
        typeof item.hostId !== 'string' || !/^host-[a-f0-9]{64}$/.test(item.hostId) ||
        !Number.isInteger(item.level) || Number(item.level) < 0 || Number(item.level) > 5) throw fail('Invalid allowlisted event');
    const id = `${item.hostId}/${item.channel}/${item.recordId}`;
    if (ids.has(id)) throw fail('Duplicate event lineage within batch');
    ids.add(id);
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 512000) throw fail('Telemetry batch exceeds byte limit');
  return value as unknown as LabBatch;
}
export function labBatchHash(batch: LabBatch): string { return sha256Canonical(validateLabBatch(batch)); }
export function labQuery(request: InvestigationRequest) {
  if (!request?.incidentId || !request.taskId || !request.idempotencyKey || !request.indicator || !request.timeRange || request.indicator.type !== 'HOSTNAME' ||
      !/^host-[a-f0-9]{64}$/.test(request.indicator.value) || !timestamp(request.timeRange.start) || !timestamp(request.timeRange.end) ||
      Date.parse(request.timeRange.start) >= Date.parse(request.timeRange.end) ||
      Date.parse(request.timeRange.end) - Date.parse(request.timeRange.start) > 7 * 86400000 ||
      (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100))) throw fail('Invalid bounded lab query');
  return { hostId: request.indicator.value, start: request.timeRange.start, end: request.timeRange.end, limit: request.limit ?? 100 };
}

/** Pure adapter over a verified persisted batch; no provider/model output can enter it. */
export class LabTelemetryAdapter {
  constructor(private readonly batch: LabBatch, private readonly expectedHash: string, private readonly artifactRef: string) {
    if (labBatchHash(batch) !== expectedHash) throw fail('Telemetry artifact hash mismatch');
  }
  async investigate(request: InvestigationRequest, signal?: AbortSignal): Promise<InvestigationEvidence> {
    signal?.throwIfAborted();
    const query = labQuery(request);
    const matched = this.batch.events.filter(event => event.hostId === query.hostId &&
      Date.parse(event.eventTime) >= Date.parse(query.start) && Date.parse(event.eventTime) < Date.parse(query.end))
      .sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime) || a.recordId.localeCompare(b.recordId));
    const events = matched.slice(0, query.limit);
    const queryHash = sha256Canonical({ batchHash: this.expectedHash, query });
    return {
      evidenceId: 'EVD-' + sha256Canonical({ taskId: request.taskId, queryHash }).slice(0, 32),
      incidentId: request.incidentId, taskId: request.taskId,
      eventIds: events.map(event => `${this.batch.sourceId}/${event.hostId}/${event.channel}/${event.recordId}`),
      events: events.map(event => ({ ...event })),
      provenance: { schemaVersion: 'gss.evidence-provenance.v2', adapter: 'lab-windows-events', adapterVersion: 'v1',
        sourceKind: this.batch.sourceKind, collectedAt: this.batch.collectedAt, artifactHash: this.expectedHash,
        artifactRef: this.artifactRef, queryHash, sourceInstance: this.batch.sourceId, queriedAt: new Date().toISOString(),
        timeRange: request.timeRange, resultCount: events.length, truncated: this.batch.truncated || matched.length > query.limit,
        redaction: 'ALLOWLISTED_FIELDS_ONLY' },
    };
  }
}

export function labObservation(evidence: InvestigationEvidence): ObservationPack {
  const summary = `${evidence.events.length} allowlisted lab events; event metadata alone cannot determine compromise.`;
  return { observationId: 'OBS-' + sha256Canonical({ task: evidence.taskId, query: evidence.provenance.queryHash }).slice(0, 32),
    caseId: evidence.incidentId, taskId: evidence.taskId, summary,
    facts: evidence.events.map((event, index) => ({ key: `event.${evidence.eventIds[index]}`, value: JSON.stringify(event) })),
    evidenceRefs: [evidence.evidenceId], rawArtifactRef: evidence.provenance.adapter === 'lab-windows-events' ? evidence.provenance.artifactRef : undefined,
    originalBytes: Buffer.byteLength(JSON.stringify(evidence)), packedBytes: Buffer.byteLength(summary), createdAt: evidence.provenance.queriedAt };
}
export function labReport(evidence: InvestigationEvidence, frontier: EvidenceFrontier) {
  if (frontier.caseId !== evidence.incidentId || !frontier.evidenceRefs.includes(evidence.evidenceId)) throw fail('Report evidence lineage mismatch');
  return { schemaVersion: 'gss.lab-report.v1' as const, caseId: evidence.incidentId, taskId: evidence.taskId,
    evidenceIds: [evidence.evidenceId], frontierVersion: frontier.version, provenance: evidence.provenance,
    timeline: evidence.events.map((event, index) => ({ event, evidenceId: evidence.evidenceId, eventId: evidence.eventIds[index] })),
    verdict: 'INSUFFICIENT_EVIDENCE' as const, policyVersion: 'gss.lab-metadata-only.v1',
    limitations: ['Event metadata is not a SOC verdict.', 'No IOC/user/process payload collected.',
      'No Chronicle, model reasoning or sandbox execution demonstrated.', ...(evidence.provenance.truncated ? ['Collection/query is truncated.'] : [])] };
}
