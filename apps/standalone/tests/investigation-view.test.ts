import {describe,it,expect} from 'vitest';
import {investigationView} from '../lib/investigation-view';
function snapshot() {
  const run={schemaVersion:'gss.investigation-run.v1',runId:'RUN-fixture',caseId:'CASE-fixture',state:'BLOCKED',frontierVersion:1,depth:1,
    policyVersion:'gss.soc-evidence.v1',budget:{maxDepth:3,maxExternalQueries:3,maxCostMicros:0,deadlineAt:'2026-10-10T12:00:00Z'},
    usage:{externalQueries:1,costMicros:0}};
  const frontier={schemaVersion:'gss.evidence-frontier.v1',runId:run.runId,caseId:run.caseId,version:1,updatedAt:'2026-10-10T11:00:00Z',
    facts:[{factId:'FACT-one',key:'fixture',value:'REPLAY only',semanticType:'FACT',provenance:[{taskId:'TASK-fixture',
      evidenceRef:'EVIDENCE-fixture',source:'REPLAY',observedAt:'2026-10-10T10:00:00Z',artifactHash:'a'.repeat(64)}]}],
    contradictions:[],evidenceRefs:['EVIDENCE-fixture'],sourceObservationIds:['OBS-fixture']};
  return {run,frontier};
}
describe('read-only investigation display boundary',()=>{
  it('accepts retained metadata without inventing a hypothesis',()=>{
    const value=investigationView(snapshot(),'CASE-fixture');expect(value.hypothesisPlan).toBeUndefined();expect(value.frontier.facts).toHaveLength(1);
  });
  it('rejects case/version mismatch and dangling provenance',()=>{
    expect(()=>investigationView(snapshot(),'OTHER')).toThrow();
    const wrong=snapshot();wrong.frontier.version=2;expect(()=>investigationView(wrong,'CASE-fixture')).toThrow();
    const dangling=snapshot();dangling.frontier.facts[0].provenance[0].evidenceRef='NOT-RETAINED';expect(()=>investigationView(dangling,'CASE-fixture')).toThrow();
  });
  it('rejects malformed budgets, duplicate fact IDs and impossible contradiction references',()=>{
    const budget=snapshot();budget.run.usage.externalQueries=-1;expect(()=>investigationView(budget,'CASE-fixture')).toThrow();
    const duplicate=snapshot();duplicate.frontier.facts.push(duplicate.frontier.facts[0]);expect(()=>investigationView(duplicate,'CASE-fixture')).toThrow();
    expect(()=>investigationView({...snapshot(),frontier:{...snapshot().frontier,contradictions:[{contradictionId:'CON-one',key:'fixture',factIds:['FACT-one','MISSING']}] }},'CASE-fixture')).toThrow();
  });
  it('rejects malformed plan instead of dropping it and implying success',()=>{
    expect(()=>investigationView({...snapshot(),hypothesisPlan:{schemaVersion:'gss.hypothesis-plan.v1'}},'CASE-fixture')).toThrow();
  });
  it('validates optional coverage while retaining compatibility with earlier plan receipts',()=>{
    const s=snapshot(),plan={schemaVersion:'gss.hypothesis-plan.v1',planId:'HPLAN-fixture',caseId:s.run.caseId,runId:s.run.runId,policyVersion:s.run.policyVersion,frontierVersion:1,
      hypotheses:[{hypothesisId:'HYPO-fixture',statement:'Fixture only',status:'INSUFFICIENT_EVIDENCE',gap:'MISSING',factIds:[],evidenceIds:[]}],
      selectedQuestionId:null,selectedFactIds:[],selectedEvidenceIds:[],decision:{schemaVersion:'gss.next-step.v1',decisionId:'DEC-fixture',caseId:s.run.caseId,runId:s.run.runId,
        policyVersion:s.run.policyVersion,frontierVersion:1,kind:'BLOCKED',reasonCode:'NO_SAFE_EVIDENCE_QUESTION',rationale:'Fixture only',createdAt:'2026-10-10T11:00:00Z'}};
    expect(investigationView({...s,hypothesisPlan:plan},s.run.caseId).hypothesisPlan).toBeDefined();
    const coverage={schemaVersion:'gss.hypothesis-coverage.v1',scope:'ALLOWLISTED_STRUCTURED_FIELDS_ONLY',discoveredIndicators:20,evaluatedIndicators:16,
      omittedIndicators:4,partialExtractionEvidenceIds:['EVIDENCE-fixture'],limitations:['CANDIDATE_LIMIT','PARTIAL_EXTRACTION']};
    expect(investigationView({...s,hypothesisPlan:{...plan,coverage}},s.run.caseId).hypothesisPlan?.coverage?.omittedIndicators).toBe(4);
    expect(()=>investigationView({...s,hypothesisPlan:{...plan,coverage:{...coverage,omittedIndicators:0}}},s.run.caseId)).toThrow('coverage');
    expect(()=>investigationView({...s,hypothesisPlan:{...plan,coverage:{...coverage,partialExtractionEvidenceIds:['MISSING']}}},s.run.caseId)).toThrow('coverage');
  });
});
