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
  investigate(request: InvestigationRequest): Promise<InvestigationEvidence>;
}
