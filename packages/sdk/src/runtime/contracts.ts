export const TASK_SCHEMA_VERSION = 'gss.task.v1' as const;
export const RESULT_SCHEMA_VERSION = 'gss.result.v1' as const;

export type CaseState =
  | 'NEW'
  | 'TRIAGING'
  | 'INVESTIGATING'
  | 'COLLECTING_EVIDENCE'
  | 'ANALYZING'
  | 'WAITING_APPROVAL'
  | 'RESPONDING'
  | 'VERIFYING'
  | 'CLOSED'
  | 'REOPENED';

export type TaskTarget = 'cli' | 'ide' | 'siem';
export type TaskRisk = 'read_only' | 'approval_required' | 'denied';
export type TaskStatus = 'QUEUED' | 'DISPATCHED' | 'RUNNING' | 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
export type CapabilityAction =
  | 'inspect_hostname'
  | 'inspect_system'
  | 'inspect_network_config'
  | 'inspect_network_connections'
  | 'analyze_code'
  | 'search_code'
  | 'search_siem';

export interface GssTaskContract {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  taskId: string;
  caseId: string;
  idempotencyKey: string;
  source: 'standalone';
  target: TaskTarget;
  action: CapabilityAction;
  parameters: Record<string, unknown>;
  riskLevel: TaskRisk;
  contextRefs: string[];
  timeoutMs: number;
  createdAt: string;
}

export interface GssResultContract {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  taskId: string;
  caseId: string;
  executor: 'cli' | 'ide' | 'siem';
  status: Extract<TaskStatus, 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED'>;
  result: Record<string, unknown>;
  evidenceRefs: string[];
  errors: Array<{ code: string; message: string }>;
  metrics: { durationMs: number; outputBytes?: number };
  completedAt: string;
}

export interface ObservationPack {
  observationId: string;
  caseId: string;
  taskId: string;
  summary: string;
  facts: Array<{ key: string; value: string }>;
  evidenceRefs: string[];
  rawArtifactRef?: string;
  originalBytes: number;
  packedBytes: number;
  createdAt: string;
}

export interface IdeInvestigationMatch {
  path: string;
  line: number;
  column: number;
  term: string;
  excerpt: string;
}

export interface IdeInvestigationRecord {
  schemaVersion: 'gss.ide-investigation.v1';
  taskId: string;
  caseId: string;
  action: 'search_code' | 'analyze_code';
  repositoryRootId: string;
  requestedPath: string;
  queryTerms: string[];
  scannedFiles: number;
  skippedFiles: number;
  scannedBytes: number;
  matchCount: number;
  truncated: boolean;
  redaction: 'SECRET_PATTERNS_REDACTED';
  quarantinedFragments: number;
  matches: IdeInvestigationMatch[];
}

export interface RuntimeStatusPayload {
  action: 'ui_flash';
  source: string;
  message: string;
  caseId?: string;
  taskId?: string;
  caseState?: CaseState;
  task?: GssTaskContract;
  result?: GssResultContract;
  observation?: ObservationPack;
}

export function isGssTaskContract(value: unknown): value is GssTaskContract {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<GssTaskContract>;
  return task.schemaVersion === TASK_SCHEMA_VERSION && typeof task.taskId === 'string' &&
    typeof task.caseId === 'string' && task.source === 'standalone' &&
    ['cli', 'ide', 'siem'].includes(String(task.target)) && typeof task.action === 'string' &&
    task.riskLevel === 'read_only' && Number.isSafeInteger(task.timeoutMs);
}

export function isIdeInvestigationRecord(value: unknown): value is IdeInvestigationRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<IdeInvestigationRecord>;
  if (record.schemaVersion !== 'gss.ide-investigation.v1' || typeof record.taskId !== 'string' || !record.taskId ||
    typeof record.caseId !== 'string' || !record.caseId || !['search_code', 'analyze_code'].includes(String(record.action)) ||
    typeof record.repositoryRootId !== 'string' || !/^repo-[a-f0-9]{16}$/.test(record.repositoryRootId) ||
    typeof record.requestedPath !== 'string' || record.requestedPath.length > 500 || record.requestedPath.includes('\0') ||
    record.requestedPath.startsWith('/') || /^[a-z]:[\\/]/i.test(record.requestedPath) ||
    record.requestedPath.split(/[\\/]+/).includes('..') ||
    record.redaction !== 'SECRET_PATTERNS_REDACTED' || typeof record.truncated !== 'boolean') return false;
  for (const count of [record.scannedFiles, record.skippedFiles, record.scannedBytes, record.matchCount, record.quarantinedFragments]) {
    if (!Number.isSafeInteger(count) || Number(count) < 0) return false;
  }
  if (!Array.isArray(record.queryTerms) || record.queryTerms.length === 0 || record.queryTerms.length > 8 ||
    record.queryTerms.some(term => typeof term !== 'string' || !term || term.length > 200)) return false;
  if (!Array.isArray(record.matches) || record.matches.length > 100 || record.matchCount !== record.matches.length) return false;
  return record.matches.every(match => Boolean(match) && typeof match.path === 'string' && match.path.length <= 1000 &&
    !match.path.startsWith('/') && !/^[a-z]:[\\/]/i.test(match.path) && !match.path.split(/[\\/]+/).includes('..') &&
    Number.isSafeInteger(match.line) && match.line > 0 && Number.isSafeInteger(match.column) && match.column > 0 &&
    typeof match.term === 'string' && match.term.length > 0 && match.term.length <= 200 &&
    typeof match.excerpt === 'string' && match.excerpt.length <= 320);
}
