import {open,realpath,mkdir,writeFile,unlink,lstat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,join,dirname} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {freemem} from 'node:os';
import {connect} from 'node:net';
const exec=promisify(execFile);
const RUNTIME_SHA='8708a7b81842333927f6377ac3f17ff8bba4dbe1ee0cf28dfd5e7a32e3a46b38';
const WEIGHTS_SHA='7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5';
const within=(root,file)=>{const p=relative(root,file);return !!p&&p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p);};
export function managedModelConfig(env=process.env) {
  if(env.GSS_LOCAL_MODEL_MANAGED!=='true')return null;
  if(process.platform!=='win32'||process.arch!=='x64'||env.GSS_LOCAL_CONVERSATION_ENABLED!=='true'||
    !['lab','replay'].includes(env.GSS_SOC_PROFILE??'')||env.GSS_RUNTIME_ENV==='staging')throw Error('Managed model profile/platform denied');
  const file=env.GSS_LOCAL_MODEL_CANDIDATE_FILE,pin=env.GSS_LOCAL_MODEL_CANDIDATE_SHA256;
  if(!file||!isAbsolute(file)||/^[\\/]{2}/.test(file)||!/^[a-f0-9]{64}$/.test(pin??''))throw Error('Managed candidate private file/pin required');
  const url=new URL(env.GSS_LOCAL_MODEL_URL??'http://127.0.0.1:8080/v1/chat/completions');
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||Number(url.port)<1024||url.username||url.password||
    url.search||url.hash||url.pathname!=='/v1/chat/completions')throw Error('Managed model literal loopback endpoint required');
  const model=env.GSS_LOCAL_CONVERSATION_MODEL??'';
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model))throw Error('Managed model alias required');
  if(env.GSS_LOCAL_MODEL_ASSET_DIR&&(!isAbsolute(env.GSS_LOCAL_MODEL_ASSET_DIR)||/^[\\/]{2}/.test(env.GSS_LOCAL_MODEL_ASSET_DIR)))throw Error('Managed asset root must be private local absolute path');
  return {file,pin,url,model};
}
async function verifyAsset(root,file,bytes,digest) {
  const actual=await realpath(file);
  if(/^[\\/]{2}/.test(actual)||!within(root,actual)||(await lstat(file)).isSymbolicLink())throw Error('Managed asset path denied');
  const handle=await open(actual,'r');
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==bytes)throw Error('Managed asset byte size mismatch');
    const sha=createHash('sha256'),stream=handle.createReadStream({autoClose:false,start:0,end:bytes-1});let read=0;
    const timer=setTimeout(()=>stream.destroy(Error('Managed asset checksum deadline')),180000);
    try{for await(const chunk of stream){read+=chunk.length;sha.update(chunk);}}
    finally{clearTimeout(timer);}
    if(read!==bytes||(await handle.stat()).size!==bytes||sha.digest('hex')!==digest)throw Error('Managed asset hash/size mismatch');return actual;
  }finally{await handle.close();}
}
async function portBusy(port){return new Promise(accept=>{const s=connect({host:'127.0.0.1',port});
  s.once('connect',()=>{s.destroy();accept(true);});s.once('error',()=>{s.destroy();accept(false);});s.setTimeout(1000,()=>{s.destroy();accept(true);});});}

