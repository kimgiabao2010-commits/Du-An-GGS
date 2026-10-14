import { HypothesisPlanner, type HypothesisPlan, type EvidenceCandidate } from '../runtime/hypothesis-planner.js';
import { sha256Canonical, type EvidenceFrontier, type InvestigationRun } from '../runtime/investigation-loop.js';
import { isInvestigationEvidence, type IndicatorType, type InvestigationEvidence } from './types.js';
import {validReadOnlyIndicator,readOnlyUdmQueryHash} from './query-template.js';
import {isEvidenceEntities,type EvidenceEntities} from './evidence-entities.js';

export const SOC_EVIDENCE_POLICY_VERSION='gss.soc-evidence.v1';
export interface SocQueryWindow { startTime: string; endTime: string; limit: number }
export interface SocIndicator { type: IndicatorType; value: string }
const object=(v:unknown):Record<string,unknown>=>v && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:{};
const patterns: Record<Exclude<IndicatorType,'IP'>,RegExp>={
  DOMAIN:/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,
  HOSTNAME:/^[a-zA-Z0-9._-]{1,253}$/, HASH:/^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/,
  USER:/^[a-zA-Z0-9._@\\-]{1,256}$/,
};
export const validSocIndicator=validReadOnlyIndicator;
export function socIndicatorKey(indicator: SocIndicator):string {
  return 'ioc.'+indicator.type.toLowerCase()+'.'+sha256Canonical(indicator).slice(0,32);
}
function queryKey(indicator:SocIndicator,window:SocQueryWindow):string {
  return 'soc.query.'+sha256Canonical({indicator,startTime:window.startTime,endTime:window.endTime}).slice(0,32);
}
export function socQueryWindow(parameters:Record<string,unknown>,now:string):SocQueryWindow {
  const {startTime,endTime,limit}=parameters,clock=Date.parse(now);
  const start=typeof startTime==='string'?Date.parse(startTime):NaN,end=typeof endTime==='string'?Date.parse(endTime):NaN;
  if(!Number.isFinite(clock) || !Number.isFinite(start) || !Number.isFinite(end) || start>=end || end>clock || end-start>7*86400000 ||
    !Number.isSafeInteger(limit) || Number(limit)<1 || Number(limit)>1000) throw new Error('Invalid SOC query window');
  return {startTime:startTime as string,endTime:endTime as string,limit:limit as number};
}
function indicators(event:Record<string,unknown>):{values:SocIndicator[];limited:boolean} {
  const values=new Map<string,SocIndicator>();
  let limited=false;
  const add=(type:IndicatorType,value:unknown)=>{
    if(Array.isArray(value) && value.length>20) limited=true;
    for(const item of (Array.isArray(value)?value.slice(0,20):[value])) {
      if(validSocIndicator(type,item)) { const i={type,value:item as string};values.set(socIndicatorKey(i),i); }
    }
  };
  for(const key of ['principal','target','src']) {
    const entity=object(event[key]);add('IP',entity.ip);
    if(typeof entity.hostname==='string') add(patterns.DOMAIN.test(entity.hostname)?'DOMAIN':'HOSTNAME',entity.hostname);
    add('USER',object(entity.user).userid);
    const file=object(entity.file);for(const key of ['md5','sha1','sha256']) add('HASH',file[key]);
  }
  const questions=object(object(event.network).dns).questions;
  if(Array.isArray(questions) && questions.length>20) limited=true;
  if(Array.isArray(questions)) for(const question of questions.slice(0,20)) add('DOMAIN',object(question).name);
  return {values:[...values.values()],limited};
}

/** Derived ONLY from a validated, hash-bound provider evidence record; never task intent or model prose. */
export function normalizeSocEvidence(evidence:InvestigationEvidence,parameters:Record<string,unknown>,now:string):Array<{key:string;value:string}> {
  if(!isInvestigationEvidence(evidence,{taskId:evidence.taskId,incidentId:evidence.incidentId}) || evidence.provenance.adapter!=='google-chronicle') {
    throw new Error('SOC normalization requires validated Chronicle evidence');
  }
  const window=socQueryWindow(parameters,now),type=parameters.indicatorType,value=parameters.indicatorValue;
  if(!validSocIndicator(type,value) || evidence.provenance.timeRange.start!==window.startTime || evidence.provenance.timeRange.end!==window.endTime ||
    evidence.provenance.queryHash!==readOnlyUdmQueryHash(type,value as string) || evidence.events.length>window.limit || evidence.events.length>1000) {
    throw new Error('SOC evidence query provenance mismatch');
  }
  const requested={type,value:value as string},found=new Map<string,string>();
  let matching=false,fieldLimited=false;
  for(const event of evidence.events) {
    const extracted=indicators(event);fieldLimited ||= extracted.limited;
    for(const indicator of extracted.values) {
      found.set(socIndicatorKey(indicator),indicator.value);
      if(indicator.type===requested.type && indicator.value===requested.value) matching=true;
    }
  }
  // A successful zero-result query is a bounded negative observation, NEVER a benign verdict.
  // Truncation or unverified matching is insufficient, not a fabricated negative/positive fact.
  const queryState=evidence.provenance.truncated?'TRUNCATED':evidence.events.length===0?'NO_MATCHES':matching?'MATCHED':'UNVERIFIED_MATCH';
  const facts=[{key:queryKey(requested,window),value:queryState},
    ...[...found].sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,128).map(([key,value])=>({key,value}))];
  const limits=[...(evidence.provenance.fieldTruncated?['PROVIDER_FIELD_LIMIT']:[]),
    ...(fieldLimited?['FIELD_ARRAY_LIMIT']:[]),...(found.size>128?['INDICATOR_LIMIT']:[])];
  if(limits.length) facts.push({key:'soc.extraction.'+sha256Canonical({indicator:requested,window}).slice(0,32),value:limits.join(',')});
  return facts;
}

