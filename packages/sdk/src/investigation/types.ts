export type IndicatorType = 'IP' | 'DOMAIN' | 'HASH' | 'USER' | 'HOSTNAME';
export type InvestigationTaskStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'BLOCKED' | 'FAILED';
export type Verdict = 'INSUFFICIENT_EVIDENCE' | 'BENIGN' | 'SUSPICIOUS' | 'CONFIRMED';
export type SiemFailureCode = 'UNCONFIGURED' | 'INVALID_QUERY' | 'AUTH_DENIED' | 'RATE_LIMIT' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_FAILURE';

export interface InvestigationRequest {
  incidentId: string;
  taskId: string;
  idempotencyKey: string;
  requestedBy: string;
  indicator: { type: IndicatorType; value: string };
  timeRange: { start: string; end: string };
  limit?: number;
}

export interface EvidenceProvenance {
  adapter: 'google-chronicle';
  adapterVersion: 'v1';
  queryHash: string;
  sourceInstance: string;
  queriedAt: string;
  timeRange: { start: string; end: string };
  resultCount: number;
  truncated: boolean;
  redaction: 'ALLOWLISTED_FIELDS_ONLY';
}

export interface InvestigationEvidence {
  evidenceId: string;
  incidentId: string;
  taskId: string;
  eventIds: string[];
  events: Array<Record<string, unknown>>;
  provenance: EvidenceProvenance;
}

export interface InvestigationVerdict {
  incidentId: string;
  taskId: string;
  verdict: Verdict;
  evidenceIds: string[];
  policyVersion: string;
  rationale: string;
  createdAt: string;
}

export interface InvestigationOutcome {
  status: InvestigationTaskStatus;
  evidence?: InvestigationEvidence;
  verdict: InvestigationVerdict;
  failure?: { code: SiemFailureCode; message: string };
}

export interface SiemAdapter {
  investigate(request: InvestigationRequest, signal?: AbortSignal): Promise<InvestigationEvidence>;
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function isInvestigationEvidence(
  value: unknown,
  expected?: { incidentId?: string; taskId?: string },
): value is InvestigationEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<InvestigationEvidence>;
  const provenance = evidence.provenance as Partial<EvidenceProvenance> | undefined;
  if (typeof evidence.evidenceId !== 'string' || !evidence.evidenceId ||
    typeof evidence.incidentId !== 'string' || !evidence.incidentId ||
    typeof evidence.taskId !== 'string' || !evidence.taskId ||
    (expected?.incidentId !== undefined && evidence.incidentId !== expected.incidentId) ||
    (expected?.taskId !== undefined && evidence.taskId !== expected.taskId) ||
    !Array.isArray(evidence.eventIds) || evidence.eventIds.some(id => typeof id !== 'string' || !id) ||
    new Set(evidence.eventIds).size !== evidence.eventIds.length ||
    !Array.isArray(evidence.events) || evidence.events.some(event => !event || typeof event !== 'object' || Array.isArray(event)) ||
    !provenance || provenance.adapter !== 'google-chronicle' || provenance.adapterVersion !== 'v1' ||
    typeof provenance.queryHash !== 'string' || !/^[a-f0-9]{64}$/i.test(provenance.queryHash) ||
    typeof provenance.sourceInstance !== 'string' || !provenance.sourceInstance ||
    !validIsoTimestamp(provenance.queriedAt) || !provenance.timeRange ||
    !validIsoTimestamp(provenance.timeRange.start) || !validIsoTimestamp(provenance.timeRange.end) ||
    Date.parse(provenance.timeRange.start) >= Date.parse(provenance.timeRange.end) ||
    !Number.isSafeInteger(provenance.resultCount) || Number(provenance.resultCount) < 0 ||
    provenance.resultCount !== evidence.events.length || typeof provenance.truncated !== 'boolean' ||
    provenance.redaction !== 'ALLOWLISTED_FIELDS_ONLY') return false;
  return true;
}

export function isInvestigationVerdict(
  value: unknown,
  expected?: { incidentId?: string; taskId?: string; evidenceId?: string },
): value is InvestigationVerdict {
  if (!value || typeof value !== 'object') return false;
  const verdict = value as Partial<InvestigationVerdict>;
  if (typeof verdict.incidentId !== 'string' || !verdict.incidentId ||
    typeof verdict.taskId !== 'string' || !verdict.taskId ||
    (expected?.incidentId !== undefined && verdict.incidentId !== expected.incidentId) ||
    (expected?.taskId !== undefined && verdict.taskId !== expected.taskId) ||
    !['INSUFFICIENT_EVIDENCE', 'BENIGN', 'SUSPICIOUS', 'CONFIRMED'].includes(String(verdict.verdict)) ||
    !Array.isArray(verdict.evidenceIds) || verdict.evidenceIds.some(id => typeof id !== 'string' || !id) ||
    (expected?.evidenceId !== undefined && !verdict.evidenceIds.includes(expected.evidenceId)) ||
    typeof verdict.policyVersion !== 'string' || !verdict.policyVersion ||
    typeof verdict.rationale !== 'string' || !verdict.rationale || !validIsoTimestamp(verdict.createdAt)) return false;
  return true;
}
