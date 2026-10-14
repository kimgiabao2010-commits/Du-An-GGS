import {sha256Canonical} from '../runtime/investigation-loop.js';

export interface AttackTechnique {id:string;stixId:string;name:string;version:string;url:string;tactics:string[]}
export interface AttackKnowledge {
  schemaVersion:'gss.attack-knowledge.v1';knowledgeHash:string;version:string;commit:string;
  bundleSha256:string;licenseSha256:string;sourceUrl:string;licenseUrl:string;
  reviewedAt:string;expiresAt:string;reviewOwner:string;sourceAuthentication:'OPERATOR_PIN_NOT_SIGNATURE';
  techniques:AttackTechnique[];
}
export const attackId=(x:unknown):x is string=>typeof x==='string'&&/^T\d{4}(?:\.\d{3})?$/.test(x);
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=(x:unknown,n:number):x is string=>typeof x==='string'&&x.length>0&&x.length<=n;
const date=(x:unknown)=>text(x,64)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)&&
  Number.isFinite(Date.parse(x))&&(new Date(x).toISOString()===x||new Date(x).toISOString().replace('.000Z','Z')===x);
const stixId=(x:unknown)=>typeof x==='string'&&/^attack-pattern--[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
export const attackKeys=(x:unknown,keys:string[])=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).every(k=>keys.includes(k));
const record=(x:unknown):Record<string,any>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,any>:{};
export const attackTechniqueUrl=(id:string)=>'https://attack.mitre.org/techniques/'+id.replace('.','/')+'/';
function source(commit:string,path:string){return 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/'+commit+'/'+path;}
function metadata(c:Omit<AttackKnowledge,'knowledgeHash'|'techniques'>):boolean {
  return c.schemaVersion==='gss.attack-knowledge.v1'&&/^\d{1,2}\.\d{1,2}$/.test(c.version)&&/^[a-f0-9]{40}$/.test(c.commit)&&
    hash(c.bundleSha256)&&hash(c.licenseSha256)&&c.sourceUrl===source(c.commit,'enterprise-attack/enterprise-attack.json')&&
    c.licenseUrl===source(c.commit,'LICENSE.txt')&&date(c.reviewedAt)&&date(c.expiresAt)&&text(c.reviewOwner,128)&&
    Date.parse(c.expiresAt)>Date.parse(c.reviewedAt)&&Date.parse(c.expiresAt)-Date.parse(c.reviewedAt)<=366*86400000&&
    c.sourceAuthentication==='OPERATOR_PIN_NOT_SIGNATURE';
}
/** No descriptions/instructions, remote fetching, malware signatures or operational data. */
export function importAttackKnowledge(bundle:unknown,input:{version:string;commit:string;bundleSha256:string;licenseSha256:string;
  reviewedAt:string;expiresAt:string;reviewOwner:string}):AttackKnowledge {
  if(!attackKeys(input,['version','commit','bundleSha256','licenseSha256','reviewedAt','expiresAt','reviewOwner']))throw new Error('Invalid ATTACK import metadata fields');
  const m={schemaVersion:'gss.attack-knowledge.v1' as const,...input,sourceUrl:source(input.commit,'enterprise-attack/enterprise-attack.json'),
    licenseUrl:source(input.commit,'LICENSE.txt'),sourceAuthentication:'OPERATOR_PIN_NOT_SIGNATURE' as const};
  const b=record(bundle);if(!metadata(m)||b.type!=='bundle'||!Array.isArray(b.objects)||b.objects.length>50000)
    throw new Error('Invalid bounded ATTACK bundle or metadata');
  const techniques:AttackTechnique[]=[];
  for(const value of b.objects){const o=record(value);if(o.type!=='attack-pattern')continue;
    if(o.revoked!==undefined&&typeof o.revoked!=='boolean'||o.x_mitre_deprecated!==undefined&&typeof o.x_mitre_deprecated!=='boolean')
      throw new Error('Invalid ATTACK lifecycle flags');
    if(o.revoked||o.x_mitre_deprecated)continue;
    if(!Array.isArray(o.x_mitre_domains)||!o.x_mitre_domains.includes('enterprise-attack'))continue;
    const refs=Array.isArray(o.external_references)?o.external_references.filter((r:unknown)=>record(r).source_name==='mitre-attack'):[];
    if(refs.length!==1||!attackId(refs[0].external_id)||
      ![attackTechniqueUrl(refs[0].external_id),attackTechniqueUrl(refs[0].external_id).slice(0,-1)].includes(refs[0].url)||
      !stixId(o.id)||!text(o.name,256)||!text(o.x_mitre_version,32)||
      !Array.isArray(o.kill_chain_phases)||o.kill_chain_phases.length>32)throw new Error('Invalid ATTACK technique identity');
    const tactics=o.kill_chain_phases.filter((p:unknown)=>record(p).kill_chain_name==='mitre-attack').map((p:any)=>p.phase_name);
    if(tactics.some((t:unknown)=>!text(t,64)||!/^[a-z0-9-]+$/.test(t as string)))throw new Error('Invalid ATTACK tactic');
    techniques.push({id:refs[0].external_id,stixId:o.id,name:o.name,version:o.x_mitre_version,
      url:attackTechniqueUrl(refs[0].external_id),tactics:[...new Set<string>(tactics)].sort()});
  }
  techniques.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(!techniques.length||techniques.length>4096||new Set(techniques.map(t=>t.id)).size!==techniques.length||
    new Set(techniques.map(t=>t.stixId)).size!==techniques.length)throw new Error('Duplicate or oversized ATTACK technique set');
  const c={...m,techniques},out={...c,knowledgeHash:sha256Canonical(c)};
  if(!isAttackKnowledge(out))throw new Error('Invalid normalized ATTACK knowledge');return out;
}
/** Operator hashes/review declarations are not independent source authentication or legal attestation. */
export function isAttackKnowledge(value:unknown):value is AttackKnowledge {
  const c=value as AttackKnowledge;
  try{return attackKeys(c,['schemaVersion','knowledgeHash','version','commit','bundleSha256','licenseSha256','sourceUrl','licenseUrl',
    'reviewedAt','expiresAt','reviewOwner','sourceAuthentication','techniques'])&&metadata(c)&&hash(c.knowledgeHash)&&
    Array.isArray(c.techniques)&&c.techniques.length>0&&c.techniques.length<=4096&&
    new Set(c.techniques.map(t=>t.id)).size===c.techniques.length&&new Set(c.techniques.map(t=>t.stixId)).size===c.techniques.length&&
    c.techniques.every(t=>attackKeys(t,['id','stixId','name','version','url','tactics'])&&attackId(t.id)&&
      stixId(t.stixId)&&text(t.name,256)&&text(t.version,32)&&t.url===attackTechniqueUrl(t.id)&&
      Array.isArray(t.tactics)&&t.tactics.length<=32&&new Set(t.tactics).size===t.tactics.length&&
      t.tactics.every(x=>text(x,64)&&/^[a-z0-9-]+$/.test(x)))&&Buffer.byteLength(JSON.stringify(c))<=1000000&&
    sha256Canonical((({knowledgeHash:_h,...rest})=>rest)(c))===c.knowledgeHash;
  }catch{return false;}
}
