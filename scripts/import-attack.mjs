import {open,realpath,mkdir,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,relative,isAbsolute,sep,join} from 'node:path';
import {importAttackKnowledge} from '@asq/sdk';

async function main(){
  const [bundle,pin,license,licensePin,version,commit,owner,expires,authorization]=process.argv.slice(2);
  if(process.argv.slice(2).length!==9||authorization!=='--local-authorized'||!bundle||!license||
    !/^[a-f0-9]{64}$/.test(pin??'')||!/^[a-f0-9]{64}$/.test(licensePin??'')||/^[\\/]{2}/.test(process.env.GSS_DATA_DIR??''))
    throw new Error('Usage: attack:import -- private-bundle raw-sha256 private-license license-sha256 version commit review-owner expiry --local-authorized');
  const base=await realpath(resolve(process.env.GSS_DATA_DIR??'data')),expected=resolve(base,'knowledge'),root=await realpath(expected);
  if(/^[\\/]{2}/.test(base)||/^[\\/]{2}/.test(root)||relative(expected,root)!=='')throw new Error('Knowledge root must not redirect');
  async function readPinned(file,digest,limit){
    if(/^[\\/]{2}/.test(file))throw new Error('Remote knowledge path denied');
    const path=await realpath(resolve(file)),within=relative(root,path);
    if(/^[\\/]{2}/.test(path)||!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw new Error('Private knowledge input required');
    const handle=await open(path,'r');try{
      const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>limit)throw new Error('Knowledge size/type denied');
      const buffer=Buffer.alloc(limit+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0),raw=buffer.subarray(0,bytesRead);
      if(bytesRead>limit||createHash('sha256').update(raw).digest('hex')!==digest)throw new Error('Knowledge byte pin mismatch');return {path,raw};
    }finally{await handle.close();}
  }
  const input=await readPinned(bundle,pin,64000000),notice=await readPinned(license,licensePin,16000);
  let b;try{b=JSON.parse(input.raw.toString('utf8'));}catch{throw new Error('Invalid STIX JSON; content omitted');}
  const catalog=importAttackKnowledge(b,{version,commit,bundleSha256:pin,licenseSha256:licensePin,reviewOwner:owner,
    reviewedAt:new Date().toISOString(),expiresAt:expires});
  const folder=join(root,'catalog-'+randomUUID());await mkdir(folder);
  const file=join(folder,'catalog.json'),bytes=JSON.stringify(catalog,null,2);
  // Preserve the exact reviewed notice with this derivative; do not adopt a changed input path after hashing.
  await writeFile(join(folder,'LICENSE.txt'),notice.raw,{flag:'wx',mode:0o600});
  await writeFile(file,bytes,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({schemaVersion:'gss.attack-import-receipt.v1',createdAt:new Date().toISOString(),status:'PASS_NORMALIZED_IMPORT',
    version,commit,techniqueCount:catalog.techniques.length,knowledgeHash:catalog.knowledgeHash,catalogFile:file,
    catalogRawSha256:createHash('sha256').update(bytes).digest('hex'),bundleSha256:pin,licenseSha256:licensePin,
    sourceAuthentication:catalog.sourceAuthentication,runtimeActivated:false,socQuality:'NOT RUN',paidCalls:0}));
}
main().catch(()=>{console.error('ATTACK import rejected; check private path, byte pins, size, metadata and license review. Content omitted.');process.exitCode=1;});
