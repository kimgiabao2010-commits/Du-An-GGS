import type { CaseTimeline } from '@asq/sdk';

/** Display validation; the authenticated authority verifies canonical hashes and artifact bindings. */
export function caseTimelineView(input: unknown, caseId: string): CaseTimeline {
  const t = input as CaseTimeline;
  const text = (x: unknown, max = 256): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
  const hash = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
  const count = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
  const date = (x: unknown) => text(x, 128) && Number.isFinite(Date.parse(x));
  const fail = () => { throw new Error('Invalid case timeline; no events inferred.'); };
  if (!t || t.schemaVersion !== 'gss.case-timeline.v1' || t.caseId !== caseId || !hash(t.snapshotHash) ||
    t.scope !== 'RETAINED_AUTHORITY_PROJECTIONS' || t.ordering !== 'UTC_MILLISECONDS_THEN_PROVENANCE_NOT_CAUSAL' ||
    ![t.completedQueryCount,t.unprojectedQueryCount,t.omittedProjectionCount,t.inputEventCount,t.omittedEventCount,t.uncertainTimeCount,t.entryLimit].every(count) ||
    t.entryLimit < 1 || t.entryLimit > 200 || typeof t.partial !== 'boolean' ||
    !Array.isArray(t.sources) || t.sources.length > 32 || !Array.isArray(t.entries) || t.entries.length > t.entryLimit ||
    t.completedQueryCount !== t.sources.length + t.unprojectedQueryCount + t.omittedProjectionCount ||
    t.inputEventCount !== t.entries.length + t.omittedEventCount) return fail();
  const sources = new Map(t.sources.map(s => [s?.taskId,s]));
  if (sources.size !== t.sources.length || t.sources.some(s => !s || !text(s.taskId) || !text(s.evidenceId) ||
    !hash(s.artifactHash) || !hash(s.projectionHash) || !text(s.sourceInstance,2048) ||
    !date(s.queriedAt) || !date(s.queryRange?.start) || !date(s.queryRange?.end) ||
    Date.parse(s.queryRange.start) >= Date.parse(s.queryRange.end) ||
    (s.adapter === 'google-chronicle' ? s.sourceKind !== 'CHRONICLE_UNATTESTED' || s.collectedAt !== null :
      s.adapter !== 'lab-windows-events' || !['LAB_LIVE','REPLAY'].includes(s.sourceKind) || !date(s.collectedAt)) ||
    ![s.inputCount,s.omittedCount,s.uncertainTimeCount].every(count) || s.inputCount > 1000 || s.omittedCount > s.inputCount ||
    s.uncertainTimeCount > s.inputCount || typeof s.truncated !== 'boolean' || typeof s.fieldTruncated !== 'boolean' ||
    s.precision !== 'MILLISECOND_SORT_ONLY_RAW_PRESERVED')) return fail();
  if (t.inputEventCount !== t.sources.reduce((n,s)=>n+s.inputCount,0) ||
    t.uncertainTimeCount !== t.sources.reduce((n,s)=>n+s.uncertainTimeCount,0) ||
    (!t.partial && (t.unprojectedQueryCount || t.omittedProjectionCount || t.omittedEventCount || t.sources.some(s=>s.truncated || s.fieldTruncated)))) return fail();
  const seen = new Set<string>();
  for (const entry of t.entries) {
    const source = sources.get(entry?.taskId), key = JSON.stringify([entry?.taskId,entry?.sourceIndex]);
    if (!source || !text(entry.eventId,1024) || !count(entry.sourceIndex) || entry.sourceIndex >= source.inputCount || seen.has(key) ||
      entry.evidenceId !== source.evidenceId || entry.artifactHash !== source.artifactHash || entry.projectionHash !== source.projectionHash ||
      !(entry.rawTimestamp === null || typeof entry.rawTimestamp === 'string' && entry.rawTimestamp.length <= 128) ||
      !['VALID','MISSING','INVALID','TIMEZONE_MISSING'].includes(entry.timeStatus) ||
      (entry.timeStatus === 'VALID' ? !date(entry.occurredAt) || !date(entry.rawTimestamp) ||
        Date.parse(entry.occurredAt!) !== Date.parse(entry.rawTimestamp!) : entry.occurredAt !== null)) return fail();
    seen.add(key);
  }
  return t;
}
