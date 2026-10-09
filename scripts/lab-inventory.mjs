import { totalmem, freemem, cpus, platform, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
function probe(command,args) {
  const result=spawnSync(command,args,{encoding:'utf8',timeout:3000,windowsHide:true,maxBuffer:65536});
  return {status:result.status===0?'PASS':'BLOCKED',reason:result.error?.code ?? (result.status===0?'Command responded; not an execution/HA certification.':'Unavailable or permission denied.')};
}
const inventory={schemaVersion:'gss.lab-inventory.v1',collectedAt:new Date().toISOString(),platform:platform(),arch:arch(),
  ramBytes:totalmem(),availableRamBytes:freemem(),logicalCpus:cpus().length,
  wsl:platform()==='win32'?probe('wsl.exe',['--list','--quiet']):{status:'NOT RUN',reason:'Not Windows'},
  docker:probe('docker',['info','--format','{{json .SecurityOptions}}']),
  gpu:{status:'NOT RUN',reason:'No checkpoint selected; GPU/VRAM measurement requires separate profiling.'},
  recommendation:'One investigation at a time; model reasoning disabled until resource and SOC evaluation gates pass.'};
await mkdir(resolve('data/lab'),{recursive:true});
await writeFile(resolve('data/lab/inventory.json'),JSON.stringify(inventory,null,2),{mode:0o600});
console.log(JSON.stringify(inventory,null,2));
