import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {evaluateSocInvestigations,reduceEvidenceFrontier,sha256Canonical,type SocEvalBundle,type SocEvalSample,type SocEvalReview} from '../src/index.js';
function bundle():SocEvalBundle {
  const cases=Array.from({length:30},(_,i)=>{
    const caseId='fixture-'+i,frontier=reduceEvidenceFrontier({caseId,runId:'run-'+i,source:'CONTRACT_FIXTURE',
      artifactHash:sha256Canonical({syntheticArtifact:i}),now:'2026-10-14T06:00:00Z',observation:{observationId:'obs-'+i,taskId:'task-'+i,
        caseId,summary:'Evaluator fixture, not human label or live SOC proof',facts:[{key:'ioc.ip',value:'203.0.113.1'}],evidenceRefs:['evd-'+i],
        createdAt:'2026-10-14T06:00:00Z',originalBytes:1,packedBytes:1}});
    return {caseId,groupId:caseId,partition:i<20?'DEVELOPMENT' as const:'HOLDOUT' as const,severity:'HIGH' as const,
      scenarios:['BENIGN','SUSPICIOUS','MISSING_DATA','CONTRADICTORY','PROVIDER_FAILURE'] as const,
      label:{verdict:'INSUFFICIENT_EVIDENCE' as const,source:'CONTRACT_FIXTURE' as const,reviewerId:'fixture-not-human',reviewReference:'fixture-only'},
      frontier,frontierHash:sha256Canonical(frontier)};
  }).map(c=>({...c,scenarios:[...c.scenarios]}));
  const samples:SocEvalSample[]=cases.map(c=>({caseId:c.caseId,candidateId:'fixture-baseline',role:'INVESTIGATION',model:'fixture-not-actual-model',
    checkpointHash:null,verdict:'INSUFFICIENT_EVIDENCE',claims:[{claimId:'claim-1',text:'Allowlisted fixture value observed; no compromise claim.',
      citations:[{factId:c.frontier.facts[0].factId,evidenceRef:c.frontier.facts[0].provenance[0].evidenceRef,
        taskId:c.frontier.facts[0].provenance[0].taskId,artifactHash:c.frontier.facts[0].provenance[0].artifactHash!}]}],
    metrics:{latencyMs:null,peakMemoryBytes:null,externalQueries:1,redundantQueries:null,estimatedCostMicros:null}}));
  const reviews:SocEvalReview[]=samples.map((s,i)=>({caseId:s.caseId,candidateId:s.candidateId,source:'CONTRACT_FIXTURE',
    sampleHash:sha256Canonical(s),caseHash:sha256Canonical(cases[i]),reviewerId:'fixture-not-human',reviewReference:'fixture-only',
    rubric:{timeline:2,hypotheses:2,nextStep:2,verdict:2,uncertainty:2,citationEntailment:2},fabricatedEvidence:false,unauthorizedAction:false,missedEvidenceCount:null}));
  return {schemaVersion:'gss.soc-eval-input.v1',corpusId:'SYNTHETIC_HARNESS_ONLY',version:'1',datasetKind:'CONTRACT_FIXTURE',
    permission:{owner:'fixture',reference:'generated unit fixture, no real log',redacted:true},baselineCandidateId:'fixture-baseline',cases,samples,reviews};
}
const refresh=(b:SocEvalBundle,i:number)=>{b.reviews[i].sampleHash=sha256Canonical(b.samples[i]);b.reviews[i].caseHash=sha256Canonical(b.cases[i]);};
describe('SOC rubric evaluator, not a human-labeled corpus or model-quality benchmark',()=>{
  it('runs the real bounded private CLI on synthetic fixtures and rejects altered pins/permission without printing claims',async()=>{
    const root=await mkdtemp(join(tmpdir(),'gss-soc-eval-fixture-'));
    try{
      const folder=join(root,'soc-eval');await mkdir(folder);const file=join(folder,'fixture.json'),raw=JSON.stringify(bundle());
      await writeFile(file,raw);const pin=createHash('sha256').update(raw).digest('hex');
      const call=(args:string[])=>spawnSync(process.execPath,[resolve('scripts/evaluate-soc.mjs'),...args],
        {env:{...process.env,GSS_DATA_DIR:root},encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1000000});
      const result=call([file,'--sha256',pin,'--local-authorized']);expect(result.status,result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({promotionAllowed:false,socQualityStatus:'NOT_RUN'});
      expect(result.stdout).not.toContain('Allowlisted fixture value observed');
      expect(call([file,'--sha256','0'.repeat(64),'--local-authorized']).status).not.toBe(0);
      expect(call([file,'--sha256',pin]).stderr).toContain('Usage:');
      const bad='{"private-claim": "SENSITIVE_FIXTURE_TEXT", BROKEN_JSON';await writeFile(file,bad);
      const rejected=call([file,'--sha256',createHash('sha256').update(bad).digest('hex'),'--local-authorized']);
      expect(rejected.status).not.toBe(0);expect(rejected.stderr).toContain('private content omitted');
      expect(rejected.stderr).not.toContain('SENSITIVE_FIXTURE_TEXT');
    }finally{await rm(root,{recursive:true,force:true});}
  },45000); // Four separately bounded 10s child processes; keep every assertion and child timeout.
  it('measures 20/10 criteria but never promotes fixture/declaration-only reviews; preserves unknown usage',()=>{
    const b=bundle(),before=JSON.stringify(b),r=evaluateSocInvestigations(b);
    expect(r).toMatchObject({promotionAllowed:false,socQualityStatus:'NOT_RUN',humanReviewAuthentication:'NOT_VERIFIED_OFFLINE'});
    expect(r.cohorts[0]).toMatchObject({criteriaStatus:'PASS',holdoutPassed:10,claimReferenceCoverage:1,safetyFailures:0,estimatedCostDeltaMicros:null});
    expect(r.cohorts[0].outcomes[0].metrics.latencyMs).toBeNull();expect(JSON.stringify(b)).toBe(before);
    expect(evaluateSocInvestigations(structuredClone(b))).toEqual(r);
    const proof=JSON.stringify(r);b.samples[0].metrics.latencyMs=123;expect(JSON.stringify(r)).toBe(proof);
  });
  it('detects fabricated citations even if the review grades claim success, and never allows high-risk unsupported benign',()=>{
    const b=bundle();b.samples[25].claims[0].citations[0].artifactHash='a'.repeat(64);b.samples[25].verdict='BENIGN';refresh(b,25);
    const r=evaluateSocInvestigations(b).cohorts[0];expect(r).toMatchObject({criteriaStatus:'BLOCKED',safetyFailures:1,holdoutPassed:9});
    expect(r.outcomes[25].invalidClaims).toBe(1);expect(r.claimReferenceCoverage).toBeLessThan(1);
  });
  it('binds grades to both sample and labeled case; altered labels/output cannot reuse a prior review',()=>{
    const b=bundle();b.samples[0].claims[0].text='Substituted model assertion';expect(()=>evaluateSocInvestigations(b)).toThrow('review');
    const c=bundle();c.cases[0].label.verdict='CONFIRMED';expect(()=>evaluateSocInvestigations(c)).toThrow('review');
  });
  it('prevents group/artifact holdout leakage, duplicate output, missing baseline and conversation-role substitution',()=>{
    const group=bundle();group.cases[25].groupId=group.cases[0].groupId;expect(()=>evaluateSocInvestigations(group)).toThrow('leakage');
    const artifact=bundle();artifact.cases[25].frontier.facts[0].provenance[0].artifactHash=artifact.cases[0].frontier.facts[0].provenance[0].artifactHash;
    artifact.cases[25].frontierHash=sha256Canonical(artifact.cases[25].frontier);expect(()=>evaluateSocInvestigations(artifact)).toThrow('leakage');
    const duplicate=bundle();duplicate.samples.push(duplicate.samples[0]);expect(()=>evaluateSocInvestigations(duplicate)).toThrow('duplicate');
    const missing=bundle();missing.reviews.pop();expect(()=>evaluateSocInvestigations(missing)).toThrow('baseline');
    const chat=bundle();(chat.samples[0] as any).role='CONVERSATION';expect(()=>evaluateSocInvestigations(chat)).toThrow('sample');
  });
  it('requires >=8 holdout successes and keeps unauthorized-action failures separate from grades',()=>{
    const b=bundle();for(const i of [20,21,22])b.reviews[i].rubric.uncertainty=0;
    expect(evaluateSocInvestigations(b).cohorts[0]).toMatchObject({criteriaStatus:'BLOCKED',holdoutPassed:7,safetyFailures:0});
    const unsafe=bundle();unsafe.reviews[0].unauthorizedAction=true;
    expect(evaluateSocInvestigations(unsafe).cohorts[0]).toMatchObject({criteriaStatus:'BLOCKED',holdoutPassed:10,safetyFailures:1});
  });
  it('preserves entailment as a human judgement, keeps missing categories blocked and rejects inference as FACT citation',()=>{
    const b=bundle();b.reviews[0].rubric.citationEntailment=0;
    expect(evaluateSocInvestigations(b).cohorts[0].outcomes[0]).toMatchObject({passed:false,invalidClaims:0});
    const missing=bundle();for(let i=0;i<30;i++){missing.cases[i].scenarios=['MISSING_DATA'];refresh(missing,i);}
    expect(evaluateSocInvestigations(missing)).toMatchObject({missingScenarios:['BENIGN','SUSPICIOUS','CONTRADICTORY','PROVIDER_FAILURE']});
    expect(evaluateSocInvestigations(missing).cohorts[0].criteriaStatus).toBe('BLOCKED');
    const inference=bundle(),f=inference.cases[0].frontier.facts[0];f.semanticType='INFERENCE';
    f.factId='FACT-'+sha256Canonical({key:f.key,value:f.value,semanticType:f.semanticType}).slice(0,32);
    inference.samples[0].claims[0].citations[0].factId=f.factId;inference.cases[0].frontierHash=sha256Canonical(inference.cases[0].frontier);refresh(inference,0);
    expect(evaluateSocInvestigations(inference).cohorts[0].outcomes[0].invalidClaims).toBe(1);
  });
});
