import {describe,it,expect} from 'vitest';
import {HypothesisPlanner,actionFingerprint,sha256Canonical,reduceEvidenceFrontier,type EvidenceCandidate,type InvestigationRun} from '../src/index.js';
const now='2026-10-10T12:00:00Z',hash='a'.repeat(64);
const run=():InvestigationRun=>({schemaVersion:'gss.investigation-run.v1',runId:'run-1',caseId:'case-1',state:'ACTIVE',
  frontierVersion:0,depth:0,policyVersion:'soc-policy-v1',budget:{maxDepth:3,maxCostMicros:100,maxExternalQueries:3,deadlineAt:'2026-10-10T13:00:00Z'},
  usage:{externalQueries:0,costMicros:0},createdAt:now,updatedAt:now});
const frontier=(values=[{key:'ioc.ip',value:'203.0.113.9'}])=>reduceEvidenceFrontier({runId:'run-1',caseId:'case-1',source:'REPLAY:fixture',artifactHash:hash,now,
  observation:{observationId:'obs-1',caseId:'case-1',taskId:'task-1',summary:'Fixture, not live telemetry',facts:values,evidenceRefs:['evidence-1'],createdAt:now,originalBytes:100,packedBytes:100}});
const planner=()=>new HypothesisPlanner([{ruleId:'ioc-activity',statement:'Activity for the declared IOC is recorded; not proof of compromise',evidenceKey:'ioc.activity',supportsValue:'true',refutesValue:'false'}],'hypotheses-v1');
const candidate=(factId:string):EvidenceCandidate=>({questionId:'query-ioc',hypothesisId:'ioc-activity',suppliesKey:'ioc.activity',supportingFactIds:[factId],
  action:{target:'siem',action:'search_siem',riskLevel:'read_only',parameters:{indicatorType:'IP',indicatorValue:'203.0.113.9',startTime:'2026-10-10T11:00:00Z',endTime:now,limit:10}}});
