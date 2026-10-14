import { createHash } from 'node:crypto';
import { sha256Canonical } from '../runtime/investigation-loop.js';
import { isInvestigationEvidence, type InvestigationEvidence } from './types.js';

export interface EvidenceTimelineEntry {
  eventId: string;
  sourceIndex: number;
  rawTimestamp: string | null;
  timeStatus: 'VALID' | 'MISSING' | 'INVALID' | 'TIMEZONE_MISSING';
  occurredAt: string | null;
}
export interface EvidenceTimeline {
  schemaVersion: 'gss.evidence-timeline.v1';
  projectionHash: string;
  caseId: string;
  taskId: string;
  evidenceId: string;
  artifactHash: string;
  adapter: InvestigationEvidence['provenance']['adapter'];
  sourceInstance: string;
  sourceKind: 'LAB_LIVE' | 'REPLAY' | 'CHRONICLE_UNATTESTED';
  queriedAt: string;
  collectedAt: string | null;
  queryRange: { start: string; end: string };
  inputCount: number;
  omittedCount: number;
  uncertainTimeCount: number;
  truncated: boolean;
  fieldTruncated: boolean;
  precision: 'MILLISECOND_SORT_ONLY_RAW_PRESERVED';
  entries: EvidenceTimelineEntry[];
}

function eventTime(value: unknown): Pick<EvidenceTimelineEntry, 'rawTimestamp' | 'timeStatus' | 'occurredAt'> {
  const rawTimestamp=typeof value==='string' && value.length<=128?value:null;
  if(value===undefined || value===null || value==='') return {rawTimestamp,timeStatus:'MISSING',occurredAt:null};
  // No guessed timezone, query-time fallback or Date.parse normalization of impossible calendar dates.
  const match=rawTimestamp?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/);
  if(!match) return {rawTimestamp,timeStatus:'INVALID',occurredAt:null};
  const [,y,m,d,h,min,s,,zone]=match,year=Number(y),month=Number(m),day=Number(d);
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1000 || month<1 || month>12 || day<1 || day>days[month-1] || Number(h)>23 || Number(min)>59 || Number(s)>59 ||
    (zone && zone!=='Z' && (Number(zone.slice(1,3))>23 || Number(zone.slice(4))>59))) {
    return {rawTimestamp,timeStatus:'INVALID',occurredAt:null};
  }
  if(!zone || zone==='-00:00') return {rawTimestamp,timeStatus:'TIMEZONE_MISSING',occurredAt:null};
  const time=Date.parse(rawTimestamp!);
  return Number.isFinite(time)?{rawTimestamp,timeStatus:'VALID',occurredAt:new Date(time).toISOString()}:
    {rawTimestamp,timeStatus:'INVALID',occurredAt:null};
}

/** Verify a retained authority projection after a JSONB round-trip. This is not provider attestation. */
export function isEvidenceTimeline(value: unknown): value is EvidenceTimeline {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const t = value as EvidenceTimeline;
  const text = (x: unknown, max = 256): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
  const date = (x: unknown) => text(x, 128) && Number.isFinite(Date.parse(x));
  const count = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
  if (t.schemaVersion !== 'gss.evidence-timeline.v1' || !text(t.caseId) || !text(t.taskId) || !text(t.evidenceId) ||
    !/^[a-f0-9]{64}$/.test(t.artifactHash) || !/^[a-f0-9]{64}$/.test(t.projectionHash) || !text(t.sourceInstance, 2048) ||
    !date(t.queriedAt) || !date(t.queryRange?.start) || !date(t.queryRange?.end) ||
    Date.parse(t.queryRange.start) >= Date.parse(t.queryRange.end) ||
    !count(t.inputCount) || t.inputCount > 1000 || !count(t.omittedCount) || !count(t.uncertainTimeCount) ||
    t.uncertainTimeCount > t.inputCount || typeof t.truncated !== 'boolean' || typeof t.fieldTruncated !== 'boolean' ||
    (t.fieldTruncated && !t.truncated) || (t.omittedCount > 0 && !t.truncated) ||
    t.precision !== 'MILLISECOND_SORT_ONLY_RAW_PRESERVED' || !Array.isArray(t.entries) || t.entries.length > 1000 ||
    t.entries.length + t.omittedCount !== t.inputCount) return false;
  if (t.adapter === 'google-chronicle' ? t.sourceKind !== 'CHRONICLE_UNATTESTED' || t.collectedAt !== null :
    t.adapter !== 'lab-windows-events' || !['LAB_LIVE', 'REPLAY'].includes(t.sourceKind) || !date(t.collectedAt)) return false;
  const indices = new Set<number>(), ids = new Set<string>();
  for (const entry of t.entries) {
    if (!entry || !text(entry.eventId, 1024) || !count(entry.sourceIndex) || entry.sourceIndex >= t.inputCount ||
      indices.has(entry.sourceIndex) || ids.has(entry.eventId) ||
      !(entry.rawTimestamp === null || typeof entry.rawTimestamp === 'string' && entry.rawTimestamp.length <= 128) ||
      !['VALID', 'MISSING', 'INVALID', 'TIMEZONE_MISSING'].includes(entry.timeStatus)) return false;
    indices.add(entry.sourceIndex); ids.add(entry.eventId);
    const parsed = eventTime(entry.rawTimestamp);
    // Non-string/oversized source timestamps intentionally retain INVALID with rawTimestamp=null.
    if (!(entry.timeStatus === 'INVALID' && entry.rawTimestamp === null && entry.occurredAt === null) &&
      (parsed.timeStatus !== entry.timeStatus || parsed.occurredAt !== entry.occurredAt)) return false;
  }
  const uncertain = t.entries.filter(entry => entry.timeStatus !== 'VALID').length;
  if (uncertain > t.uncertainTimeCount || t.uncertainTimeCount > uncertain + t.omittedCount) return false;
  try {
    const { projectionHash, ...projection } = t;
    return Buffer.byteLength(JSON.stringify(t)) <= 512_000 && sha256Canonical(projection) === projectionHash;
  } catch { return false; }
}

