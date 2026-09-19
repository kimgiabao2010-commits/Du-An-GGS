export type TaskStatus = 'Running' | 'Completed' | 'Failed' | 'Queued';
export type AgentState = 'Active' | 'Idle' | 'Degraded';
export type EvidenceDisposition = 'Retained' | 'Discarded';

export interface OperationTask {
  id: string;
  title: string;
  status: TaskStatus;
  agent: string;
  progress: number;
  startedAt: string;
  duration: string;
  cost: string;
  result: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: string;
  state: AgentState;
  capabilities: string[];
  currentTask: string;
  successRate: string;
  tokens: string;
  activity: string;
}

export interface EvidenceRecord {
  id: string;
  title: string;
  source: string;
  timestamp: string;
  type: 'Supporting' | 'Contradictory' | 'Unresolved';
  relevance: number;
  disposition: EvidenceDisposition;
  conclusion: string;
}

export interface LogRecord {
  id: string;
  timestamp: string;
  severity: 'INFO' | 'WARN' | 'ERROR';
  executionId: string;
  agent: string;
  message: string;
  payload: string;
}

export interface TraceNode {
  id: string;
  type: 'task' | 'decision' | 'fusion' | 'tool' | 'observation' | 'evidence' | 'compact' | 'result';
  title: string;
  summary: string;
  meta: string;
  detail?: string;
}

export interface ExecutionRecord {
  id: string;
  title: string;
  status: TaskStatus;
  agent: string;
  duration: string;
  startedAt: string;
  contextBefore: string;
  contextAfter: string;
  contextSaving: string;
  llmBefore: number;
  llmAfter: number;
  toolsBefore: number;
  toolsAfter: number;
  costBefore: string;
  costAfter: string;
  trace: TraceNode[];
}

export interface OperationsDataSource {
  mode: 'demo' | 'live';
  tasks: OperationTask[];
  agents: AgentRecord[];
  evidence: EvidenceRecord[];
  logs: LogRecord[];
  executions: ExecutionRecord[];
}

export const tasks: OperationTask[] = [
  { id: 'TSK-2481', title: 'Investigate anomalous PowerShell chain', status: 'Running', agent: 'Investigation Agent', progress: 68, startedAt: '10:42', duration: '02:14', cost: '$0.39', result: 'Correlation in progress' },
  { id: 'TSK-2479', title: 'Validate suspicious authentication burst', status: 'Completed', agent: 'Evidence Agent', progress: 100, startedAt: '10:31', duration: '04:08', cost: '$0.22', result: 'Benign automation' },
  { id: 'TSK-2478', title: 'Enrich hash from endpoint alert', status: 'Failed', agent: 'Research Agent', progress: 43, startedAt: '10:18', duration: '01:37', cost: '$0.11', result: 'Upstream timeout' },
  { id: 'TSK-2477', title: 'Review privileged account activity', status: 'Queued', agent: 'Investigation Agent', progress: 0, startedAt: '—', duration: '—', cost: '$0.00', result: 'Waiting for capacity' },
  { id: 'TSK-2476', title: 'Package endpoint observations', status: 'Completed', agent: 'Context Agent', progress: 100, startedAt: '09:54', duration: '03:21', cost: '$0.18', result: '12 evidence retained' },
];

export const agents: AgentRecord[] = [
  { id: 'AG-01', name: 'Investigation Agent', role: 'Reasoning & correlation', state: 'Active', capabilities: ['UDM search', 'Correlation', 'Verdict'], currentTask: 'TSK-2481', successRate: '96.4%', tokens: '48.2K', activity: 'Decision updated 18s ago' },
  { id: 'AG-02', name: 'Evidence Agent', role: 'Evidence preservation', state: 'Idle', capabilities: ['Reducer', 'Lineage', 'Redaction'], currentTask: 'Available', successRate: '99.1%', tokens: '31.8K', activity: 'Completed TSK-2479' },
  { id: 'AG-03', name: 'Context Agent', role: 'Context optimization', state: 'Active', capabilities: ['Compaction', 'ObservationPack'], currentTask: 'TSK-2481', successRate: '98.7%', tokens: '25.4K', activity: 'Compacted context 31s ago' },
  { id: 'AG-04', name: 'Research Agent', role: 'Read-only enrichment', state: 'Degraded', capabilities: ['Enrichment', 'Threat intel'], currentTask: 'Retry backoff', successRate: '91.8%', tokens: '19.7K', activity: 'Provider timeout 7m ago' },
];

export const evidence: EvidenceRecord[] = [
  { id: 'EV-9031', title: 'Encoded command observed on WS-044', source: 'Endpoint telemetry', timestamp: '10:43:18', type: 'Supporting', relevance: 96, disposition: 'Retained', conclusion: 'Supports suspicious execution chain' },
  { id: 'EV-9030', title: 'Parent process signed by approved publisher', source: 'Asset inventory', timestamp: '10:43:04', type: 'Contradictory', relevance: 78, disposition: 'Retained', conclusion: 'Weakens malicious-process hypothesis' },
  { id: 'EV-9029', title: 'Outbound DNS to newly seen domain', source: 'Network sensor', timestamp: '10:42:51', type: 'Supporting', relevance: 91, disposition: 'Retained', conclusion: 'Correlates endpoint and network activity' },
  { id: 'EV-9028', title: 'Duplicate process heartbeat', source: 'Endpoint telemetry', timestamp: '10:42:50', type: 'Unresolved', relevance: 24, disposition: 'Discarded', conclusion: 'Duplicate with no additional signal' },
  { id: 'EV-9027', title: 'User interactive session not confirmed', source: 'Identity provider', timestamp: '10:42:32', type: 'Unresolved', relevance: 64, disposition: 'Retained', conclusion: 'Requires identity correlation' },
];

