import {describe,it,expect} from 'vitest';
import {correlateEvidence,VERDICT_POLICY_VERSION,type InvestigationEvidence} from '../src/index.js';
function evidence(events:Record<string,unknown>[]):InvestigationEvidence {
  return {evidenceId:'EVD-fixture',incidentId:'CASE-fixture',taskId:'TASK-fixture',eventIds:events.map((_,i)=>'fixture-event-'+i),events,
    provenance:{adapter:'google-chronicle',adapterVersion:'v1',queryHash:'a'.repeat(64),sourceInstance:'REPLAY_CONTRACT_FIXTURE_NOT_LIVE',queriedAt:'2026-10-10T13:00:00Z',
      timeRange:{start:'2026-10-10T12:00:00Z',end:'2026-10-10T13:00:00Z'},resultCount:events.length,truncated:false,redaction:'ALLOWLISTED_FIELDS_ONLY'}};
}
describe('conservative verdict v2; provider severity is not SOC confirmation',()=>{
  it('never confirms duplicate high findings in one event plus unrelated telemetry',()=>{
    const e=evidence([{security_result:[{severity:'HIGH'},{severity:'CRITICAL'}]},{metadata:{event_type:'OTHER'}}]);
    expect(correlateEvidence(e)).toMatchObject({verdict:'SUSPICIOUS',policyVersion:VERDICT_POLICY_VERSION,evidenceIds:[e.evidenceId]});
  });
  it('never confirms even distinct high-severity provider events without reviewed compromise rules',()=>{
    expect(correlateEvidence(evidence([{security_result:[{severity:'HIGH'}]},{security_result:[{severity:'HIGH'}]}])).verdict).toBe('SUSPICIOUS');
  });
  it.each([false,true])('does not infer benign from ALLOW/LOW or incomplete results (truncated=%s)',truncated=>{
    const e=evidence([{security_result:[{severity:'LOW',action:'ALLOW'}]},{}]);e.provenance.truncated=truncated;
    const v=correlateEvidence(e);expect(v.verdict).toBe('INSUFFICIENT_EVIDENCE');if(truncated)expect(v.rationale).toContain('truncated');
  });
  it('zero/missing findings are insufficient and array-shaped severity cannot escalate',()=>{
    expect(correlateEvidence(evidence([])).verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(correlateEvidence(evidence([{security_result:[{severity:['HIGH']}]}])).verdict).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('rejects missing/duplicate lineage and malformed provenance before producing a verdict',()=>{
    const e=evidence([{},{}]);expect(()=>correlateEvidence({...e,eventIds:['same','same']})).toThrow();
    expect(()=>correlateEvidence({...e,eventIds:['only-one']})).toThrow();
    expect(()=>correlateEvidence({...e,provenance:{...e.provenance,queryHash:'invalid'}})).toThrow();
  });
});
