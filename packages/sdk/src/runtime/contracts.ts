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