export const logs: LogRecord[] = [
  { id: 'LOG-01', timestamp: '10:44:12.481', severity: 'INFO', executionId: 'EXE-8421', agent: 'Context Agent', message: 'Context compaction completed', payload: '{"inputTokens":18420,"outputTokens":7210,"hash":"sha256:9f2…"}' },
  { id: 'LOG-02', timestamp: '10:43:49.112', severity: 'INFO', executionId: 'EXE-8421', agent: 'Evidence Agent', message: 'Evidence reducer retained contradictory item', payload: '{"retained":12,"discarded":25,"policy":"evidence-v1"}' },
  { id: 'LOG-03', timestamp: '10:43:21.904', severity: 'WARN', executionId: 'EXE-8421', agent: 'Research Agent', message: 'Provider rate limit; applying bounded retry', payload: '{"status":429,"retryAfterMs":1200,"attempt":2}' },
  { id: 'LOG-04', timestamp: '10:42:58.317', severity: 'INFO', executionId: 'EXE-8421', agent: 'Investigation Agent', message: 'Four compatible lookups fused into one batch', payload: '{"originalActions":4,"batches":1}' },
  { id: 'LOG-05', timestamp: '10:19:44.033', severity: 'ERROR', executionId: 'EXE-8418', agent: 'Research Agent', message: 'Read-only enrichment timed out', payload: '{"timeoutMs":8000,"evidenceCreated":false}' },
];

const mainTrace: TraceNode[] = [
  { id: 'TR-01', type: 'task', title: 'User task', summary: 'Investigate the suspicious PowerShell chain on WS-044.', meta: '10:42:08 · Input accepted', detail: 'Read-only investigation. No remediation or write-back is permitted.' },
  { id: 'TR-02', type: 'decision', title: 'Agent decision', summary: 'Correlate endpoint lineage, DNS activity and user session evidence.', meta: '10:42:17 · Investigation Agent', detail: 'The plan selected deterministic correlation before model summarization.' },
  { id: 'TR-03', type: 'fusion', title: 'Action Fusion', summary: '4 compatible actions → 1 bounded batch', meta: '10:42:19 · Saved 3 tool round-trips', detail: 'Process lineage, asset metadata, DNS resolution and identity context were issued as one read-only batch.' },
  { id: 'TR-04', type: 'tool', title: 'Tool calls', summary: 'Endpoint, network and identity lookups completed', meta: '10:42:21–10:42:47 · 3 sources', detail: 'All calls were constrained by time range, result limit and read-only policy.' },
  { id: 'TR-05', type: 'observation', title: 'ObservationPack', summary: '9,842 → 2,103 tokens', meta: '10:42:52 · 78.6% packed', detail: 'Key facts: encoded command, newly seen domain, signed parent process. Raw output remains available through source references.' },
  { id: 'TR-06', type: 'evidence', title: 'Evidence-preserving reducer', summary: '37 evidence → 12 retained', meta: '10:43:04 · 6 supporting · 2 contradictory · 4 unresolved', detail: '25 duplicate or low-relevance observations were discarded. Contradictory evidence was explicitly retained.' },
  { id: 'TR-07', type: 'compact', title: 'Online Context Compact', summary: '18.4K → 7.2K tokens', meta: '10:43:26 · 60.9% reduction', detail: 'Indicators, evidence IDs, policy constraints and unresolved questions were preserved.' },
  { id: 'TR-08', type: 'result', title: 'Current result', summary: 'Suspicious — awaiting identity correlation', meta: '10:44:12 · Confidence 0.78', detail: 'No remediation proposed. Verdict remains linked to retained evidence and policy version.' },
];

export const executions: ExecutionRecord[] = [
  { id: 'EXE-8421', title: 'PowerShell chain investigation', status: 'Running', agent: 'Investigation Agent', duration: '02:14', startedAt: '10:42', contextBefore: '18.4K', contextAfter: '7.2K', contextSaving: '60.9%', llmBefore: 12, llmAfter: 7, toolsBefore: 18, toolsAfter: 11, costBefore: '$0.84', costAfter: '$0.39', trace: mainTrace },
  { id: 'EXE-8419', title: 'Authentication burst validation', status: 'Completed', agent: 'Evidence Agent', duration: '04:08', startedAt: '10:31', contextBefore: '11.2K', contextAfter: '5.1K', contextSaving: '54.5%', llmBefore: 8, llmAfter: 5, toolsBefore: 12, toolsAfter: 7, costBefore: '$0.46', costAfter: '$0.22', trace: mainTrace.map(node => ({ ...node, id: `8419-${node.id}` })) },
  { id: 'EXE-8418', title: 'Endpoint hash enrichment', status: 'Failed', agent: 'Research Agent', duration: '01:37', startedAt: '10:18', contextBefore: '6.8K', contextAfter: '4.9K', contextSaving: '27.9%', llmBefore: 5, llmAfter: 4, toolsBefore: 8, toolsAfter: 5, costBefore: '$0.19', costAfter: '$0.11', trace: mainTrace.slice(0, 5).map(node => ({ ...node, id: `8418-${node.id}` })) },
];

export const demoOperationsData: OperationsDataSource = {
  mode: 'demo', tasks, agents, evidence, logs, executions,
};

export function getExecution(id: string) {
  return executions.find(execution => execution.id === id);
}
