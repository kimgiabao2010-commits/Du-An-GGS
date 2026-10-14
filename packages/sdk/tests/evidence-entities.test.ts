import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {buildEvidenceEntities,isEvidenceEntities,buildCaseEntities,type InvestigationEvidence} from '../src/index.js';
const evidence=(events:Record<string,unknown>[],taskId='fixture-task'):InvestigationEvidence=>({evidenceId:'fixture-'+taskId,incidentId:'fixture-case',taskId,
  eventIds:events.map((_,i)=>'event-'+i),events,provenance:{adapter:'google-chronicle',adapterVersion:'v1',queryHash:'a'.repeat(64),
    sourceInstance:'CONTRACT_FIXTURE_NOT_LIVE',queriedAt:'2026-10-14T04:00:00Z',timeRange:{start:'2026-10-14T02:00:00Z',end:'2026-10-14T03:00:00Z'},
    resultCount:events.length,truncated:false,redaction:'ALLOWLISTED_FIELDS_ONLY'}});
const hash=(e:InvestigationEvidence)=>createHash('sha256').update(JSON.stringify(e)).digest('hex');
const projection=(e:InvestigationEvidence)=>buildEvidenceEntities(e,hash(e));
describe('authority entity co-observation, not identity/causation',()=>{
  it('keeps entity roles and event lineage separate across events and repeated IDs in different queries',()=>{
    const events=[{principal:{ip:['203.0.113.1'],user:{userid:'alice'}},target:{ip:['203.0.113.2']},metadata:{event_timestamp:'2026-10-14T10:00:00+07:00'}},
      {principal:{ip:['203.0.113.3'],user:{userid:'bob'}},target:{ip:['203.0.113.2']}}];
    const first=projection(evidence(events)),second=projection(evidence(events,'other-task'));
    expect(first.events[0].mentions.map(x=>x.value)).toEqual(['203.0.113.1','alice','203.0.113.2']);
    expect(first.events[1].mentions.some(x=>x.value==='alice')).toBe(false);
    expect(first.events[0]).toMatchObject({relationship:'CO_OBSERVED_ONLY',rawTimestamp:'2026-10-14T10:00:00+07:00'});
    expect(first.events[1].timeStatus).toBe('MISSING');
    expect(first.events[0].mentions.at(-1)?.valueKey).toBe(first.events[1].mentions.at(-1)?.valueKey);
    const merged=buildCaseEntities('fixture-case',[first,second],{completedQueryCount:2,unprojectedQueryCount:0,omittedProjectionCount:0});
    expect(merged.entries).toHaveLength(4);expect(merged.entries.filter(e=>e.eventId==='event-0')).toHaveLength(2);
    expect(merged.comparison).toBe('EXACT_TYPED_VALUE_WITHIN_SOURCE_ONLY');expect(isEvidenceEntities(JSON.parse(JSON.stringify(first)))).toBe(true);
  });
  it('never extracts model prose, deduplicates only identical field/value mentions and discloses limits',()=>{
    const e=evidence([{principal:{ip:['203.0.113.1','203.0.113.1','invalid'],user:{userid:'alice'}},
      target:{ip:['203.0.113.1']},summary:'LLM claims 192.0.2.1',network:{dns:{questions:Array.from({length:22},(_,i)=>({name:`ioc${i}.example`}))}}},{}]);
    const p=buildEvidenceEntities(e,hash(e),1,2);
    expect(p).toMatchObject({omittedCount:1,truncated:true,invalidParsedValues:1,limits:{fieldArrays:true,totalMentions:true}});
    expect(p.events[0].mentions).toHaveLength(2);expect(p.omittedParsedMentions).toBeGreaterThan(0);
    expect(p.events[0].mentions.some(x=>x.value==='192.0.2.1')).toBe(false);
  });
  it('rejects hash/lineage mutation, dangling field roles and cross-case projections; zero results stay empty',()=>{
    const e=evidence([{principal:{ip:['203.0.113.1']}}]),p=projection(e);
    expect(()=>buildEvidenceEntities(e,'0'.repeat(64))).toThrow('hash');
    expect(isEvidenceEntities({...p,events:[{...p.events[0],mentions:[{...p.events[0].mentions[0],field:'model.summary'}]}]})).toBe(false);
    expect(isEvidenceEntities({...p,artifactHash:'b'.repeat(64)})).toBe(false);
    expect(()=>buildCaseEntities('other-case',[p],{completedQueryCount:1,unprojectedQueryCount:0,omittedProjectionCount:0})).toThrow();
    expect(projection(evidence([])).events).toEqual([]);
    expect(buildCaseEntities('fixture-case',[],{completedQueryCount:1,unprojectedQueryCount:1,omittedProjectionCount:0})).toMatchObject({partial:true,entries:[]});
  });
  it('bounds aggregate events/mentions and preserves omitted counts across source hashes',()=>{
    const p=projection(evidence(Array.from({length:200},()=>({principal:{ip:['203.0.113.1','203.0.113.2','203.0.113.3']}}))));
    const second=projection(evidence(Array.from({length:200},()=>({target:{ip:['203.0.113.4']}})),'other-task'));
    const c=buildCaseEntities('fixture-case',[p,second],{completedQueryCount:3,unprojectedQueryCount:0,omittedProjectionCount:1});
    expect(c.entries).toHaveLength(200);expect(c.entries.reduce((n,e)=>n+e.mentions.length,0)).toBeLessThanOrEqual(500);
    expect(c.omittedEventCount).toBe(200);expect(c.partial).toBe(true);expect(c.omittedParsedMentionCount).toBeGreaterThan(0);
  });
});
