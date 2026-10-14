import {open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {evaluateSocInvestigations} from '@asq/sdk';
const [file,flag,pin,authorized]=process.argv.slice(2);
if(!file||flag!=='--sha256'||!/^[a-f0-9]{64}$/.test(pin??'')||authorized!=='--local-authorized'||process.argv.slice(2).length!==4||
  /^[\\/]{2}/.test(file)||/^[\\/]{2}/.test(process.env.GSS_DATA_DIR??''))
  throw new Error('Usage: npm.cmd run soc:eval -- private-input.json --sha256 reviewed-raw-sha256 --local-authorized');
const base=await realpath(resolve(process.env.GSS_DATA_DIR??'data')),expectedRoot=resolve(base,'soc-eval');
const root=await realpath(expectedRoot),path=await realpath(resolve(file)),within=relative(root,path);
if(relative(expectedRoot,root)!==''||!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within)||!path.endsWith('.json'))throw new Error('Private SOC evaluation root required');
const handle=await open(path,'r');
try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size>8_000_000)throw new Error('Evaluation input exceeds bounds');
  const buffer=Buffer.alloc(8_000_001),{bytesRead}=await handle.read(buffer,0,buffer.length,0),raw=buffer.subarray(0,bytesRead);
  if(bytesRead>8_000_000||createHash('sha256').update(raw).digest('hex')!==pin)throw new Error('Evaluation raw-byte pin/size mismatch');
  let input;
  try{input=JSON.parse(raw.toString('utf8'));}catch{throw new Error('Invalid SOC evaluation JSON; private content omitted');}
  const report=evaluateSocInvestigations(input);
  // stdout is an operator-local report; no raw claims/frontiers/prompts are reproduced or uploaded.
  console.log(JSON.stringify(report,null,2));
}finally{await handle.close();}
