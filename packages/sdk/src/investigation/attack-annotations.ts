import {sha256Canonical} from '../runtime/investigation-loop.js';
import {buildEvidenceTimeline,isEvidenceTimeline,type EvidenceTimeline} from './evidence-timeline.js';
import {attackId,attackKeys,isAttackKnowledge,type AttackKnowledge,type AttackTechnique} from './attack-knowledge.js';
import type {InvestigationEvidence} from './types.js';

export const ATTACK_LABEL_RULE='gss.attack.provider-label.v1';
interface AttackLabel {eventId:string;sourceIndex:number;securityIndex:number;techniqueId:string}
export interface EvidenceAttack {
  schemaVersion:'gss.evidence-attack.v1';projectionHash:string;timeline:EvidenceTimeline;queryHash:string;
  ruleVersion:typeof ATTACK_LABEL_RULE;labels:AttackLabel[];unknownLabelCount:number;omittedLabelCount:number;
}
/** Literal provider-reported technique ID only. USER/IP/process names alone never imply ATTACK. */
export function buildEvidenceAttack(evidence:InvestigationEvidence,artifactHash:string):EvidenceAttack {
  const timeline=buildEvidenceTimeline(evidence,artifactHash,200);
  if(timeline.adapter!=='google-chronicle')throw new Error('Lab metadata has no approved ATTACK semantic labels');
  const labels:AttackLabel[]=[];let unknownLabelCount=0,omittedLabelCount=0;
  for(const event of timeline.entries){const security=evidence.events[event.sourceIndex].security_result;
    if(!Array.isArray(security))continue;
    if(security.length>20)throw new Error('ATTACK security-result field exceeds adapter allowlist bound');
    for(let i=0;i<Math.min(security.length,20);i++){
      const label=security[i]?.threat_name;if(label===undefined)continue;
      if(!attackId(label)){unknownLabelCount++;continue;}
      if(labels.length>=200){omittedLabelCount++;continue;}
      labels.push({eventId:event.eventId,sourceIndex:event.sourceIndex,securityIndex:i,techniqueId:label});
    }
  }
  const p:Omit<EvidenceAttack,'projectionHash'>={schemaVersion:'gss.evidence-attack.v1',timeline,queryHash:evidence.provenance.queryHash,
    ruleVersion:ATTACK_LABEL_RULE,labels,unknownLabelCount,omittedLabelCount};return {...p,projectionHash:sha256Canonical(p)};
}
export function isEvidenceAttack(v:unknown):v is EvidenceAttack {
  const p=v as EvidenceAttack,count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=4000;
  try{return attackKeys(p,['schemaVersion','projectionHash','timeline','queryHash','ruleVersion','labels','unknownLabelCount','omittedLabelCount'])&&
    p.schemaVersion==='gss.evidence-attack.v1'&&p.ruleVersion===ATTACK_LABEL_RULE&&isEvidenceTimeline(p.timeline)&&
    p.timeline.adapter==='google-chronicle'&&/^[a-f0-9]{64}$/.test(p.queryHash)&&/^[a-f0-9]{64}$/.test(p.projectionHash)&&
    Array.isArray(p.labels)&&p.labels.length<=200&&count(p.unknownLabelCount)&&count(p.omittedLabelCount)&&
    p.labels.length+p.unknownLabelCount+p.omittedLabelCount<=p.timeline.inputCount*20&&
    new Set(p.labels.map(l=>l.sourceIndex+':'+l.securityIndex)).size===p.labels.length&&p.labels.every(l=>
      attackKeys(l,['eventId','sourceIndex','securityIndex','techniqueId'])&&attackId(l.techniqueId)&&
      Number.isInteger(l.securityIndex)&&l.securityIndex>=0&&l.securityIndex<20&&
      p.timeline.entries.some(e=>e.eventId===l.eventId&&e.sourceIndex===l.sourceIndex))&&
    Buffer.byteLength(JSON.stringify(p))<=512000&&sha256Canonical((({projectionHash:_h,...rest})=>rest)(p))===p.projectionHash;
  }catch{return false;}
}
export interface AttackReport {
  schemaVersion:'gss.attack-report.v1';caseId:string;annotationHash:string;status:'NOT_CONFIGURED'|'EXPIRED'|'NOT_YET_VALID'|'AVAILABLE';
  ruleVersion:typeof ATTACK_LABEL_RULE;interpretation:'PROVIDER_LABEL_RESOLUTION_NOT_FACT_VERDICT_OR_COMPROMISE';
  knowledge:null|{version:string;commit:string;knowledgeHash:string;bundleSha256:string;licenseSha256:string;sourceUrl:string;licenseUrl:string};
  coverage:{completedQueryCount:number;unprojectedQueryCount:number;omittedProjectionCount:number};partialEvidence:boolean;
  unknownLabelCount:number;unmappedLabelCount:number;omittedMatchCount:number;
  matches:Array<AttackLabel&{technique:AttackTechnique;taskId:string;evidenceId:string;artifactHash:string;projectionHash:string;queryHash:string}>;
}
/** Knowledge annotates hash-bound provider labels; it never updates Frontier/planner/lifecycle. */
export function annotateCaseAttack(caseId:string,projections:unknown[],coverage:AttackReport['coverage'],catalog:AttackKnowledge|undefined,now:string):AttackReport {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(caseId)||projections.length>32||!Number.isFinite(Date.parse(now))||
    Object.values(coverage).some(n=>!Number.isSafeInteger(n)||n<0)||
    coverage.completedQueryCount!==projections.length+coverage.unprojectedQueryCount+coverage.omittedProjectionCount||catalog&&!isAttackKnowledge(catalog))
    throw new Error('Invalid bounded ATTACK report input');
  const ps=projections as EvidenceAttack[];
  if(ps.some(p=>!isEvidenceAttack(p)||p.timeline.caseId!==caseId)||new Set(ps.map(p=>p.timeline.taskId)).size!==ps.length)
    throw new Error('Unverified ATTACK projection/lineage');
  const status:AttackReport['status']=!catalog?'NOT_CONFIGURED':Date.parse(now)<Date.parse(catalog.reviewedAt)?'NOT_YET_VALID':
    Date.parse(now)>=Date.parse(catalog.expiresAt)?'EXPIRED':'AVAILABLE';
  const index=new Map(status==='AVAILABLE'?catalog!.techniques.map(t=>[t.id,t] as const):[]);
  const matches:AttackReport['matches']=[];let unmappedLabelCount=0,omittedMatchCount=0;
  for(const p of ps)for(const label of p.labels){const technique=index.get(label.techniqueId);
    if(!technique){if(status==='AVAILABLE')unmappedLabelCount++;continue;}
    if(matches.length>=200){omittedMatchCount++;continue;}
    matches.push({...label,technique:structuredClone(technique),taskId:p.timeline.taskId,evidenceId:p.timeline.evidenceId,
      artifactHash:p.timeline.artifactHash,projectionHash:p.projectionHash,queryHash:p.queryHash});
  }
  const report:Omit<AttackReport,'annotationHash'>={schemaVersion:'gss.attack-report.v1',caseId,status,ruleVersion:ATTACK_LABEL_RULE,
    interpretation:'PROVIDER_LABEL_RESOLUTION_NOT_FACT_VERDICT_OR_COMPROMISE' as const,
    knowledge:catalog?{version:catalog.version,commit:catalog.commit,knowledgeHash:catalog.knowledgeHash,bundleSha256:catalog.bundleSha256,
      licenseSha256:catalog.licenseSha256,sourceUrl:catalog.sourceUrl,licenseUrl:catalog.licenseUrl}:null,
    coverage:{...coverage},partialEvidence:coverage.unprojectedQueryCount>0||coverage.omittedProjectionCount>0||omittedMatchCount>0||
      ps.some(p=>p.timeline.truncated||p.omittedLabelCount>0),
    unknownLabelCount:ps.reduce((n,p)=>n+p.unknownLabelCount,0),unmappedLabelCount,omittedMatchCount,matches};
  return {...report,annotationHash:sha256Canonical(report)};
}
