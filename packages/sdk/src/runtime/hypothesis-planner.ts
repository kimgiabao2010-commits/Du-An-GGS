import {validReadOnlyIndicator} from '../investigation/query-template.js';
import { actionFingerprint, canonicalJson, planNextStep, sha256Canonical, type EvidenceFrontier, type FrontierFact,
  type InvestigationRun, type NextStepDecision, type ProposedAction } from './investigation-loop.js';

export const HYPOTHESIS_PLAN_SCHEMA = 'gss.hypothesis-plan.v1' as const;
export interface HypothesisRule {
  ruleId: string;
  // Trusted, versioned policy configuration; never instructions taken from telemetry/model text.
  statement: string;
  evidenceKey: string;
  supportsValue: string;
  refutesValue: string;
}
export interface EvidenceCandidate {
  questionId: string;
  hypothesisId: string;
  suppliesKey: string;
  action: ProposedAction;
  supportingFactIds: string[];
  /** Trusted policy preference only; still subject to provenance, repetition and authority gates. */
  preference?: 'EVENT_COOBSERVATION';
}
export interface HypothesisAssessment {
  hypothesisId: string;
  statement: string;
  status: 'SUPPORTED' | 'REFUTED' | 'INSUFFICIENT_EVIDENCE';
  factIds: string[];
  evidenceIds: string[];
  gap: 'MISSING' | 'STALE' | 'CONTRADICTORY' | 'UNRECOGNIZED_VALUE' | null;
}
export interface HypothesisPlan {
  schemaVersion: typeof HYPOTHESIS_PLAN_SCHEMA;
  planId: string;
  runId: string;
  caseId: string;
  frontierVersion: number;
  policyVersion: string;
  hypotheses: HypothesisAssessment[];
  selectedQuestionId: string | null;
  selectedFactIds: string[];
  selectedEvidenceIds: string[];
  decision: NextStepDecision;
  nextEvidence?: {
    schemaVersion:'gss.next-evidence-selection.v1';
    policyVersion:'gss.soc-priority.v1';
    reason:'EVENT_COOBSERVATION'|'UNRESOLVED_QUERY';
    interpretation:'COLLECTION_PRIORITY_NOT_CAUSALITY_OR_CONFIDENCE';
    partialContext:boolean;
    eventRefs:Array<{eventId:string;sourceIndex:number;projectionHash:string;evidenceId:string;taskId:string;artifactHash:string}>;
  };
  /** Trusted policy processing coverage; not a factual claim about whole-host/tenant visibility. */
  coverage?: {
    schemaVersion: 'gss.hypothesis-coverage.v1';
    scope: 'ALLOWLISTED_STRUCTURED_FIELDS_ONLY';
    discoveredIndicators: number;
    evaluatedIndicators: number;
    omittedIndicators: number;
    partialExtractionEvidenceIds: string[];
    limitations: Array<'CANDIDATE_LIMIT' | 'PARTIAL_EXTRACTION'>;
  };
}
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length>0 && value.length<=max;
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number)>=0;
const record = (value: unknown): value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;
const keys = (value: Record<string,unknown>, allowed: string[]) => Object.keys(value).every(k=>allowed.includes(k));

/** Fail closed until each capability has an explicit parameter policy. No raw query, path or command pass-through. */
function parametersSupported(action: ProposedAction, supporting: FrontierFact[], clock: number): boolean {
  const p=action.parameters;
  if(!record(p)) return false;
  if(action.target==='cli') return Object.keys(p).length===0;
  // Match the actual SIEM worker task contract; nested indicator/timeRange is the adapter request, not task parameters.
  if(action.target!=='siem' || action.action!=='search_siem' || !keys(p,['indicatorType','indicatorValue','startTime','endTime','limit']) ||
    !text(p.indicatorValue,256) || typeof p.indicatorType!=='string' || typeof p.startTime!=='string' || typeof p.endTime!=='string') return false;
  const start=Date.parse(p.startTime),end=Date.parse(p.endTime), indicatorType=p.indicatorType;
  return validReadOnlyIndicator(indicatorType,p.indicatorValue) &&
    Number.isFinite(start) && Number.isFinite(end) && start<end && end<=clock && end-start<=7*86400000 &&
    Number.isSafeInteger(p.limit) && (p.limit as number)>=1 && (p.limit as number)<=1000 &&
    supporting.some(f=>(f.key==='ioc.'+indicatorType.toLowerCase() ||
      f.key==='ioc.'+indicatorType.toLowerCase()+'.'+sha256Canonical({type:indicatorType,value:p.indicatorValue}).slice(0,32)) && f.value===p.indicatorValue);
}

