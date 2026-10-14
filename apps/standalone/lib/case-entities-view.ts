import type {CaseEntities} from '@asq/sdk';
const text=(x:unknown,max=256):x is string=>typeof x==='string'&&x.length>0&&x.length<=max;
const count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
const hash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function caseEntitiesView(input:unknown,caseId:string):CaseEntities {
  const p=input as CaseEntities;
  if(!p||p.schemaVersion!=='gss.case-entities.v1'||p.caseId!==caseId||p.scope!=='RETAINED_AUTHORITY_PROJECTIONS'||
    p.comparison!=='EXACT_TYPED_VALUE_WITHIN_SOURCE_ONLY'||!hash(p.snapshotHash)||typeof p.partial!=='boolean'||
    ![p.completedQueryCount,p.unprojectedQueryCount,p.omittedProjectionCount,p.inputEventCount,p.omittedEventCount,
      p.parsedMentionCount,p.omittedParsedMentionCount].every(count)||!Array.isArray(p.sources)||p.sources.length>32||
    !Array.isArray(p.entries)||p.entries.length>200||p.completedQueryCount!==p.sources.length+p.unprojectedQueryCount+p.omittedProjectionCount||
    p.inputEventCount!==p.entries.length+p.omittedEventCount)throw new Error('Invalid entity snapshot; no links inferred.');
  const sources=new Map(p.sources.map(s=>[s?.taskId,s]));
  if(sources.size!==p.sources.length||p.sources.some(s=>!s||s.caseId!==caseId||!text(s.taskId)||!text(s.evidenceId)||
    !hash(s.artifactHash)||!hash(s.projectionHash)||!hash(s.queryHash)||s.adapter!=='google-chronicle'||s.adapterVersion!=='v1'||
    s.sourceKind!=='CHRONICLE_UNATTESTED'||s.redaction!=='ALLOWLISTED_FIELDS_ONLY'||!text(s.sourceInstance,2048)||
    !count(s.inputCount)||s.inputCount>1000||typeof s.truncated!=='boolean')||
    p.sources.reduce((n,s)=>n+s.inputCount,0)!==p.inputEventCount)throw new Error('Invalid entity provenance.');
  let mentions=0;const events=new Set<string>();
  for(const e of p.entries){
    const source=sources.get(e?.taskId),key=e?.taskId+':'+e?.sourceIndex;
    if(!e||!source||!text(e.eventId,1024)||!count(e.sourceIndex)||e.sourceIndex>=source.inputCount||events.has(key)||
      e.evidenceId!==source.evidenceId||e.artifactHash!==source.artifactHash||e.projectionHash!==source.projectionHash||
      e.relationship!=='CO_OBSERVED_ONLY'||!Array.isArray(e.mentions)||e.mentions.length>32||
      !['VALID','MISSING','INVALID','TIMEZONE_MISSING'].includes(e.timeStatus)||
      !(e.rawTimestamp===null||typeof e.rawTimestamp==='string'&&e.rawTimestamp.length<=128)||
      (e.timeStatus==='VALID'?typeof e.occurredAt!=='string'||!Number.isFinite(Date.parse(e.occurredAt)):e.occurredAt!==null))throw new Error('Invalid event lineage.');
    events.add(key);const unique=new Set<string>();
    for(const m of e.mentions){
      const roleField=m?.type==='IP'?/^(principal|target|src)\.ip$/:
        m?.type==='USER'?/^(principal|target|src)\.user\.userid$/:
        m?.type==='HASH'?/^(principal|target|src)\.file\.(md5|sha1|sha256)$/:
        m?.type==='DOMAIN'?/^(principal|target|src)\.hostname$|^network\.dns\.questions\.name$/:
        m?.type==='HOSTNAME'?/^(principal|target|src)\.hostname$/:null;
      const id=m?.field+':'+m?.type+':'+m?.value;
      if(!m||!roleField||!text(m.field,64)||!roleField.test(m.field)||!text(m.value)||
        typeof m.valueKey!=='string'||!/^VALUE-[a-f0-9]{64}$/.test(m.valueKey)||unique.has(id))throw new Error('Invalid entity mention.');
      unique.add(id);
    }
    mentions+=e.mentions.length;
  }
  if(mentions>500||p.parsedMentionCount!==mentions+p.omittedParsedMentionCount||
    (p.omittedEventCount+p.omittedParsedMentionCount+p.unprojectedQueryCount+p.omittedProjectionCount>0||p.sources.some(s=>s.truncated))&&!p.partial)
    throw new Error('Invalid entity coverage.');
  return p;
}
