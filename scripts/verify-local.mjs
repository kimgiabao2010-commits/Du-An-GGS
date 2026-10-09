import { spawn } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const npmCli=resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const plan=[['source','source:check'],['skills','skills:audit'],['build','build','--','--force'],['types','typecheck'],
  ['unit','test:unit'],['integration','test:integration'],['environment','test:environment'],['smoke','test:smoke'],
  ['browser','test:browser']];
async function sourceFingerprint() {
  const files=[];
  const excluded=new Set(['node_modules','dist','.next','.next-production','.turbo','data','.git','test-results']);
  async function visit(folder) {
    for(const entry of await readdir(resolve(root,folder),{withFileTypes:true})) {
      if(excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const path=folder+'/'+entry.name;
      if(entry.isDirectory()) await visit(path);
      else if(/\.(?:ts|tsx|mjs|json|sql|ya?ml|css|proto|md)$/.test(entry.name)) files.push(path);
    }
  }
  for(const folder of ['apps','packages','services','scripts','tests','infra','agent-skills','.github','.vscode']) await visit(folder);
  files.push('package.json','package-lock.json','turbo.json','tsconfig.json','.env.example',
    'vitest.unit.config.ts','vitest.integration.config.ts','playwright.config.ts','.dockerignore');
  const hash=createHash('sha256');
  for(const file of files.sort()) { hash.update(file+'\0');hash.update(createHash('sha256').update(await readFile(resolve(root,file))).digest()); }
  return hash.digest('hex');
}
const sourceBefore=await sourceFingerprint();
const revision=execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const folder=resolve(root,'data/verification',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
await mkdir(folder,{recursive:true});
const checks=[];
for (const [gate,script,...args] of plan) {
  const startedAt=new Date().toISOString(); const chunks=[];
  const code=await new Promise(resolveCode=>{
    const child=spawn(process.execPath,[npmCli,'run',script,...args],{cwd:root,env:process.env,windowsHide:true});
    child.stdout.on('data',chunk=>{process.stdout.write(chunk);chunks.push(chunk);});
    child.stderr.on('data',chunk=>{process.stderr.write(chunk);chunks.push(chunk);});
    child.once('error',()=>resolveCode(1));child.once('exit',code=>resolveCode(code ?? 1));
  });
  const log=Buffer.concat(chunks); const logName=gate+'.log';await writeFile(resolve(folder,logName),log);
  checks.push({gate,status:code===0?'PASS':'FAILED',environment:'local',command:['npm.cmd','run',script,...args].join(' '),
    exitCode:code,startedAt,finishedAt:new Date().toISOString(),log:logName,sha256:createHash('sha256').update(log).digest('hex')});
}
// Build/verification dependencies are part of the supply chain too; retain both logs.
for(const [gate,args] of [['dependency-audit',['--omit=dev','--audit-level=high']],
  ['dependency-audit-all',['--audit-level=high']]]) {
  const startedAt=new Date().toISOString(),chunks=[];
  const code=await new Promise(resolveCode=>{
    const child=spawn(process.execPath,[npmCli,'audit',...args],{cwd:root,windowsHide:true});
    child.stdout.on('data',chunk=>{process.stdout.write(chunk);chunks.push(chunk);});
    child.stderr.on('data',chunk=>{process.stderr.write(chunk);chunks.push(chunk);});
    child.once('error',()=>resolveCode(1));child.once('exit',code=>resolveCode(code ?? 1));
  });
  const log=Buffer.concat(chunks),logName=gate+'.log';await writeFile(resolve(folder,logName),log);
  checks.push({gate,status:code===0?'PASS':'FAILED',environment:'local',command:['npm.cmd','audit',...args].join(' '),
    exitCode:code,startedAt,finishedAt:new Date().toISOString(),log:logName,sha256:createHash('sha256').update(log).digest('hex')});
}
const external=['chronicle-live','rootless-sandbox-adversarial','oidc-browser-staging','workload-identity-staging','object-lock-live',
  'otlp-staging-trace','model-labeled-eval','osv-trivy-remote','load-SLO-staging','72-hour-freeze'];
const manifest={schemaVersion:'gss.verification-report.v1',createdAt:new Date().toISOString(),
  revision,sourceFingerprint:sourceBefore,sourceUnchangedDuringVerification:sourceBefore===await sourceFingerprint(),
  packageLockSha256:createHash('sha256').update(await readFile(resolve(root,'package-lock.json'))).digest('hex'),
  localStatus:checks.some(check=>check.status==='FAILED')?'FAILED':'PASS',releaseStatus:'BLOCKED',checks,
  externalGates:external.map(gate=>({gate,status:'NOT RUN',reason:'Local verification is not staging evidence; see advancement report.'}))};
if(!manifest.sourceUnchangedDuringVerification) manifest.localStatus='FAILED';
await writeFile(resolve(folder,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('Verification manifest: '+resolve(folder,'manifest.json'));
console.log('Local: '+manifest.localStatus+'. Release: BLOCKED until all external hard gates are evidenced.');
process.exitCode=manifest.localStatus==='PASS'?0:1;
