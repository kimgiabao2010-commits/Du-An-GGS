import {open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {isAttackKnowledge,type AttackKnowledge} from '@asq/sdk';

/** Reviewed pinned normalized knowledge only; never fetch STIX/IOCs or let a model choose a file. */
export async function loadAttackKnowledge(env:NodeJS.ProcessEnv=process.env):Promise<AttackKnowledge|undefined> {
  const path=env.GSS_ATTACK_CATALOG_FILE,pin=env.GSS_ATTACK_CATALOG_SHA256;
  if(!path&&!pin)return undefined;
  if(!path||!pin||!/^[a-f0-9]{64}$/.test(pin)||!isAbsolute(path)||!path.endsWith('.json')||
    /^[\\/]{2}/.test(path)||/^[\\/]{2}/.test(env.GSS_DATA_DIR??''))throw new Error('ATTACK private path/pin required');
  const base=await realpath(resolve(env.GSS_DATA_DIR??'data')),expected=resolve(base,'knowledge');
  const root=await realpath(expected),file=await realpath(path),within=relative(root,file);
  if([base,root,file].some(x=>/^[\\/]{2}/.test(x))||relative(expected,root)!==''||!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw new Error('ATTACK catalog root denied');
  const handle=await open(file,'r');
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size<2||stat.size>1000000)throw new Error('ATTACK catalog size/type denied');
    const bytes=Buffer.alloc(1000001),{bytesRead}=await handle.read(bytes,0,bytes.length,0),raw=bytes.subarray(0,bytesRead);
    if(bytesRead>1000000||createHash('sha256').update(raw).digest('hex')!==pin)throw new Error('ATTACK catalog pin mismatch');
    let c:unknown;try{c=JSON.parse(raw.toString('utf8'));}catch{throw new Error('Invalid ATTACK JSON; content omitted');}
    if(!isAttackKnowledge(c))throw new Error('Invalid ATTACK knowledge/schema');return c;
  }finally{await handle.close();}
}
