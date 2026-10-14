import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { buildEvidenceTimeline, type InvestigationEvidence } from '../src/index.js';
function evidence(times:unknown[]):InvestigationEvidence {
  return {evidenceId:'fixture-evidence',incidentId:'fixture-case',taskId:'fixture-task',eventIds:times.map((_,i)=>'event-'+i),
    events:times.map(event_timestamp=>({metadata:{event_timestamp}})),provenance:{adapter:'google-chronicle',adapterVersion:'v1',
      queryHash:'a'.repeat(64),sourceInstance:'CONTRACT_FIXTURE_NOT_STAGING',queriedAt:'2026-10-10T14:00:00Z',
      timeRange:{start:'2026-10-10T12:00:00Z',end:'2026-10-10T13:00:00Z'},resultCount:times.length,truncated:false,redaction:'ALLOWLISTED_FIELDS_ONLY'}};
}
const hash=(e:InvestigationEvidence)=>createHash('sha256').update(JSON.stringify(e)).digest('hex');
describe('artifact-bound timeline projection, not causal/SOC evidence creation',()=>{
  it('orders offset-aware times, preserves raw time/lineage and never certifies live Chronicle',()=>{
    const e=evidence(['2026-10-10T12:30:00Z','2026-10-10T19:00:00+07:00']);
    const t=buildEvidenceTimeline(e,hash(e));
    expect(t.entries.map(x=>x.eventId)).toEqual(['event-1','event-0']);
    expect(t.entries[0]).toMatchObject({rawTimestamp:'2026-10-10T19:00:00+07:00',occurredAt:'2026-10-10T12:00:00.000Z'});
    expect(t).toMatchObject({sourceKind:'CHRONICLE_UNATTESTED',collectedAt:null,uncertainTimeCount:0});
    expect(buildEvidenceTimeline(e,hash(e))).toEqual(t);
  });
  it('retains missing, invalid calendar, zone-free and unknown-offset uncertainty without query-time fallback',()=>{
    const e=evidence([undefined,'2026-02-30T12:00:00Z','2026-10-10T12:00:00','2026-10-10T12:00:00-00:00',{seconds:1}]);
    const t=buildEvidenceTimeline(e,hash(e));
    expect(t.entries.map(x=>x.timeStatus)).toEqual(['MISSING','INVALID','TIMEZONE_MISSING','TIMEZONE_MISSING','INVALID']);
    expect(t.entries.every(x=>x.occurredAt===null)).toBe(true);expect(t.uncertainTimeCount).toBe(5);
  });
  it('keeps fractional raw precision, stable ties and bounded omission/field-loss metadata',()=>{
    const e=evidence(['2026-10-10T12:00:00.123456789Z','2026-10-10T12:00:00.123000001Z',null]);
    e.provenance.truncated=true;e.provenance.fieldTruncated=true;
    const t=buildEvidenceTimeline(e,hash(e),2);
    expect(t.entries.map(x=>x.eventId)).toEqual(['event-0','event-1']);
    expect(t.entries[0].rawTimestamp).toContain('123456789');
    expect(t).toMatchObject({inputCount:3,omittedCount:1,uncertainTimeCount:1,truncated:true,fieldTruncated:true});
    expect(t.projectionHash).not.toBe(buildEvidenceTimeline(e,hash(e),3).projectionHash);
  });
  it('does not manufacture a zero-result event and rejects mutation, missing lineage or invalid bounds',()=>{
    const e=evidence([]);expect(buildEvidenceTimeline(e,hash(e)).entries).toEqual([]);
    expect(()=>buildEvidenceTimeline(e,'b'.repeat(64))).toThrow('hash');
    expect(()=>buildEvidenceTimeline(e,hash(e),0)).toThrow('bounded');
    const malformed=evidence([null]);malformed.eventIds=[];
    expect(()=>buildEvidenceTimeline(malformed,hash(malformed))).toThrow('lineage');
  });
  it('keeps lab collection and event times separate with replay source labeling',()=>{
    const e=evidence([null]);e.events=[{eventTime:'2026-10-10T12:00:00Z'}];
    e.provenance={...e.provenance,adapter:'lab-windows-events',schemaVersion:'gss.evidence-provenance.v2',sourceKind:'REPLAY',
      collectedAt:'2026-10-10T13:30:00Z',artifactHash:'c'.repeat(64),artifactRef:'artifact://lab/'+ 'c'.repeat(64)+'.json'};
    expect(buildEvidenceTimeline(e,hash(e))).toMatchObject({sourceKind:'REPLAY',collectedAt:'2026-10-10T13:30:00Z',
      entries:[{occurredAt:'2026-10-10T12:00:00.000Z'}]});
  });
});
