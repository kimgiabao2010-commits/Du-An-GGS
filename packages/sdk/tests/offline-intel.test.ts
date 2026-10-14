import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {annotateOfflineIntel,isOfflineIntelCatalog,buildCaseEntities,buildEvidenceEntities,type OfflineIntelCatalog,type InvestigationEvidence} from '../src/index.js';
export const fixtureCatalog=():OfflineIntelCatalog=>({schemaVersion:'gss.offline-intel-catalog.v1',catalogId:'REPLAY-FIXTURE-NOT-THREAT-FEED',version:'fixture-v1',
  sourceUrl:'https://fixture.example/source',license:{identifier:'FIXTURE_ONLY_NOT_LICENSE_APPROVAL',url:'https://fixture.example/license'},
  review:{owner:'fixture-owner-not-human-review',reviewedAt:'2026-10-14T05:00:00Z',authorization:'APPROVED_FOR_OFFLINE_LOCAL_USE'},
  updatedAt:'2026-10-14T04:00:00Z',expiresAt:'2026-10-15T04:00:00Z',
  entries:[{recordId:'fixture-ip',type:'IP',value:'203.0.113.1',classification:'REPORTED_MALICIOUS',referenceUrl:'https://fixture.example/record'}]});
function entities(n=1){
  const e:InvestigationEvidence={evidenceId:'evd-fixture',incidentId:'case-fixture',taskId:'task-fixture',
    eventIds:Array.from({length:n},(_,i)=>'fixture-'+i),events:Array.from({length:n},()=>({principal:{ip:['203.0.113.1']},target:{ip:['203.0.113.2']}})),
    provenance:{adapter:'google-chronicle',adapterVersion:'v1',queryHash:'a'.repeat(64),sourceInstance:'CONTRACT_FIXTURE_NOT_LIVE',
      queriedAt:'2026-10-14T05:00:00Z',timeRange:{start:'2026-10-14T04:00:00Z',end:'2026-10-14T05:00:00Z'},resultCount:n,truncated:false,redaction:'ALLOWLISTED_FIELDS_ONLY'}};
  return buildCaseEntities(e.incidentId,[buildEvidenceEntities(e,createHash('sha256').update(JSON.stringify(e)).digest('hex'))],
    {completedQueryCount:1,unprojectedQueryCount:0,omittedProjectionCount:0});
}
describe('offline intel annotations, fixtures not source/license or SOC quality evidence',()=>{
  it('matches exact typed values with event lineage, no network/facts/verdict and deterministic hash',()=>{
    const e=entities(),before=JSON.stringify(e),c=fixtureCatalog(),r=annotateOfflineIntel(e,c,'2026-10-14T06:00:00Z');
    expect(r).toMatchObject({status:'AVAILABLE',matchCount:1,omittedMatchCount:0,entitySnapshotHash:e.snapshotHash,
      matches:[{eventId:'fixture-0',field:'principal.ip',taskId:'task-fixture',evidenceId:'evd-fixture',recordId:'fixture-ip'}]});
    expect(r.matches[0].classification).toBe('REPORTED_MALICIOUS');expect(r).not.toHaveProperty('verdict');expect(r).not.toHaveProperty('facts');
    expect(annotateOfflineIntel(e,structuredClone(c),'2026-10-14T06:00:00Z')).toEqual(r);expect(JSON.stringify(e)).toBe(before);
  });
  it('expired, unconfigured, not-yet-reviewed and zero-match results never imply benign',()=>{
    const e=entities(),c=fixtureCatalog();
    for(const [catalog,now,status] of [[undefined,'2026-10-14T06:00:00Z','NOT_CONFIGURED'],[c,c.expiresAt,'EXPIRED'],
      [c,'2026-10-14T04:30:00Z','NOT_YET_VALID']] as const){
      const r=annotateOfflineIntel(e,catalog,now);expect(r.status).toBe(status);expect(r.matches).toEqual([]);expect(r.matchCount).toBe(0);
    }
    c.entries[0].value='203.0.113.99';expect(annotateOfflineIntel(e,c,'2026-10-14T06:00:00Z').matches).toEqual([]);
  });
  it('preserves conflicting feed classifications and truncation instead of resolving truth',()=>{
    const c=fixtureCatalog();c.entries.push({...c.entries[0],recordId:'opposite',classification:'REPORTED_BENIGN'});
    const r=annotateOfflineIntel(entities(200),c,'2026-10-14T06:00:00Z');
    expect(r.matchCount).toBe(400);expect(r.matches).toHaveLength(200);expect(r.omittedMatchCount).toBe(200);
    expect(new Set(r.matches.map(m=>m.classification)).size).toBe(2);
  });
  it('rejects missing permission/license, embedded credentials, overbounds, duplicate IDs and damaged evidence',()=>{
    for(const mutate of [(c:OfflineIntelCatalog)=>{c.license.identifier='';},(c:OfflineIntelCatalog)=>{c.review.authorization='fake' as any;},
      (c:OfflineIntelCatalog)=>{c.sourceUrl='https://secret:password@fixture.example/';},
      (c:OfflineIntelCatalog)=>{c.entries.push(c.entries[0]);},(c:OfflineIntelCatalog)=>{c.entries[0].type='USER' as any;},
      (c:OfflineIntelCatalog)=>{(c as any).secret='must-never-be-copied-to-report';},
      (c:OfflineIntelCatalog)=>{(c.entries[0] as any).instructions='model text has no schema authority';},
      (c:OfflineIntelCatalog)=>{c.expiresAt='2030-01-01T00:00:00Z';}]){
      const c=fixtureCatalog();mutate(c);expect(isOfflineIntelCatalog(c)).toBe(false);
    }
    const e=entities();e.entries[0].mentions[0].value='192.0.2.1';expect(()=>annotateOfflineIntel(e,fixtureCatalog(),'2026-10-14T06:00:00Z')).toThrow();
  });
});