function input(f=frontier()) {return {run:run(),frontier:f,now,availableActions:['siem:search_siem'],candidates:[candidate((f.facts.find(x=>x.key==='ioc.ip') ?? f.facts[0]).factId)]};}
describe('deterministic evidence-first hypothesis policy foundation',()=>{
  it('selects one bounded evidence gap and cites only persisted facts/evidence',()=>{
    const p=planner().plan(input());expect(p.decision.kind).toBe('DISPATCH');expect(p.selectedQuestionId).toBe('query-ioc');
    expect(p.selectedFactIds).toEqual([input().frontier.facts[0].factId]);expect(p.selectedEvidenceIds).toEqual(['evidence-1']);
    expect(p.hypotheses[0]).toMatchObject({status:'INSUFFICIENT_EVIDENCE',gap:'MISSING',factIds:[],evidenceIds:[]});
  });
  it('new relevant evidence changes assessment and stops that question; neither outcome is a SOC verdict',()=>{
    for(const [value,status] of [['true','SUPPORTED'],['false','REFUTED']]) {
      const p=planner().plan(input(frontier([{key:'ioc.activity',value}])));
      expect(p.hypotheses[0]).toMatchObject({status,gap:null,evidenceIds:['evidence-1']});
      expect(p.decision.kind).toBe('BLOCKED');expect(p.selectedQuestionId).toBeNull();
    }
  });
  it('preserves contradictory facts and selects clarification rather than a confidence/compromise claim',()=>{
    const f=frontier([{key:'ioc.activity',value:'true'},{key:'ioc.activity',value:'false'},{key:'ioc.ip',value:'203.0.113.9'}]),p=planner().plan(input(f));
    expect(p.hypotheses[0].gap).toBe('CONTRADICTORY');expect(p.hypotheses[0].factIds).toHaveLength(2);expect(f.contradictions).toHaveLength(1);
    expect(p.decision.kind).toBe('DISPATCH');
  });
  it('rejects fabricated references, noncanonical hashes and future provenance',()=>{
    const f=frontier();expect(()=>planner().plan({...input(f),candidates:[{...candidate(f.facts[0].factId),supportingFactIds:['fabricated']}]})).toThrow();
    f.facts[0].provenance[0].artifactHash='fake';expect(()=>planner().plan(input(f))).toThrow('provenance');
    const future=frontier();future.facts[0].provenance[0].observedAt='2026-10-11T00:00:00Z';expect(()=>planner().plan(input(future))).toThrow();
  });
  it('never uses model inference as a factual prerequisite',()=>{
    const f=frontier();f.facts[0].semanticType='INFERENCE';
    f.facts[0].factId='FACT-'+sha256Canonical({key:f.facts[0].key,value:f.facts[0].value,semanticType:'INFERENCE'}).slice(0,32);
    expect(planner().plan(input(f)).decision.kind).toBe('BLOCKED');
  });
  it('does not dispatch stale facts, unavailable/mismatched capabilities or write actions',()=>{
    const i=input();i.frontier.facts[0].provenance[0].observedAt='2026-10-08T00:00:00Z';expect(planner().plan(i).decision.kind).toBe('BLOCKED');
    expect(planner().plan({...input(),availableActions:[]}).decision.kind).toBe('BLOCKED');
    const wrong=input();wrong.candidates[0].action.target='cli';expect(planner().plan(wrong).decision.kind).toBe('BLOCKED');
    const write=input();write.candidates[0].action.riskLevel='approval_required';expect(planner().plan(write).decision.kind).toBe('BLOCKED');
  });
  it('repeat/no-progress questions cannot bypass fingerprint or budget/depth/time gate',()=>{
    const i=input();expect(planner().plan({...i,previousActionFingerprints:[actionFingerprint(i.candidates[0].action)]}).decision.kind).toBe('BLOCKED');
    for(const blocked of [{...run(),depth:3},{...run(),usage:{externalQueries:3,costMicros:0}},{...run(),usage:{externalQueries:0,costMicros:100}}]) {
      expect(planner().plan({...input(),run:blocked}).decision.kind).toBe('BLOCKED');
    }
    expect(planner().plan({...input(),now:'2026-10-10T13:00:00Z'}).decision.reasonCode).toBe('DEADLINE_EXHAUSTED');
  });
  it('reconstruction/replay is deterministic and does not mutate the Frontier',()=>{
    const i=input(),before=JSON.stringify(i.frontier),a=planner().plan(i),b=planner().plan(structuredClone(i));
    expect(b).toEqual(a);expect(JSON.stringify(i.frontier)).toBe(before);
  });
  it('bounds policy/candidate input and rejects missing task evidence lineage',()=>{
    expect(()=>new HypothesisPlanner([],'v1')).toThrow();const f=frontier();f.facts[0].provenance=[];
    expect(()=>planner().plan(input(f))).toThrow();expect(()=>planner().plan({...input(),maxEvidenceAgeMs:0})).toThrow();
  });
  it('rejects a substituted IOC, raw query, invalid IP, unbounded range/limit and unsafe parameter shapes',()=>{
    for(const parameters of [
      {...candidate('unused').action.parameters,indicatorValue:'203.0.113.10'},
      {...candidate('unused').action.parameters,query:'principal.ip = ANY'},
      {...candidate('unused').action.parameters,indicatorValue:'999.0.0.1'},
      {...candidate('unused').action.parameters,startTime:'2026-09-01T00:00:00Z'},
      {...candidate('unused').action.parameters,endTime:'2026-10-11T00:00:00Z'},
      {...candidate('unused').action.parameters,limit:1001},
      {...candidate('unused').action.parameters,indicatorType:'__proto__'},
      {indicator:{type:'IP',value:'203.0.113.9'},timeRange:{start:'2026-10-10T11:00:00Z',end:now},limit:10},
    ]) {
      const i=input();i.candidates[0].action.parameters=parameters;expect(planner().plan(i).decision.kind).toBe('BLOCKED');
    }
  });
  it('rejects stale, skipped or malformed Frontier/run versions, fake fact identity and contradiction lineage',()=>{
    for(const version of [-1,0.5,3]) {const i=input();i.frontier.version=version;expect(()=>planner().plan(i)).toThrow();}
    const stale=input();stale.run.frontierVersion=2;expect(()=>planner().plan(stale)).toThrow();
    const badBudget=input();badBudget.run.budget.deadlineAt='not-a-date';expect(()=>planner().plan(badBudget)).toThrow();
    const badIdentity=input();badIdentity.frontier.facts[0].value='203.0.113.10';expect(()=>planner().plan(badIdentity)).toThrow('provenance');
    const badContradiction=input();badContradiction.frontier.contradictions=[{contradictionId:'c1',key:'ioc.ip',factIds:['fake','fake2']}];
    expect(()=>planner().plan(badContradiction)).toThrow('contradiction');
    const current=input();current.run.frontierVersion=1;expect(planner().plan(current).decision.kind).toBe('DISPATCH');
  });
  it('copies authorized parameters so subsequent candidate mutation cannot invalidate the decision fingerprint',()=>{
    const i=input(),p=planner().plan(i),before=JSON.stringify(p);
    i.candidates[0].action.parameters.indicatorValue='203.0.113.10';
    expect(JSON.stringify(p)).toBe(before);expect(p.decision.action?.fingerprint).toBe(actionFingerprint(p.decision.action!));
  });
  it('denies IDE actions until repository/path parameter authorization is explicitly implemented',()=>{
    const i=input();i.availableActions=['ide:search_code'];i.candidates[0].action={target:'ide',action:'search_code',riskLevel:'read_only',parameters:{path:'../../private'}};
    expect(planner().plan(i).decision.kind).toBe('BLOCKED');
  });
});
