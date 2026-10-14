import {sha256Canonical} from '../runtime/investigation-loop.js';
import {buildEvidenceTimeline,isEvidenceTimeline,type EvidenceTimeline,type EvidenceTimelineEntry} from './evidence-timeline.js';
import {validReadOnlyIndicator} from './query-template.js';
import type {InvestigationEvidence,IndicatorType} from './types.js';

export interface EntityMention {type:IndicatorType;value:string;field:string;valueKey:string}
export interface EntityEvent extends EvidenceTimelineEntry {
  relationship:'CO_OBSERVED_ONLY';mentions:EntityMention[];
}
export interface EvidenceEntities extends Omit<EvidenceTimeline,'schemaVersion'|'entries'> {
  schemaVersion:'gss.evidence-entities.v1';
  comparison:'EXACT_TYPED_VALUE_WITHIN_SOURCE_ONLY';
  queryHash:string;adapterVersion:'v1';redaction:'ALLOWLISTED_FIELDS_ONLY';
  events:EntityEvent[];
  omittedParsedMentions:number;
  invalidParsedValues:number;
  limits:{fieldArrays:boolean;perEventMentions:boolean;totalMentions:boolean};
}
const record=(x:unknown):Record<string,unknown>=>x && typeof x==='object' && !Array.isArray(x)?x as Record<string,unknown>:{};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const valueKey=(source:Pick<EvidenceTimeline,'adapter'|'sourceInstance'>,type:IndicatorType,value:string)=>
  'VALUE-'+sha256Canonical({adapter:source.adapter,sourceInstance:source.sourceInstance,type,value});
function allowedField(field:string,type:IndicatorType):boolean {
  return type==='IP'?/^(principal|target|src)\.ip$/.test(field):
    type==='USER'?/^(principal|target|src)\.user\.userid$/.test(field):
    type==='HASH'?/^(principal|target|src)\.file\.(md5|sha1|sha256)$/.test(field):
    type==='DOMAIN'?/^(principal|target|src)\.hostname$/.test(field)||field==='network.dns.questions.name':
    type==='HOSTNAME' && /^(principal|target|src)\.hostname$/.test(field);
}

/** Structured field projection. Equal values are not asset identity; co-observation is not causation. */
export function buildEvidenceEntities(evidence:InvestigationEvidence,artifactHash:string,maxEvents=200,maxMentions=500):EvidenceEntities {
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>200||!Number.isSafeInteger(maxMentions)||maxMentions<1||maxMentions>500)
    throw new Error('Invalid entity projection bounds');
  const timeline=buildEvidenceTimeline(evidence,artifactHash,1000);
  if(timeline.adapter!=='google-chronicle')throw new Error('Lab metadata has no approved structured entity fields');
  const timing=new Map(timeline.entries.map(e=>[e.sourceIndex,e]));
  let remaining=maxMentions,omittedParsedMentions=0,invalidParsedValues=0;
  const limits={fieldArrays:false,perEventMentions:false,totalMentions:false};
  const events=evidence.events.slice(0,maxEvents).map((event,sourceIndex)=>{
    const parsed=new Map<string,EntityMention>();
    const add=(type:IndicatorType,value:unknown,field:string)=>{
      if(value===undefined || value===null)return;
      if(Array.isArray(value)&&value.length>20)limits.fieldArrays=true;
      for(const item of Array.isArray(value)?value.slice(0,20):[value]) {
        if(!validReadOnlyIndicator(type,item)){invalidParsedValues++;continue;}
        const mention={type,value:item as string,field,valueKey:valueKey(timeline,type,item as string)};
        parsed.set(sha256Canonical({type,value:item,field}),mention);
      }
    };
    for(const role of ['principal','target','src']) {
      const entity=record(event[role]);add('IP',entity.ip,role+'.ip');
      if(entity.hostname!==undefined)add(validReadOnlyIndicator('DOMAIN',entity.hostname)?'DOMAIN':'HOSTNAME',entity.hostname,role+'.hostname');
      add('USER',record(entity.user).userid,role+'.user.userid');
      const file=record(entity.file);for(const key of ['md5','sha1','sha256'])add('HASH',file[key],role+'.file.'+key);
    }
    const questions=record(record(event.network).dns).questions;
    if(Array.isArray(questions)) {
      if(questions.length>20)limits.fieldArrays=true;
      for(const question of questions.slice(0,20))add('DOMAIN',record(question).name,'network.dns.questions.name');
    }
    const mentions=[...parsed.values()].sort((a,b)=>compare(a.field,b.field)||compare(a.type,b.type)||compare(a.value,b.value));
    if(mentions.length>32)limits.perEventMentions=true;
    const take=Math.min(mentions.length,32,remaining);
    if(Math.min(mentions.length,32)>remaining)limits.totalMentions=true;
    remaining-=take;omittedParsedMentions+=mentions.length-take;
    return {...timing.get(sourceIndex)!,relationship:'CO_OBSERVED_ONLY' as const,mentions:mentions.slice(0,take)};
  });
  const {schemaVersion:_schema,projectionHash:_hash,entries:_entries,...source}=timeline;
  const projection={...source,schemaVersion:'gss.evidence-entities.v1' as const,
    comparison:'EXACT_TYPED_VALUE_WITHIN_SOURCE_ONLY' as const,events,omittedCount:evidence.events.length-events.length,
    queryHash:evidence.provenance.queryHash,adapterVersion:evidence.provenance.adapterVersion,redaction:evidence.provenance.redaction,
    omittedParsedMentions,invalidParsedValues,limits,
    truncated:timeline.truncated||evidence.events.length>events.length||invalidParsedValues>0||Object.values(limits).some(Boolean)};
  if(Buffer.byteLength(JSON.stringify(projection))>1_000_000)throw new Error('Entity projection byte limit');
  const output={...projection,projectionHash:sha256Canonical(projection)};
  if(!isEvidenceEntities(output))throw new Error('Invalid entity projection integrity');
  return output;
}