/** Pure policy planner. Produces a proposal through the existing deterministic gate, never facts/dispatch/LLM calls. */
export class HypothesisPlanner {
  private readonly rules: HypothesisRule[];
  public constructor(rules: readonly HypothesisRule[], private readonly policyVersion: string) {
    if (!id(policyVersion) || rules.length<1 || rules.length>16 || new Set(rules.map(r=>r.ruleId)).size!==rules.length ||
      rules.some(r=>!id(r.ruleId) || !id(r.evidenceKey) || !text(r.statement,500) || !text(r.supportsValue,500) ||
        !text(r.refutesValue,500) || r.supportsValue===r.refutesValue)) throw new Error('Invalid trusted hypothesis policy');
    this.rules=rules.map(r=>({...r}));
  }
  public plan(input: {run: InvestigationRun; frontier: EvidenceFrontier; candidates: readonly EvidenceCandidate[];
    availableActions: readonly string[]; previousActionFingerprints?: string[]; now?: string; maxEvidenceAgeMs?: number}): HypothesisPlan {
    const {run,frontier}=input, now=input.now ?? new Date().toISOString(), clock=Date.parse(now);
    const age=input.maxEvidenceAgeMs ?? 86400000;
    if (!Number.isFinite(clock) || !Number.isSafeInteger(age) || age<1 || age>7*86400000 ||
      run.schemaVersion!=='gss.investigation-run.v1' || frontier.schemaVersion!=='gss.evidence-frontier.v1' ||
      !id(run.runId) || !id(run.caseId) || !id(run.policyVersion) ||
      run.runId!==frontier.runId || run.caseId!==frontier.caseId || !count(run.frontierVersion) || !count(frontier.version) ||
      (frontier.version!==run.frontierVersion && frontier.version!==run.frontierVersion+1) ||
      !count(run.depth) || !count(run.budget.maxDepth) || !count(run.budget.maxCostMicros) || !count(run.budget.maxExternalQueries) ||
      !count(run.usage.costMicros) || !count(run.usage.externalQueries) || !Number.isFinite(Date.parse(run.budget.deadlineAt)) ||
      !Array.isArray(frontier.facts) || frontier.facts.length>5000 || !Array.isArray(frontier.evidenceRefs) || frontier.evidenceRefs.length>5000 ||
      frontier.evidenceRefs.some(x=>!text(x,300)) || !Array.isArray(frontier.contradictions) || frontier.contradictions.length>5000 ||
      !Array.isArray(input.candidates) || input.candidates.length>32 || input.availableActions.length>32 ||
      (input.previousActionFingerprints?.length ?? 0)>1000) throw new Error('Invalid bounded hypothesis input');
    const facts=new Map<string,FrontierFact>();
    let contextChars=0, provenanceCount=0;
    for(const f of frontier.facts) {
      if(!id(f.factId) || facts.has(f.factId) || !text(f.key,300) || !text(f.value,32000) ||
        !['FACT','INFERENCE','HYPOTHESIS','UNKNOWN'].includes(f.semanticType) ||
        f.factId!=='FACT-'+sha256Canonical({key:f.key,semanticType:f.semanticType,value:f.value}).slice(0,32) ||
        !Array.isArray(f.provenance) || !f.provenance.length || f.provenance.length>1000 ||
        f.provenance.some(p=>!text(p.taskId,128) || !text(p.source,300) || !frontier.evidenceRefs.includes(p.evidenceRef) ||
          !/^[a-f0-9]{64}$/.test(p.artifactHash ?? '') || !Number.isFinite(Date.parse(p.observedAt)) || Date.parse(p.observedAt)>clock)) {
        throw new Error('Unverified hypothesis fact provenance');
      }
      contextChars+=f.key.length+f.value.length;
      provenanceCount+=f.provenance.length;
      if(contextChars>2_000_000 || provenanceCount>50_000) throw new Error('Hypothesis context budget exceeded');
      facts.set(f.factId,f);
    }
    if(frontier.contradictions.some(c=>!id(c.contradictionId) || !text(c.key,300) || !Array.isArray(c.factIds) ||
      c.factIds.length<2 || c.factIds.length>5000 || new Set(c.factIds).size!==c.factIds.length ||
      c.factIds.some((x:string)=>!facts.has(x) || facts.get(x)!.key!==c.key || facts.get(x)!.semanticType!=='FACT'))) {
      throw new Error('Invalid frontier contradiction references');
    }
    const fresh=(f:FrontierFact)=>f.provenance.some(p=>clock-Date.parse(p.observedAt)<=age);
    const hypotheses=this.rules.map((rule): HypothesisAssessment => {
      const all=frontier.facts.filter(f=>f.semanticType==='FACT' && f.key===rule.evidenceKey), current=all.filter(fresh);
      const values=new Set(current.map(f=>f.value));
      const contradictory=values.size>1 || frontier.contradictions.some(c=>c.key===rule.evidenceKey && c.factIds.some(x=>current.some(f=>f.factId===x)));
      const status=contradictory?'INSUFFICIENT_EVIDENCE':values.has(rule.supportsValue)?'SUPPORTED':values.has(rule.refutesValue)?'REFUTED':'INSUFFICIENT_EVIDENCE';
      return {hypothesisId:rule.ruleId,statement:rule.statement,status,
        factIds:all.map(f=>f.factId).sort(),evidenceIds:[...new Set(all.flatMap(f=>f.provenance.map(p=>p.evidenceRef)))].sort(),
        gap:contradictory?'CONTRADICTORY':!all.length?'MISSING':!current.length?'STALE':status==='INSUFFICIENT_EVIDENCE'?'UNRECOGNIZED_VALUE':null};
    });
    const previous=input.previousActionFingerprints ?? [], questionIds=new Set<string>();
    for(const c of input.candidates) {
      if(!id(c.questionId) || questionIds.has(c.questionId) || !id(c.hypothesisId) || !id(c.suppliesKey) || !Array.isArray(c.supportingFactIds) ||
        !c.supportingFactIds.length || c.supportingFactIds.length>32 || new Set(c.supportingFactIds).size!==c.supportingFactIds.length ||
        c.supportingFactIds.some((x:string)=>!facts.has(x)) || !c.action ||
        (c.preference!==undefined && c.preference!=='EVENT_COOBSERVATION')) throw new Error('Invalid evidence question');
      questionIds.add(c.questionId);
    }
    const gaps=hypotheses.filter(h=>h.status==='INSUFFICIENT_EVIDENCE');
    const safePairs=new Set(['siem:search_siem','ide:search_code','ide:analyze_code','cli:inspect_hostname','cli:inspect_system',
      'cli:inspect_network_config','cli:inspect_network_connections']);
    const candidates=input.candidates.filter(c=>{
      const h=gaps.find(h=>h.hypothesisId===c.hypothesisId),rule=this.rules.find(r=>r.ruleId===c.hypothesisId);
      return !!h && rule?.evidenceKey===c.suppliesKey && c.action.riskLevel==='read_only' &&
        safePairs.has(c.action.target+':'+c.action.action) && input.availableActions.includes(c.action.target+':'+c.action.action) &&
        c.supportingFactIds.every((x:string)=>facts.get(x)!.semanticType==='FACT' && fresh(facts.get(x)!)) &&
        parametersSupported(c.action,c.supportingFactIds.map((x:string)=>facts.get(x)!),clock) &&
        !previous.includes(actionFingerprint(c.action));
    }).sort((a,b)=>{
      const rank=(c:EvidenceCandidate)=>gaps.find(h=>h.hypothesisId===c.hypothesisId)?.gap==='CONTRADICTORY'?0:1;
      return rank(a)-rank(b) || Number(b.preference==='EVENT_COOBSERVATION')-Number(a.preference==='EVENT_COOBSERVATION') ||
        (a.questionId<b.questionId?-1:a.questionId>b.questionId?1:0);
    });
    const selected=candidates[0];
    // All hypotheses assessed does not mean a SOC verdict is proven. A report still needs independent verdict policy.
    const decision=planNextStep({run,frontier,now,previousActionFingerprints:previous,
      proposal:selected?{kind:'DISPATCH',reasonCode:'EVIDENCE_GAP_SELECTED',rationale:'Collect evidence for '+selected.hypothesisId+' via '+selected.questionId+'.'+
        (selected.preference==='EVENT_COOBSERVATION'?' Prioritize an entity co-observed with the queried indicator in one source event; not causality, compromise or confidence.':''),action:JSON.parse(canonicalJson(selected.action)) as ProposedAction}:
        {kind:'BLOCKED',reasonCode:gaps.length?'NO_SAFE_EVIDENCE_QUESTION':'HYPOTHESES_ASSESSED_NOT_VERDICT',rationale:'No safe evidence action available; no benign/confirmed verdict inferred.'}});
    const selectedQuestionId=decision.kind==='DISPATCH'?selected?.questionId ?? null:null;
    const selectedFactIds=selectedQuestionId ? [...selected!.supportingFactIds].sort() : [];
    const selectedEvidenceIds=[...new Set(selectedFactIds.flatMap(x=>facts.get(x)!.provenance.map(p=>p.evidenceRef)))].sort();
    const result={schemaVersion:HYPOTHESIS_PLAN_SCHEMA,runId:run.runId,caseId:run.caseId,frontierVersion:frontier.version,
      policyVersion:this.policyVersion,hypotheses,selectedQuestionId,selectedFactIds,selectedEvidenceIds,decision};
    return {...result,planId:'HPLAN-'+sha256Canonical(result).slice(0,32)};
  }
}
