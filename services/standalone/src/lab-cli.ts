import 'dotenv/config';
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateLabBatch, labBatchHash, socProfile } from '@asq/sdk';
import { ControlPlaneServer } from '../../control-plane/src/server.js';

async function main() {
  const args=process.argv.slice(2), value=(key:string)=>args[args.indexOf(key)+1];
  if(!args.includes('--batch') || !args.includes('--profile')) throw new Error('Usage: lab:run -- --batch data/lab/export.json --profile lab|replay --own-device|--replay-authorized');
  const profile=value('--profile');
  if(!['lab','replay'].includes(profile) || process.env.GSS_RUNTIME_ENV==='staging') throw new Error('Lab CLI cannot operate staging');
  if(!args.includes(profile==='lab'?'--own-device':'--replay-authorized')) throw new Error('Explicit data authorization required; company logs are outside this CLI scope.');
  const root=await realpath(resolve('data/lab')),file=await realpath(resolve(value('--batch')));
  if(!file.startsWith(root+sep) || !file.endsWith('.json') || (await stat(file)).size>512000) throw new Error('Batch must be a bounded JSON file under private data/lab');
  const batch=validateLabBatch(JSON.parse(await readFile(file,'utf8')));
  if(batch.sourceId!=='local-windows' || batch.sourceKind!==(profile==='lab'?'LAB_LIVE':'REPLAY')) throw new Error('Source/profile mismatch');
  process.env.GSS_SOC_PROFILE=profile; socProfile();
  process.env.GSS_LAB_OWN_DEVICE_AUTHORIZED='true';process.env.GSS_LAB_ALLOWED_SOURCES='local-windows';
  process.env.GSS_DATA_DIR=resolve('data');
  process.env.GSS_CONTROL_PLANE_TOKEN=randomBytes(32).toString('base64url');
  const server=new ControlPlaneServer(0);
  try {
    const base='http://127.0.0.1:'+await server.ready();
    async function post(path:string,body:unknown) {
      const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.GSS_CONTROL_PLANE_TOKEN,'x-gss-actor':'own-device-lab-operator'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const payload=await response.json() as Record<string,any>;
      if(!response.ok)throw new Error('Control Plane '+response.status+': '+payload.error);
      return payload;
    }
    const checksum=labBatchHash(batch),caseId='LABCASE-'+checksum.slice(0,24);
    const imported=await post('/control/v1/lab/batches',{batch,checksum,idempotencyKey:'import-'+checksum});
    await post('/control/v1/cases',{caseId});
    if(!batch.events.length)throw new Error('No event timestamps for case query; imported empty batch retained, no fabricated evidence.');
    const times=batch.events.map(event=>Date.parse(event.eventTime)),end=Math.max(...times)+1,start=Math.max(Math.min(...times),end-7*86400000);
    const receipt=await post(`/control/v1/cases/${caseId}/lab-investigations`,{batchHash:checksum,idempotencyKey:'query-'+checksum,
      indicator:{type:'HOSTNAME',value:batch.events[0].hostId},timeRange:{start:new Date(start).toISOString(),end:new Date(end).toISOString()},limit:100});
    await mkdir(root,{recursive:true});
    const report=resolve(root,caseId+'-report.json');
    await writeFile(report,JSON.stringify(receipt,null,2),{mode:0o600});
    console.log(JSON.stringify({caseId,importReplay:imported.replay,queryReplay:receipt.replay,frontierVersion:receipt.loop.frontier.version,
      decision:receipt.loop.decision.kind,verdict:receipt.report.verdict,report},null,2));
  } finally { await server.close(); }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Lab run failed');process.exitCode=1;});