/** Stored authority projection integrity; no inference of provider authenticity or physical identity. */
export function isEvidenceEntities(input:unknown):input is EvidenceEntities {
  if(!input||typeof input!=='object'||Array.isArray(input))return false;
  const p=input as EvidenceEntities,count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
  if(p.schemaVersion!=='gss.evidence-entities.v1'||p.comparison!=='EXACT_TYPED_VALUE_WITHIN_SOURCE_ONLY'||
    p.adapter!=='google-chronicle'||typeof p.sourceInstance!=='string'||!p.sourceInstance||p.sourceInstance.length>2048||
    !/^[a-f0-9]{64}$/.test(p.queryHash)||p.adapterVersion!=='v1'||p.redaction!=='ALLOWLISTED_FIELDS_ONLY'||
    !Array.isArray(p.events)||p.events.length>200||!count(p.omittedParsedMentions)||!count(p.invalidParsedValues)||
    !p.limits||['fieldArrays','perEventMentions','totalMentions'].some(k=>typeof p.limits[k as keyof typeof p.limits]!=='boolean')||
    Object.values(p.limits).some(Boolean)&&!p.truncated||(p.omittedParsedMentions>0||p.invalidParsedValues>0)&&!p.truncated)return false;
  let mentions=0;
  for(const event of p.events) {
    if(!event||event.relationship!=='CO_OBSERVED_ONLY'||!Array.isArray(event.mentions)||event.mentions.length>32)return false;
    const unique=new Set<string>();
    for(const m of event.mentions) {
      if(!m||typeof m.field!=='string'||!allowedField(m.field,m.type)||!validReadOnlyIndicator(m.type,m.value)||
        m.valueKey!==valueKey(p,m.type,m.value))return false;
      const key=sha256Canonical({type:m.type,value:m.value,field:m.field});if(unique.has(key))return false;unique.add(key);
    }
    mentions+=event.mentions.length;
  }
  if(mentions>500)return false;
  try {
    const {projectionHash,...projection}=p;
    const {schemaVersion:_schema,events,comparison:_comparison,limits:_limits,
      omittedParsedMentions:_omitted,invalidParsedValues:_invalid,...source}=projection;
    const timeline={...source,schemaVersion:'gss.evidence-timeline.v1' as const,
      entries:events.map(({mentions:_mentions,relationship:_relationship,...entry})=>entry)};
    return isEvidenceTimeline({...timeline,projectionHash:sha256Canonical(timeline)}) &&
      Buffer.byteLength(JSON.stringify(p))<=1_000_000 && sha256Canonical(projection)===projectionHash;
  }catch{return false;}
}