/** Per-artifact projection, NOT a new fact, a causal ordering or proof of a live provider call. */
export function buildEvidenceTimeline(evidence: InvestigationEvidence, artifactHash: string, maxEntries=200): EvidenceTimeline {
  if(!isInvestigationEvidence(evidence) || evidence.events.length>1000 || evidence.eventIds.length!==evidence.events.length ||
    !Number.isSafeInteger(maxEntries) || maxEntries<1 || maxEntries>1000 || !/^[a-f0-9]{64}$/.test(artifactHash)) {
    throw new Error('Invalid bounded timeline evidence/lineage');
  }
  const bytes=JSON.stringify(evidence);
  if(Buffer.byteLength(bytes)>8*1024*1024 || createHash('sha256').update(bytes).digest('hex')!==artifactHash) {
    throw new Error('Timeline artifact hash mismatch or byte limit');
  }
  const entries=evidence.events.map((event,sourceIndex)=>{
    const metadata=event.metadata && typeof event.metadata==='object' && !Array.isArray(event.metadata)?
      event.metadata as Record<string,unknown>:{};
    const timestamp=evidence.provenance.adapter==='lab-windows-events'?event.eventTime:metadata.event_timestamp;
    return {eventId:evidence.eventIds[sourceIndex],sourceIndex,...eventTime(timestamp)};
  });
  const uncertainTimeCount=entries.filter(entry=>entry.timeStatus!=='VALID').length;
  entries.sort((a,b)=>a.occurredAt===null?(b.occurredAt===null?a.sourceIndex-b.sourceIndex:1):
    b.occurredAt===null?-1:Date.parse(a.occurredAt)-Date.parse(b.occurredAt) || a.sourceIndex-b.sourceIndex);
  const provenance=evidence.provenance;
  const projection={schemaVersion:'gss.evidence-timeline.v1' as const,caseId:evidence.incidentId,taskId:evidence.taskId,
    evidenceId:evidence.evidenceId,artifactHash,adapter:provenance.adapter,sourceInstance:provenance.sourceInstance,
    sourceKind:provenance.adapter==='lab-windows-events'?provenance.sourceKind:'CHRONICLE_UNATTESTED' as const,
    queriedAt:provenance.queriedAt,collectedAt:provenance.adapter==='lab-windows-events'?provenance.collectedAt:null,
    queryRange:{...provenance.timeRange},inputCount:entries.length,omittedCount:Math.max(0,entries.length-maxEntries),
    uncertainTimeCount,truncated:provenance.truncated || entries.length>maxEntries,fieldTruncated:provenance.fieldTruncated===true,
    precision:'MILLISECOND_SORT_ONLY_RAW_PRESERVED' as const,entries:entries.slice(0,maxEntries)};
  return {...projection,projectionHash:sha256Canonical(projection)};
}
