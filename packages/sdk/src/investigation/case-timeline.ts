import { isEvidenceTimeline, type EvidenceTimeline, type EvidenceTimelineEntry } from './evidence-timeline.js';
import { sha256Canonical } from '../runtime/investigation-loop.js';

export interface CaseTimelineEntry extends EvidenceTimelineEntry {
  taskId: string;
  evidenceId: string;
  artifactHash: string;
  projectionHash: string;
}
export type CaseTimelineSource = Omit<EvidenceTimeline, 'entries' | 'schemaVersion' | 'caseId'>;
export interface CaseTimeline {
  schemaVersion: 'gss.case-timeline.v1';
  caseId: string;
  snapshotHash: string;
  scope: 'RETAINED_AUTHORITY_PROJECTIONS';
  ordering: 'UTC_MILLISECONDS_THEN_PROVENANCE_NOT_CAUSAL';
  completedQueryCount: number;
  unprojectedQueryCount: number;
  omittedProjectionCount: number;
  inputEventCount: number;
  omittedEventCount: number;
  uncertainTimeCount: number;
  partial: boolean;
  entryLimit: number;
  sources: CaseTimelineSource[];
  entries: CaseTimelineEntry[];
}

/** Keep repeated event IDs from different queries: equal identifiers do not establish identical events. */
export function buildCaseTimeline(caseId: string, projections: unknown[], coverage: {
  completedQueryCount: number; unprojectedQueryCount: number; omittedProjectionCount: number;
}, entryLimit = 200): CaseTimeline {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(caseId) || !Array.isArray(projections) || projections.length > 32 ||
    !Number.isSafeInteger(entryLimit) || entryLimit < 1 || entryLimit > 200 ||
    Object.values(coverage).some(x => !Number.isSafeInteger(x) || x < 0) ||
    coverage.completedQueryCount !== projections.length + coverage.unprojectedQueryCount + coverage.omittedProjectionCount) {
    throw new Error('Invalid case timeline bounds');
  }
  const retained: EvidenceTimeline[] = [];
  const tasks = new Set<string>();
  for (const value of projections) {
    if (!isEvidenceTimeline(value) || value.caseId !== caseId || tasks.has(value.taskId)) {
      throw new Error('Invalid retained timeline provenance or hash');
    }
    tasks.add(value.taskId); retained.push(value);
  }
  retained.sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0);
  const sources: CaseTimelineSource[] = retained.map(({ entries: _entries, schemaVersion: _schema, caseId: _case, ...source }) => source);
  const entries = retained.flatMap(t => t.entries.map(entry => ({ ...entry, taskId: t.taskId, evidenceId: t.evidenceId,
    artifactHash: t.artifactHash, projectionHash: t.projectionHash })));
  entries.sort((a, b) => {
    const time = a.occurredAt === null ? (b.occurredAt === null ? 0 : 1) :
      b.occurredAt === null ? -1 : Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    return time || (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0) || a.sourceIndex - b.sourceIndex;
  });
  const inputEventCount = retained.reduce((n, t) => n + t.inputCount, 0);
  const snapshot = { schemaVersion: 'gss.case-timeline.v1' as const, caseId,
    scope: 'RETAINED_AUTHORITY_PROJECTIONS' as const, ordering: 'UTC_MILLISECONDS_THEN_PROVENANCE_NOT_CAUSAL' as const,
    ...coverage, inputEventCount, omittedEventCount: inputEventCount - Math.min(entries.length, entryLimit),
    uncertainTimeCount: retained.reduce((n, t) => n + t.uncertainTimeCount, 0),
    partial: coverage.unprojectedQueryCount > 0 || coverage.omittedProjectionCount > 0 || entries.length > entryLimit ||
      retained.some(t => t.truncated || t.fieldTruncated), entryLimit, sources, entries: entries.slice(0, entryLimit) };
  return { ...snapshot, snapshotHash: sha256Canonical(snapshot) };
}
