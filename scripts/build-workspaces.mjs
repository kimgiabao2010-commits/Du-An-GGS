import { spawn } from 'node:child_process';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Explicit dependency order avoids competing output writers and locked Turbo log files on Windows.
const workspaces=['packages/sdk','packages/auth','packages/persistence','packages/cli','services/control-plane'];
async function run(args,cwd) {
  const code=await new Promise((resolveCode,reject)=>{
    const child=spawn(process.execPath,args,{cwd,stdio:'inherit',windowsHide:true});
    child.once('error',reject);child.once('exit',code=>resolveCode(code ?? 1));
  });
  if(code!==0) process.exit(code);
}
for(const workspace of workspaces) {
  console.log('Building '+workspace+' (atomic TypeScript output)');
  await run([resolve(root,'scripts/build-typescript.mjs')],resolve(root,workspace));
  if(workspace==='packages/sdk') await run([resolve(root,'scripts/copy-sdk-proto.mjs')],root);
}
await run([resolve(root,'node_modules/next/dist/bin/next'),'build'],resolve(root,'apps/standalone'));
console.log('Workspace build: 6/6 PASS; no cached verification output.');