/** Policy-owned candidate generation: next evidence follows discovered entities, not a fixed command sequence. */
export function planSocEvidence(input:{run:InvestigationRun;frontier:EvidenceFrontier;window:SocQueryWindow;
  availableActions:readonly string[];previousActionFingerprints:string[];now:string;
  entityContext?:{projection:EvidenceEntities;queriedIndicator:SocIndicator}}):HypothesisPlan {
  if(input.run.policyVersion!==SOC_EVIDENCE_POLICY_VERSION) throw new Error('SOC hypothesis policy binding mismatch');
  socQueryWindow({...input.window},input.now);
  const all=input.frontier.facts.filter(f=>f.semanticType==='FACT' && f.key.startsWith('ioc.')).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  const discovered=all.flatMap(f=>{
    const type=f.key.split('.')[1]?.toUpperCase();
    if(!validSocIndicator(type,f.value)) return [];
    const indicator={type,value:f.value};
    if(f.key!==socIndicatorKey(indicator)) return [];
    return [{fact:f,indicator}];
  });
  const context=input.entityContext,related=new Map<string,NonNullable<HypothesisPlan['nextEvidence']>['eventRefs']>();
  let anchorFactId:string|undefined;
  if(context) {
    const p=context.projection,q=context.queriedIndicator;
    if(!isEvidenceEntities(p) || p.caseId!==input.frontier.caseId || !validSocIndicator(q.type,q.value) ||
      p.queryHash!==readOnlyUdmQueryHash(q.type,q.value) || p.queryRange.start!==input.window.startTime ||
      p.queryRange.end!==input.window.endTime || !input.frontier.evidenceRefs.includes(p.evidenceId) ||
      !input.frontier.facts.some(f=>f.provenance.some(x=>x.evidenceRef===p.evidenceId && x.taskId===p.taskId &&
        x.artifactHash===p.artifactHash && x.observedAt===p.queriedAt))) throw new Error('Unbound SOC entity context');
    const bound=(f:typeof discovered[number]['fact'])=>f.provenance.some(x=>x.evidenceRef===p.evidenceId &&
      x.taskId===p.taskId && x.artifactHash===p.artifactHash && x.observedAt===p.queriedAt);
    anchorFactId=discovered.find(x=>x.indicator.type===q.type && x.indicator.value===q.value && bound(x.fact))?.fact.factId;
    if(anchorFactId)for(const event of p.events) {
      if(!event.mentions.some(m=>m.type===q.type && m.value===q.value))continue;
      for(const m of event.mentions) {
        if(m.type===q.type && m.value===q.value)continue;
        const key=socIndicatorKey({type:m.type,value:m.value});
        if(!discovered.some(x=>x.fact.key===key && bound(x.fact)))continue;
        const refs=related.get(key)??[];
        if(!refs.some(r=>r.sourceIndex===event.sourceIndex))refs.push({eventId:event.eventId,sourceIndex:event.sourceIndex,
          projectionHash:p.projectionHash,evidenceId:p.evidenceId,taskId:p.taskId,artifactHash:p.artifactHash});
        related.set(key,refs);
      }
    }
  }
  const clock=Date.parse(input.now),freshQueries=new Map<string,Set<string>>(),freshFactIds=new Set<string>();
  for(const f of input.frontier.facts)if(f.semanticType==='FACT' && f.provenance.some(p=>clock-Date.parse(p.observedAt)<=86400000)) {
    freshFactIds.add(f.factId);if(!f.key.startsWith('soc.query.'))continue;
    const values=freshQueries.get(f.key)??new Set<string>();values.add(f.value);freshQueries.set(f.key,values);
  }
  const conflicting=new Set(input.frontier.contradictions.filter(c=>c.factIds.some(id=>freshFactIds.has(id))).map(c=>c.key));
  const ranks=new Map(discovered.map(({fact,indicator})=>{
    const key=queryKey(indicator,input.window),values=freshQueries.get(key)??new Set<string>();
    const attempted=input.previousActionFingerprints.includes(sha256Canonical({target:'siem',action:'search_siem',riskLevel:'read_only',
      parameters:{indicatorType:indicator.type,indicatorValue:indicator.value,...input.window}}));
    return [fact.key,!freshFactIds.has(fact.factId)||attempted?3:values.size>1||conflicting.has(key)?0:values.has('MATCHED')||values.has('NO_MATCHES')?2:1] as const;
  }));
  // Unresolved questions precede assessed ones BEFORE the 16-rule bound: resolved prefix cannot starve later IOCs.
  const entries=discovered.sort((a,b)=>ranks.get(a.fact.key)!-ranks.get(b.fact.key)! ||
    Number(related.has(b.fact.key))-Number(related.has(a.fact.key)) || (a.fact.key<b.fact.key?-1:a.fact.key>b.fact.key?1:0)).slice(0,16);
  const rules=entries.map(({indicator})=>({ruleId:'related-'+sha256Canonical(indicator).slice(0,32),
    statement:'The bounded '+indicator.type+' search for '+indicator.value+' returned matching telemetry; this is not proof of compromise.',
    evidenceKey:queryKey(indicator,input.window),supportsValue:'MATCHED',refutesValue:'NO_MATCHES'}));
  // With no valid typed indicator, evaluate an explicitly unfulfilled gap; never synthesize an IOC.
  if(!rules.length) rules.push({ruleId:'typed-entity-required',statement:'Verified typed entity evidence is required for a follow-up.',
    evidenceKey:'soc.typed-entity.required',supportsValue:'AVAILABLE',refutesValue:'UNAVAILABLE'});
  const candidates:EvidenceCandidate[]=entries.map(({fact,indicator},index)=>({questionId:'query-'+sha256Canonical(indicator).slice(0,32),
    hypothesisId:rules[index].ruleId,suppliesKey:rules[index].evidenceKey,
    supportingFactIds:related.has(fact.key)?[fact.factId,anchorFactId!]:[fact.factId],
    ...(related.has(fact.key)?{preference:'EVENT_COOBSERVATION' as const}:{}),
    action:{target:'siem',action:'search_siem',riskLevel:'read_only',parameters:{indicatorType:indicator.type,indicatorValue:indicator.value,...input.window}}}));
  const {planId:originalPlanId,...plan}=new HypothesisPlanner(rules,SOC_EVIDENCE_POLICY_VERSION).plan({...input,candidates});
  const partialExtractionEvidenceIds=[...new Set(input.frontier.facts.filter(f=>f.semanticType==='FACT' &&
    f.key.startsWith('soc.extraction.') && /(?:PROVIDER_FIELD_LIMIT|FIELD_ARRAY_LIMIT|INDICATOR_LIMIT)/.test(f.value)).flatMap(f=>f.provenance.map(p=>p.evidenceRef)))].sort();
  const coverage:NonNullable<HypothesisPlan['coverage']>={schemaVersion:'gss.hypothesis-coverage.v1',scope:'ALLOWLISTED_STRUCTURED_FIELDS_ONLY',
    discoveredIndicators:discovered.length,evaluatedIndicators:entries.length,omittedIndicators:discovered.length-entries.length,
    partialExtractionEvidenceIds,limitations:[...(discovered.length>entries.length?['CANDIDATE_LIMIT' as const]:[]),
      ...(partialExtractionEvidenceIds.length?['PARTIAL_EXTRACTION' as const]:[])]};
  // Coverage is hash-bound to the durable plan; not a silently dropped remainder or a global benign verdict.
  const selected=candidates.find(c=>c.questionId===plan.selectedQuestionId),key=selected?entries[candidates.indexOf(selected)].fact.key:undefined;
  const nextEvidence:HypothesisPlan['nextEvidence']=selected?{schemaVersion:'gss.next-evidence-selection.v1',policyVersion:'gss.soc-priority.v1',
    reason:selected.preference??'UNRESOLVED_QUERY',interpretation:'COLLECTION_PRIORITY_NOT_CAUSALITY_OR_CONFIDENCE',
    partialContext:context?.projection.truncated??false,eventRefs:key?related.get(key)??[]:[]}:undefined;
  const result={...plan,coverage,...(nextEvidence?{nextEvidence}:{})};
  return {...result,planId:'HPLAN-'+sha256Canonical(result).slice(0,32)};
}
