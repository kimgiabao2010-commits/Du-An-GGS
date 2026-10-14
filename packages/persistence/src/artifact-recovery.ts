import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,open,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {sha256Canonical,labBatchHash,validateLabBatch} from '@asq/sdk';

export interface RecoverableArtifact {ref:string;sha256:string;bytes:number;hashMode:'SHA256_BYTES'|'JCS_LAB_BATCH'}
export interface ArtifactBackupManifest {
  schemaVersion:'gss.artifact-backup.v1';createdAt:string;scope:'EXPLICIT_APPROVED_REFERENCES_ONLY';
  entries:Array<RecoverableArtifact & {blobHash:string}>;totalBytes:number;
}
const digest=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
function pathFor(root:string,e:RecoverableArtifact):string {
  if(!/^[a-f0-9]{64}$/.test(e.sha256)||!Number.isSafeInteger(e.bytes)||e.bytes<0||e.bytes>8_000_000)throw new Error('Invalid artifact recovery metadata');
  if(e.hashMode==='JCS_LAB_BATCH'&&e.ref===`artifact://lab/${e.sha256}.json`&&e.bytes<=512_000)
    return resolve(root,'lab-artifacts',e.sha256+'.json');
  const match=e.ref.match(/^artifact:\/\/evidence\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9_-]{1,180}-[a-f0-9]{12}\.txt)$/);
  if(e.hashMode==='SHA256_BYTES'&&match&&e.ref.endsWith('-'+e.sha256.slice(0,12)+'.txt'))return resolve(root,'evidence',match[1],match[2]);
  throw new Error('Unsupported/traversal artifact reference; no remote store fallback');
}
async function safePath(path:string){
  if(/^[\\/]{2}/.test(path))throw new Error('Network artifact root denied');
  for(let p=resolve(path);dirname(p)!==p;p=dirname(p)){
    try{if((await lstat(p)).isSymbolicLink())throw new Error('Artifact symlink/reparse path denied');}
    catch(e:any){if(e.code!=='ENOENT')throw e;}
  }
}
async function boundedRead(path:string,max:number):Promise<Buffer>{
  await safePath(path);const handle=await open(path,'r');
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size>max)throw new Error('Artifact recovery byte/type limit');
    const buffer=Buffer.alloc(max+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>max)throw new Error('Artifact grew beyond recovery limit');return buffer.subarray(0,bytesRead);
  }finally{await handle.close();}
}
function verify(e:RecoverableArtifact,raw:Buffer){
  let actual:string;
  try{actual=e.hashMode==='JCS_LAB_BATCH'?labBatchHash(validateLabBatch(JSON.parse(raw.toString('utf8')))):digest(raw);}
  catch{throw new Error('Invalid private lab artifact; content omitted');}
  if(raw.length!==e.bytes||actual!==e.sha256)throw new Error('Artifact recovery hash/size mismatch');
}
function validateEntries(entries:RecoverableArtifact[]){
  if(!Array.isArray(entries)||!entries.length||entries.length>256||new Set(entries.map(e=>e.ref)).size!==entries.length||
    entries.reduce((n,e)=>n+e.bytes,0)>128*1024*1024)throw new Error('Explicit bounded unique artifact references required');
  for(const e of entries)pathFor(resolve('unused-recovery-validation'),e);
}
/** No directory-wide scan: operator-approved references only. Original data is never removed or overwritten. */
export async function backupApprovedArtifacts(sourceRoot:string,backupParent:string,entries:RecoverableArtifact[]){
  validateEntries(entries);await safePath(sourceRoot);await safePath(backupParent);await mkdir(backupParent,{recursive:true});
  const directory=resolve(backupParent,'gss-artifacts-'+randomUUID());await mkdir(directory);await mkdir(resolve(directory,'blobs'));
  const copied:ArtifactBackupManifest['entries']=[],blobs=new Set<string>();
  for(const e of entries){
    const raw=await boundedRead(pathFor(sourceRoot,e),e.bytes);verify(e,raw);const blobHash=digest(raw);
    if(!blobs.has(blobHash)){await writeFile(resolve(directory,'blobs',blobHash+'.bin'),raw,{flag:'wx',mode:0o600});blobs.add(blobHash);}
    copied.push({...e,blobHash});
  }
  const manifest:ArtifactBackupManifest={schemaVersion:'gss.artifact-backup.v1',createdAt:new Date().toISOString(),
    scope:'EXPLICIT_APPROVED_REFERENCES_ONLY',entries:copied,totalBytes:copied.reduce((n,e)=>n+e.bytes,0)};
  await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
  return {directory,manifest,manifestHash:sha256Canonical(manifest)};
}
/** Restore only to a freshly generated isolated root. A failed copy stays private/unverified, never adopted. */
export async function restoreApprovedArtifacts(directory:string,restoreParent:string,expectedManifestHash:string){
  await safePath(directory);const rawManifest=await boundedRead(resolve(directory,'manifest.json'),512_000);
  let manifest:ArtifactBackupManifest;
  try{manifest=JSON.parse(rawManifest.toString('utf8'));}catch{throw new Error('Invalid backup manifest; private content omitted');}
  if(!/^[a-f0-9]{64}$/.test(expectedManifestHash)||sha256Canonical(manifest)!==expectedManifestHash||
    manifest.schemaVersion!=='gss.artifact-backup.v1'||manifest.scope!=='EXPLICIT_APPROVED_REFERENCES_ONLY'||
    !Number.isFinite(Date.parse(manifest.createdAt)))throw new Error('Artifact manifest identity mismatch');
  validateEntries(manifest.entries);
  if(manifest.totalBytes!==manifest.entries.reduce((n,e)=>n+e.bytes,0))throw new Error('Artifact manifest byte count mismatch');
  await safePath(restoreParent);await mkdir(restoreParent,{recursive:true});
  const root=resolve(restoreParent,'gss-restored-artifacts-'+randomUUID());await mkdir(root);
  for(const e of manifest.entries){
    if(!/^[a-f0-9]{64}$/.test(e.blobHash))throw new Error('Invalid content-addressed backup blob');
    const raw=await boundedRead(resolve(directory,'blobs',e.blobHash+'.bin'),e.bytes);
    if(digest(raw)!==e.blobHash)throw new Error('Backup blob integrity failed');verify(e,raw);
    const target=pathFor(root,e);await safePath(target);await mkdir(dirname(target),{recursive:true});
    await writeFile(target,raw,{flag:'wx',mode:0o600});verify(e,await boundedRead(target,e.bytes));
  }
  return {schemaVersion:'gss.artifact-restore.v1' as const,root,manifestHash:expectedManifestHash,
    restoredCount:manifest.entries.length,totalBytes:manifest.totalBytes,originalOverwritten:false,scope:manifest.scope};
}
