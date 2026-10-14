import {sha256Canonical} from '../runtime/investigation-loop.js';
import {isEvidenceEntities,type EvidenceEntities,type EntityEvent} from './evidence-entities.js';

export type EntitySource=Omit<EvidenceEntities,'schemaVersion'|'events'>;
export interface CaseEntityEvent extends EntityEvent {taskId:string;evidenceId:string;artifactHash:string;projectionHash:string}
export interface CaseEntities {
  schemaVersion:'gss.case-entities.v1';caseId:string;snapshotHash:string;
  comparison:'EXACT_TYPED_VALUE_WITHIN_SOURCE_ONLY';scope:'RETAINED_AUTHORITY_PROJECTIONS';
  completedQueryCount:number;unprojectedQueryCount:number;omittedProjectionCount:number;
  inputEventCount:number;omittedEventCount:number;parsedMentionCount:number;omittedParsedMentionCount:number;
  partial:boolean;sources:EntitySource[];entries:CaseEntityEvent[];
}
export function buildCaseEntities(caseId:string,projections:unknown[],coverage:{completedQueryCount:number;unprojectedQueryCount:number;omittedProjectionCount:number}):CaseEntities {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(caseId)||!Array.isArray(projections)||projections.length>32||
    Object.values(coverage).some(x=>!Number.isSafeInteger(x)||x<0)||
    coverage.completedQueryCount!==projections.length+coverage.unprojectedQueryCount+coverage.omittedProjectionCount)
    throw new Error('Invalid case entity bounds');
  const tasks=new Set<string>(),retained:EvidenceEntities[]=[];
  for(const projection of projections){
    if(!isEvidenceEntities(projection)||projection.caseId!==caseId||tasks.has(projection.taskId))throw new Error('Invalid entity projection integrity');
    tasks.add(projection.taskId);retained.push(projection);
  }
  retained.sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0);
  const all=retained.flatMap(p=>p.events.map(e=>({...e,taskId:p.taskId,evidenceId:p.evidenceId,artifactHash:p.artifactHash,projectionHash:p.projectionHash})));
  let available=500;
  const entries=all.slice(0,200).map(e=>{const mentions=e.mentions.slice(0,available);available-=mentions.length;return {...e,mentions};});
  const inputEventCount=retained.reduce((n,p)=>n+p.inputCount,0);
  const parsedMentionCount=retained.reduce((n,p)=>n+p.omittedParsedMentions+p.events.reduce((m,e)=>m+e.mentions.length,0),0);
  const omittedParsedMentionCount=parsedMentionCount-entries.reduce((n,e)=>n+e.mentions.length,0);
  const projection={schemaVersion:'gss.case-entities.v1' as const,caseId,
    comparison:'EXACT_TYPED_VALUE_WITHIN_SOURCE_ONLY' as const,scope:'RETAINED_AUTHORITY_PROJECTIONS' as const,...coverage,
    inputEventCount,omittedEventCount:inputEventCount-entries.length,parsedMentionCount,omittedParsedMentionCount,
    partial:coverage.unprojectedQueryCount>0||coverage.omittedProjectionCount>0||inputEventCount>entries.length||
      omittedParsedMentionCount>0||retained.some(p=>p.truncated),
    sources:retained.map(({schemaVersion:_schema,events:_events,...source})=>source),entries};
  return {...projection,snapshotHash:sha256Canonical(projection)};
}
