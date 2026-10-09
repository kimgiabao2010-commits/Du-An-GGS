import { createHash } from 'node:crypto';
import type { CapabilityAction, GssTaskContract, ObservationPack, TaskRisk, TaskTarget } from './contracts.js';

export const INVESTIGATION_RUN_SCHEMA_VERSION = 'gss.investigation-run.v1' as const;
export const EVIDENCE_FRONTIER_SCHEMA_VERSION = 'gss.evidence-frontier.v1' as const;
export const NEXT_STEP_SCHEMA_VERSION = 'gss.next-step.v1' as const;
export const MODEL_USAGE_SCHEMA_VERSION = 'gss.model-usage.v1' as const;
export const CONTROL_OUTBOX_SCHEMA_VERSION = 'gss.control-outbox.v1' as const;

export type InvestigationRunState = 'ACTIVE' | 'WAITING_APPROVAL' | 'FINALIZED' | 'BLOCKED' | 'FAILED';
export type NextStepKind = 'DISPATCH' | 'WAIT_APPROVAL' | 'FINALIZE' | 'BLOCKED';
export type EvidenceSemanticType = 'FACT' | 'INFERENCE' | 'HYPOTHESIS' | 'UNKNOWN';

export interface InvestigationBudget {
  maxDepth: number;
  deadlineAt: string;
  maxExternalQueries: number;
  maxCostMicros: number;
  requireKnownCost?: boolean;
}

export interface InvestigationUsage {
  externalQueries: number;
  costMicros: number;
  costUnknown?: boolean;
}

export interface InvestigationRun {
  schemaVersion: typeof INVESTIGATION_RUN_SCHEMA_VERSION;
  runId: string;
  caseId: string;
  state: InvestigationRunState;
  frontierVersion: number;
  depth: number;
  budget: InvestigationBudget;
  usage: InvestigationUsage;
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
  traceparent?: string;
}

export interface FactProvenance {
  taskId: string;
  evidenceRef: string;
  source: string;
  observedAt: string;
  artifactHash?: string;
}

export interface FrontierFact {
  factId: string;
  key: string;
  value: string;
  semanticType: EvidenceSemanticType;
  provenance: FactProvenance[];
}

export interface FrontierContradiction {
  contradictionId: string;
  key: string;
  factIds: string[];
}

export interface EvidenceFrontier {
  schemaVersion: typeof EVIDENCE_FRONTIER_SCHEMA_VERSION;
  runId: string;
  caseId: string;
  version: number;
  facts: FrontierFact[];
  contradictions: FrontierContradiction[];
  evidenceRefs: string[];
  sourceObservationIds: string[];
  updatedAt: string;
}

export interface ProposedAction {
  target: TaskTarget;
  action: CapabilityAction;
  parameters: Record<string, unknown>;
  riskLevel: TaskRisk;
}

export interface NextStepProposal {
  kind: NextStepKind;
  reasonCode: string;
  rationale: string;
  action?: ProposedAction;
}

export interface NextStepDecision {
  schemaVersion: typeof NEXT_STEP_SCHEMA_VERSION;
  decisionId: string;
  runId: string;
  caseId: string;
  frontierVersion: number;
  kind: NextStepKind;
  reasonCode: string;
  rationale: string;
  policyVersion: string;
  action?: ProposedAction & { fingerprint: string };
  createdAt: string;
}

export interface ModelUsageRecord {
  schemaVersion: typeof MODEL_USAGE_SCHEMA_VERSION;
  usageId: string;
  caseId: string;
  taskId?: string;
  traceId: string;
  model: string;
  reasoningEffort: string;
  routeReason: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens?: number | null;
  latencyMs: number;
  retryCount: number;
  estimatedCostMicros: number | null;
  status: 'SUCCEEDED' | 'FAILED';
  createdAt: string;
  reservationId?: string;
  invocationAttemptId?: string;
}

