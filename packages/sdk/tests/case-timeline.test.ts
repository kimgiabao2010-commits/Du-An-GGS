import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { buildCaseTimeline, buildEvidenceTimeline, isEvidenceTimeline, sha256Canonical, type InvestigationEvidence } from '../src/index.js';

function projection(taskId: string, times: Array<string|null>, limit=200) {
  const evidence: InvestigationEvidence = {evidenceId:'evidence-'+taskId,incidentId:'CASE-fixture',taskId,
    eventIds:times.map((_,i)=>'event-'+i),events:times.map(event_timestamp=>({metadata:{event_timestamp}})),
    provenance:{adapter:'google-chronicle',adapterVersion:'v1',queryHash:'a'.repeat(64),sourceInstance:'FIXTURE_NOT_LIVE',
      queriedAt:'2026-10-14T12:00:00Z',timeRange:{start:'2026-10-14T10:00:00Z',end:'2026-10-14T11:00:00Z'},
      resultCount:times.length,truncated:false,redaction:'ALLOWLISTED_FIELDS_ONLY'}};
  return buildEvidenceTimeline(evidence,createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),limit);
}
const coverage = (completedQueryCount=2,unprojectedQueryCount=0,omittedProjectionCount=0)=>({completedQueryCount,unprojectedQueryCount,omittedProjectionCount});
describe('case timeline read projection',()=>{
  it('preserves equal event IDs across queries, offsets, uncertain times and stable replay order',()=>{
    const a=projection('TASK-a',['2026-10-14T17:30:00+07:00',null]),b=projection('TASK-b',['2026-10-14T10:00:00Z']);
    const t=buildCaseTimeline('CASE-fixture',[a,b],coverage());
    expect(t.entries.map(x=>[x.taskId,x.eventId])).toEqual([['TASK-b','event-0'],['TASK-a','event-0'],['TASK-a','event-1']]);
    expect(t.entries[1].rawTimestamp).toBe('2026-10-14T17:30:00+07:00');expect(t.uncertainTimeCount).toBe(1);
    expect(t).toEqual(buildCaseTimeline('CASE-fixture',[b,a],coverage()));
    expect(t.sources.every(x=>x.sourceKind==='CHRONICLE_UNATTESTED')).toBe(true);
  });
  it('counts both per-query omission and case display limits, including unknown query coverage',()=>{
    const a=projection('TASK-a',['2026-10-14T10:00:00Z',null,null],1),b=projection('TASK-b',[null]);
    const t=buildCaseTimeline('CASE-fixture',[a,b],coverage(5,1,2),1);
    expect(t).toMatchObject({partial:true,inputEventCount:4,omittedEventCount:3,uncertainTimeCount:3,unprojectedQueryCount:1,omittedProjectionCount:2});
    expect(t.entries).toHaveLength(1);
  });
  it('accepts JSONB-style key reordering but rejects mutation, cross-case and duplicate task projections',()=>{
    const a=projection('TASK-a',[null]);
    const reordered=Object.fromEntries(Object.entries(a).reverse());expect(isEvidenceTimeline(reordered)).toBe(true);
    expect(()=>buildCaseTimeline('OTHER',[a],coverage(1))).toThrow('provenance');
    expect(()=>buildCaseTimeline('CASE-fixture',[a,a],coverage())).toThrow('provenance');
    const mutated=structuredClone(a);mutated.entries[0].eventId='invented';expect(isEvidenceTimeline(mutated)).toBe(false);
    const malformed={...a,uncertainTimeCount:0};const {projectionHash:_,...body}=malformed;
    expect(isEvidenceTimeline({...malformed,projectionHash:sha256Canonical(body)})).toBe(false);
  });
  it('does not manufacture events for empty results and enforces bounded inputs',()=>{
    const t=buildCaseTimeline('CASE-fixture',[],coverage(0));expect(t.entries).toEqual([]);expect(t.sources).toEqual([]);
    expect(()=>buildCaseTimeline('CASE-fixture',[],coverage(1))).toThrow('bounds');
    expect(()=>buildCaseTimeline('CASE-fixture',[],coverage(0),201)).toThrow('bounds');
  });
});
