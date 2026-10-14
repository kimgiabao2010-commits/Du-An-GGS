import {open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {isOfflineIntelCatalog,type OfflineIntelCatalog} from '@asq/sdk';

/** Read once before listening. Private data root, bounded handle, raw-byte pin, no URLs or automatic feed downloads. */
export async function loadOfflineIntel(env:NodeJS.ProcessEnv=process.env):Promise<OfflineIntelCatalog|undefined> {
  const path=env.GSS_OFFLINE_INTEL_CATALOG_FILE,expected=env.GSS_OFFLINE_INTEL_CATALOG_SHA256;
  if(!path && !expected)return undefined;
  if(!path || !expected || !/^[a-f0-9]{64}$/.test(expected) || !isAbsolute(path) || !path.endsWith('.json') ||
    /^[\\/]{2}/.test(path) || /^[\\/]{2}/.test(env.GSS_DATA_DIR??''))
    throw new Error('Offline intel requires a private absolute JSON path and reviewed SHA-256 pin');
  const base=await realpath(resolve(env.GSS_DATA_DIR??'data')),expectedRoot=resolve(base,'offline-intel');
  const root=await realpath(expectedRoot),file=await realpath(path),within=relative(root,file);
  if(relative(expectedRoot,root)!=='')throw new Error('Offline intel catalog root must not redirect');
  if(!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw new Error('Offline intel path outside private catalog root');
  const handle=await open(file,'r');
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size<2||stat.size>512_000)throw new Error('Offline intel file size/type denied');
    const buffer=Buffer.alloc(512_001),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>512_000)throw new Error('Offline intel grew beyond byte limit');
    const raw=buffer.subarray(0,bytesRead);
    if(createHash('sha256').update(raw).digest('hex')!==expected)throw new Error('Offline intel pin mismatch');
    const catalog:unknown=JSON.parse(raw.toString('utf8'));
    if(!isOfflineIntelCatalog(catalog))throw new Error('Offline intel metadata/schema denied');
    return catalog;
  }finally{await handle.close();}
}