export interface ControlOutboxEvent {
  schemaVersion: typeof CONTROL_OUTBOX_SCHEMA_VERSION;
  eventId: string;
  aggregateId: string;
  eventType: 'NEXT_STEP_DECIDED' | 'TASK_DISPATCH_REQUESTED';
  payload: Record<string, unknown>;
  eventHash: string;
  createdAt: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** RFC 8785-compatible canonical JSON for the JSON value subset accepted by GSS contracts. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot encode non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort(compareCodeUnits);
    return `{${keys.map(key => {
      if (object[key] === undefined) throw new Error('Canonical JSON cannot encode undefined');
      return `${JSON.stringify(key)}:${canonicalJson(object[key])}`;
    }).join(',')}}`;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}`);
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** An intake dispatch is not a planner decision or fabricated frontier. */
export function initialTaskDispatchEvent(task: GssTaskContract, runId?: string): ControlOutboxEvent {
  const payload = { schemaVersion: 'gss.initial-dispatch.v1',
    task: JSON.parse(JSON.stringify(task)), ...(runId ? { runId } : {}) };
  const aggregateId = runId ?? task.caseId;
  const eventType = 'TASK_DISPATCH_REQUESTED' as const;
  const eventHash = sha256Canonical({ aggregateId, eventType, payload });
  return { schemaVersion: CONTROL_OUTBOX_SCHEMA_VERSION, eventId: `INITIAL-${eventHash}`,
    aggregateId, eventType, payload, eventHash, createdAt: task.createdAt };
}

export function actionFingerprint(action: ProposedAction): string {
  return sha256Canonical({
    action: action.action,
    parameters: action.parameters,
    riskLevel: action.riskLevel,
    target: action.target,
  });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function provenanceKey(value: FactProvenance): string {
  return canonicalJson(value);
}

function mergeProvenance(current: FactProvenance[], additions: FactProvenance[]): FactProvenance[] {
  const byKey = new Map(current.map(item => [provenanceKey(item), item]));
  for (const item of additions) byKey.set(provenanceKey(item), item);
  return [...byKey.entries()].sort(([left], [right]) => compareCodeUnits(left, right)).map(([, item]) => item);
}

function factIdentity(key: string, value: string, semanticType: EvidenceSemanticType): string {
  return `FACT-${sha256Canonical({ key, semanticType, value }).slice(0, 32)}`;
}

function buildContradictions(facts: FrontierFact[]): FrontierContradiction[] {
  const byKey = new Map<string, FrontierFact[]>();
  for (const fact of facts) {
    if (fact.semanticType !== 'FACT') continue;
    const group = byKey.get(fact.key) ?? [];
    group.push(fact);
    byKey.set(fact.key, group);
  }
  const contradictions: FrontierContradiction[] = [];
  for (const [key, group] of byKey) {
    if (new Set(group.map(fact => fact.value)).size < 2) continue;
    const factIds = uniqueSorted(group.map(fact => fact.factId));
    contradictions.push({
      contradictionId: `CON-${sha256Canonical({ factIds, key }).slice(0, 32)}`,
      key,
      factIds,
    });
  }
  return contradictions.sort((left, right) => compareCodeUnits(left.contradictionId, right.contradictionId));
}

export interface ReduceEvidenceInput {
  runId: string;
  caseId: string;
  observation: ObservationPack;
  source: string;
  artifactHash?: string;
  current?: EvidenceFrontier;
  now?: string;
}

export function reduceEvidenceFrontier(input: ReduceEvidenceInput): EvidenceFrontier {
  if (input.observation.caseId !== input.caseId) throw new Error('Observation case does not match investigation run');
  if (input.current && (input.current.runId !== input.runId || input.current.caseId !== input.caseId)) {
    throw new Error('Current frontier does not match investigation run');
  }
  if (input.observation.evidenceRefs.length === 0) throw new Error('Verified evidence reference is required');
  if (input.artifactHash && !/^[a-f0-9]{64}$/i.test(input.artifactHash)) throw new Error('artifactHash must be SHA-256');

  const observedAt = input.observation.createdAt;
  const evidenceRefs = uniqueSorted(input.observation.evidenceRefs);
  const additions = input.observation.facts.map(fact => {
    const provenance = evidenceRefs.map(evidenceRef => ({
      taskId: input.observation.taskId,
      evidenceRef,
      source: input.source,
      observedAt,
      ...(input.artifactHash ? { artifactHash: input.artifactHash.toLowerCase() } : {}),
    }));
    return {
      factId: factIdentity(fact.key, fact.value, 'FACT'),
      key: fact.key,
      value: fact.value,
      semanticType: 'FACT' as const,
      provenance,
    };
  });

  const facts = new Map<string, FrontierFact>();
  for (const fact of input.current?.facts ?? []) facts.set(fact.factId, { ...fact, provenance: [...fact.provenance] });
  for (const addition of additions) {
    const existing = facts.get(addition.factId);
    facts.set(addition.factId, existing
      ? { ...existing, provenance: mergeProvenance(existing.provenance, addition.provenance) }
      : addition);
  }
  const orderedFacts = [...facts.values()].sort((left, right) => compareCodeUnits(left.factId, right.factId));
  return {
    schemaVersion: EVIDENCE_FRONTIER_SCHEMA_VERSION,
    runId: input.runId,
    caseId: input.caseId,
    version: (input.current?.version ?? 0) + 1,
    facts: orderedFacts,
    contradictions: buildContradictions(orderedFacts),
    evidenceRefs: uniqueSorted([...(input.current?.evidenceRefs ?? []), ...evidenceRefs]),
    sourceObservationIds: uniqueSorted([...(input.current?.sourceObservationIds ?? []), input.observation.observationId]),
    updatedAt: input.now ?? new Date().toISOString(),
  };
}

export interface PlanNextStepInput {
  run: InvestigationRun;
  frontier: EvidenceFrontier;
  proposal: NextStepProposal;
  previousActionFingerprints?: string[];
  now?: string;
}

function blockedDecision(input: PlanNextStepInput, reasonCode: string, rationale: string, now: string): NextStepDecision {
  const identity = { runId: input.run.runId, frontierVersion: input.frontier.version, kind: 'BLOCKED', reasonCode,
    policyVersion: input.run.policyVersion };
  return {
    schemaVersion: NEXT_STEP_SCHEMA_VERSION,
    decisionId: `DEC-${sha256Canonical(identity).slice(0, 32)}`,
    runId: input.run.runId,
    caseId: input.run.caseId,
    frontierVersion: input.frontier.version,
    kind: 'BLOCKED',
    reasonCode,
    rationale,
    policyVersion: input.run.policyVersion,
    createdAt: now,
  };
}

export function planNextStep(input: PlanNextStepInput): NextStepDecision {
  if (input.frontier.runId !== input.run.runId || input.frontier.caseId !== input.run.caseId) {
    throw new Error('Frontier does not belong to investigation run');
  }
  const now = input.now ?? new Date().toISOString();
  if (input.run.state !== 'ACTIVE') return blockedDecision(input, 'RUN_NOT_ACTIVE', 'The investigation run is not active.', now);
  if(input.run.budget.requireKnownCost && input.run.usage.costUnknown) {
    return blockedDecision(input,'COST_ACCOUNTING_UNKNOWN','Unknown model cost cannot authorize further automatic dispatch.',now);
  }
  if (new Date(now).getTime() >= new Date(input.run.budget.deadlineAt).getTime()) {
    return blockedDecision(input, 'DEADLINE_EXHAUSTED', 'The investigation deadline was reached.', now);
  }
  if (input.run.depth >= input.run.budget.maxDepth) {
    return blockedDecision(input, 'DEPTH_EXHAUSTED', 'The bounded investigation depth was reached.', now);
  }
  if (input.run.usage.externalQueries >= input.run.budget.maxExternalQueries) {
    return blockedDecision(input, 'QUERY_BUDGET_EXHAUSTED', 'The external query budget was reached.', now);
  }
  if (input.run.usage.costMicros >= input.run.budget.maxCostMicros) {
    return blockedDecision(input, 'COST_BUDGET_EXHAUSTED', 'The investigation cost budget was reached.', now);
  }
  if (input.frontier.evidenceRefs.length === 0) {
    return blockedDecision(input, 'NO_VERIFIED_EVIDENCE', 'No verified evidence is available for the next decision.', now);
  }
  if (input.proposal.kind === 'FINALIZE' && input.frontier.contradictions.length > 0) {
    return blockedDecision(input, 'CONTRADICTORY_EVIDENCE', 'Contradictory facts require another investigation step or human review.', now);
  }

  let action: NextStepDecision['action'];
  if (input.proposal.kind === 'DISPATCH' || input.proposal.kind === 'WAIT_APPROVAL') {
    if (!input.proposal.action) return blockedDecision(input, 'ACTION_REQUIRED', 'The proposed decision requires an action.', now);
    if (input.proposal.kind === 'DISPATCH' && input.proposal.action.riskLevel !== 'read_only') {
      return blockedDecision(input, 'DISPATCH_RISK_DENIED', 'Only read-only actions may be dispatched automatically.', now);
    }
    if (input.proposal.kind === 'WAIT_APPROVAL' && input.proposal.action.riskLevel !== 'approval_required') {
      return blockedDecision(input, 'APPROVAL_RISK_MISMATCH', 'Approval is only valid for approval-required actions.', now);
    }
    const fingerprint = actionFingerprint(input.proposal.action);
    if (input.previousActionFingerprints?.includes(fingerprint)) {
      return blockedDecision(input, 'REPEATED_ACTION', 'The same canonical action was already attempted.', now);
    }
    action = { ...input.proposal.action, fingerprint };
  } else if (input.proposal.action) {
    return blockedDecision(input, 'UNEXPECTED_ACTION', 'This decision kind must not include an action.', now);
  }

  const identity = {
    runId: input.run.runId,
    frontierVersion: input.frontier.version,
    kind: input.proposal.kind,
    reasonCode: input.proposal.reasonCode,
    actionFingerprint: action?.fingerprint ?? null,
    policyVersion: input.run.policyVersion,
  };
  return {
    schemaVersion: NEXT_STEP_SCHEMA_VERSION,
    decisionId: `DEC-${sha256Canonical(identity).slice(0, 32)}`,
    runId: input.run.runId,
    caseId: input.run.caseId,
    frontierVersion: input.frontier.version,
    kind: input.proposal.kind,
    reasonCode: input.proposal.reasonCode,
    rationale: input.proposal.rationale,
    policyVersion: input.run.policyVersion,
    ...(action ? { action } : {}),
    createdAt: now,
  };
}

export function createControlOutboxEvent(decision: NextStepDecision, parentTaskId?: string, traceparent?: string): ControlOutboxEvent {
  const payload = { decision, ...(parentTaskId ? { parentTaskId } : {}), ...(traceparent ? { traceparent } : {}) };
  const eventType = decision.kind === 'DISPATCH' ? 'TASK_DISPATCH_REQUESTED' : 'NEXT_STEP_DECIDED';
  const identity = { aggregateId: decision.runId, eventType, payload };
  const eventHash = sha256Canonical(identity);
  return {
    schemaVersion: CONTROL_OUTBOX_SCHEMA_VERSION,
    eventId: `EVT-${eventHash.slice(0, 32)}`,
    aggregateId: decision.runId,
    eventType,
    payload,
    eventHash,
    createdAt: decision.createdAt,
  };
}
