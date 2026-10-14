import {sha256Canonical} from '../runtime/investigation-loop.js';
import {validReadOnlyIndicator} from './query-template.js';
import type {CaseEntities} from './case-entities.js';

export interface OfflineIntelCatalog {
  schemaVersion:'gss.offline-intel-catalog.v1';catalogId:string;version:string;
  sourceUrl:string;license:{identifier:string;url:string};
  review:{owner:string;reviewedAt:string;authorization:'APPROVED_FOR_OFFLINE_LOCAL_USE'};
  updatedAt:string;expiresAt:string;
  entries:Array<{recordId:string;type:'IP'|'DOMAIN'|'HASH';value:string;
    classification:'REPORTED_MALICIOUS'|'REPORTED_BENIGN'|'UNKNOWN';referenceUrl:string}>;
}
const text=(v:unknown,n:number):v is string=>typeof v==='string' && v.length>0 && v.length<=n;
const date=(v:unknown)=>text(v,64)&&Number.isFinite(Date.parse(v));
const keysOnly=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).every(k=>keys.includes(k));
const url=(v:unknown)=>{
  if(!text(v,2048))return false;
  try{const u=new URL(v);return u.protocol==='https:' && !u.username && !u.password && !u.search && !u.hash;}catch{return false;}
};
/** Operator approval metadata is a declaration, not license verification or source authentication. Never fetch URLs. */
export function isOfflineIntelCatalog(v:unknown):v is OfflineIntelCatalog {
  const c=v as OfflineIntelCatalog;
  try{return keysOnly(c,['schemaVersion','catalogId','version','sourceUrl','license','review','updatedAt','expiresAt','entries'])&&
    keysOnly(c.license,['identifier','url'])&&keysOnly(c.review,['owner','reviewedAt','authorization'])&&
    c?.schemaVersion==='gss.offline-intel-catalog.v1' && text(c.catalogId,128)&&text(c.version,128)&&url(c.sourceUrl)&&
    text(c.license?.identifier,128)&&url(c.license.url)&&text(c.review?.owner,128)&&date(c.review.reviewedAt)&&
    c.review.authorization==='APPROVED_FOR_OFFLINE_LOCAL_USE'&&date(c.updatedAt)&&date(c.expiresAt)&&
    Date.parse(c.updatedAt)<=Date.parse(c.review.reviewedAt)&&Date.parse(c.review.reviewedAt)<Date.parse(c.expiresAt)&&
    Date.parse(c.expiresAt)-Date.parse(c.updatedAt)<=366*86400000 &&
    Array.isArray(c.entries)&&c.entries.length<=1000&&new Set(c.entries.map(e=>e?.recordId)).size===c.entries.length&&
    c.entries.every(e=>keysOnly(e,['recordId','type','value','classification','referenceUrl'])&&
      text(e?.recordId,128)&&['IP','DOMAIN','HASH'].includes(e.type)&&validReadOnlyIndicator(e.type,e.value)&&
      ['REPORTED_MALICIOUS','REPORTED_BENIGN','UNKNOWN'].includes(e.classification)&&url(e.referenceUrl))&&
    Buffer.byteLength(JSON.stringify(c))<=512_000;
  }catch{return false;}
}
export interface OfflineIntelAnnotation {
  recordId:string;type:'IP'|'DOMAIN'|'HASH';value:string;classification:OfflineIntelCatalog['entries'][number]['classification'];referenceUrl:string;
  eventId:string;sourceIndex:number;field:string;valueKey:string;evidenceId:string;taskId:string;artifactHash:string;projectionHash:string;
}
export interface OfflineIntelReport {
  schemaVersion:'gss.offline-intel-report.v1';caseId:string;entitySnapshotHash:string;annotationHash:string;evaluatedAt:string;
  status:'NOT_CONFIGURED'|'EXPIRED'|'NOT_YET_VALID'|'AVAILABLE';
  interpretation:'EXACT_VALUE_FEED_ANNOTATIONS_NOT_FACTS_OR_VERDICT';
  catalog:null|Omit<OfflineIntelCatalog,'entries'> & {catalogHash:string;entryCount:number};
  partialEvidence:boolean;matchCount:number;omittedMatchCount:number;matches:OfflineIntelAnnotation[];
}
/** Exact typed matching only. No network, model call, normalization guessing, FACT creation or decision authority. */
export function annotateOfflineIntel(entities:CaseEntities,catalog:OfflineIntelCatalog|undefined,now:string):OfflineIntelReport {
  const {snapshotHash,...snapshot}=entities;
  if(entities.schemaVersion!=='gss.case-entities.v1'||!date(now)||!Array.isArray(entities.entries)||entities.entries.length>200||
    !Array.isArray(entities.sources)||entities.sources.length>32||entities.entries.reduce((n,e)=>n+e.mentions.length,0)>500||
    !/^[a-f0-9]{64}$/.test(snapshotHash)||sha256Canonical(snapshot)!==snapshotHash)throw new Error('Unverified offline-intel entity snapshot');
  if(catalog && !isOfflineIntelCatalog(catalog))throw new Error('Invalid approved offline-intel catalog');
  const status:OfflineIntelReport['status']=!catalog?'NOT_CONFIGURED':Date.parse(now)<Date.parse(catalog.review.reviewedAt)?'NOT_YET_VALID':
    Date.parse(now)>=Date.parse(catalog.expiresAt)?'EXPIRED':'AVAILABLE';
  const index=new Map<string,OfflineIntelCatalog['entries']>();
  if(catalog&&status==='AVAILABLE')for(const entry of catalog.entries){
    const key=sha256Canonical({type:entry.type,value:entry.value}),list=index.get(key)??[];list.push(entry);index.set(key,list);
  }
  const matches:OfflineIntelAnnotation[]=[];let matchCount=0;
  for(const event of entities.entries) {
    const source=entities.sources.find(s=>s.taskId===event.taskId && s.evidenceId===event.evidenceId &&
      s.artifactHash===event.artifactHash && s.projectionHash===event.projectionHash);
    if(!source)throw new Error('Unbound offline-intel event provenance');
    for(const mention of event.mentions) {
      if(!validReadOnlyIndicator(mention.type,mention.value)||mention.valueKey!=='VALUE-'+sha256Canonical({adapter:source.adapter,
        sourceInstance:source.sourceInstance,type:mention.type,value:mention.value}))throw new Error('Invalid offline-intel entity value');
      for(const record of index.get(sha256Canonical({type:mention.type,value:mention.value}))??[]) {
        matchCount++;if(matches.length>=200)continue;
        matches.push({...record,eventId:event.eventId,sourceIndex:event.sourceIndex,field:mention.field,valueKey:mention.valueKey,
          evidenceId:event.evidenceId,taskId:event.taskId,artifactHash:event.artifactHash,projectionHash:event.projectionHash});
      }
    }
  }
  const metadata=catalog?(({entries,...source})=>({...source,catalogHash:sha256Canonical(catalog),entryCount:entries.length}))(catalog):null;
  const result={schemaVersion:'gss.offline-intel-report.v1' as const,caseId:entities.caseId,entitySnapshotHash:snapshotHash,evaluatedAt:now,status,
    interpretation:'EXACT_VALUE_FEED_ANNOTATIONS_NOT_FACTS_OR_VERDICT' as const,catalog:metadata,
    partialEvidence:entities.partial,matchCount,omittedMatchCount:matchCount-matches.length,matches};
  return {...result,annotationHash:sha256Canonical(result)};
}