/** ONLY the previously verified pinned CPU runtime/checkpoint, no download/global install/host-shell fallback. */
export async function startManagedModel(env=process.env) {
  const config=managedModelConfig(env);if(!config)return null;
  if(freemem()<8*1024**3)throw Error('Managed model requires at least8GiB currently available RAM');
  if(await portBusy(Number(config.url.port)))throw Error('Managed model port occupied; existing server not adopted or stopped');
  const base=await realpath(resolve(env.GSS_DATA_DIR??'data')),expected=env.GSS_LOCAL_MODEL_ASSET_DIR??join(base,'models'),root=await realpath(expected);
  if(/^[\\/]{2}/.test(base)||relative(expected,root)!=='')throw Error('Private local model root must not redirect');
  const manifestFile=await realpath(config.file);
  if(!within(root,manifestFile)||/^[\\/]{2}/.test(manifestFile))throw Error('Managed candidate outside private models root');
  const handle=await open(manifestFile,'r');let candidate;
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>32000)throw Error('Managed candidate size/type denied');
    const buffer=Buffer.alloc(32001),{bytesRead}=await handle.read(buffer,0,buffer.length,0),raw=buffer.subarray(0,bytesRead);
    if(bytesRead>32000||createHash('sha256').update(raw).digest('hex')!==config.pin)throw Error('Managed candidate pin mismatch');
    try{candidate=JSON.parse(raw.toString('utf8'));}catch{throw Error('Managed candidate JSON invalid; content omitted');}
  }finally{await handle.close();}
  if(candidate.schemaVersion!=='gss.local-model-candidate.v1'||candidate.runtimeTag!=='b11609'||candidate.promotionAllowed!==false||
    candidate.model!=='Qwen/Qwen3-4B-GGUF'||candidate.modelRevision!=='bc640142c66e1fdd12af0bd68f40445458f3869b'||
    candidate.runtimeLicense!=='MIT'||!candidate.modelLicense?.startsWith('apache-2.0')||
    candidate.binary?.sha256!==RUNTIME_SHA||candidate.weights?.sha256!==WEIGHTS_SHA)throw Error('Unsupported/unreviewed candidate; no silent substitution');
  const archive=await verifyAsset(root,candidate.binary.file,19518618,RUNTIME_SHA);
  const weights=await verifyAsset(root,candidate.weights.file,2497280256,WEIGHTS_SHA);
  const folder=join(base,'owned-model-runtime-'+randomUUID());await mkdir(folder);const keyFile=join(folder,'api-key.txt');
  const tar=resolve(process.env.SystemRoot??'C:/Windows','System32','tar.exe');
  const listed=await exec(tar,['-tf',archive],{windowsHide:true,timeout:15000,maxBuffer:1000000});
  const entries=listed.stdout.split(/\r?\n/).filter(Boolean);
  if(!entries.length||entries.length>256||entries.some(p=>p.startsWith('/')||p.includes('\\')||p.split('/').includes('..')||
    p.includes(':')||!/^[-a-zA-Z0-9_./]+$/.test(p)))throw Error('Pinned runtime archive layout denied');
  // Exact official ZIP digest above; fresh directory prevents adopting modified extracted DLLs.
  await exec(tar,['-xf',archive,'-C',folder],{windowsHide:true,timeout:15000,maxBuffer:1000000});
  const relativeExe=entries.find(p=>p.endsWith('llama-server.exe'));
  if(!relativeExe)throw Error('Pinned runtime has no server executable');
  const executable=await realpath(join(folder,relativeExe));if(!within(folder,executable))throw Error('Native executable escaped owned runtime');
  const key=randomBytes(32).toString('base64url');await writeFile(keyFile,key+'\n',{flag:'wx',mode:0o600});
  const nativeEnv={};for(const k of ['SystemRoot','WINDIR','PATH','TEMP','TMP'])if(process.env[k])nativeEnv[k]=process.env[k];
  let spawnFailed=false;const child=spawn(executable,['--model',weights,'--host','127.0.0.1','--port',config.url.port,
    '--alias',config.model,'--threads','2','--threads-batch','2','--ctx-size','2048','--parallel','1','--n-gpu-layers','0',
    '--n-predict','512','--api-key-file',keyFile,'--no-cache-prompt','--no-slots','--reasoning','off','--poll','0','--poll-batch','0','--prio','-1'],
    {cwd:dirname(executable),env:nativeEnv,windowsHide:true,stdio:'ignore'});
  child.once('error',()=>{spawnFailed=true;});
  let closed=false;const close=async()=>{if(closed)return;closed=true;
    if(child.pid&&child.exitCode===null&&!spawnFailed){child.kill('SIGTERM');
      let timer;try{await Promise.race([new Promise(accept=>child.once('exit',accept)),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned native cleanup deadline')),10000);})]);}
      finally{clearTimeout(timer);}}
    // Delete only our UUID-owned ephemeral credential; assets/runtime copy remain private.
    if(!within(folder,keyFile))throw Error('Owned credential cleanup denied');await unlink(keyFile);
  };
  try{const deadline=Date.now()+120000;let ready=false;
    while(Date.now()<deadline&&child.exitCode===null&&!spawnFailed){
      try{const headers={authorization:'Bearer '+key},url=config.url.origin+'/v1/models';
        const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(1000)});
        if(r.ok&&(await r.json()).data?.some(m=>m.id===config.model)){
          const denied=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(1000)});
          if(denied.status!==401)throw Error('Native authentication not enforced');ready=true;break;}}
      catch{}await new Promise(accept=>setTimeout(accept,200));
    }
    if(!ready)throw Error('Owned native model/auth readiness failed');
    return {apiKey:key,model:config.model,close,child,receipt:{runtimeTag:'b11609',modelRevision:candidate.modelRevision,
      weightsSha256:WEIGHTS_SHA,archiveSha256:RUNTIME_SHA,role:'CONVERSATION',promotionAllowed:false,socQuality:'NOT RUN',
      authenticated:true,bind:'127.0.0.1',threads:2,context:2048,parallel:1,costStatus:'UNKNOWN'}};
  }catch(error){await close();throw error;}
}
