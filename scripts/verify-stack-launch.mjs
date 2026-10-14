import 'dotenv/config';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {connect} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {chromium} from '@playwright/test';
import {localDatabaseTarget} from './backup-local-postgres.mjs';

// Exercises the actual Ctrl+Shift+B entry point, but never dispatches existing user tasks.
async function occupied(port) {
  return new Promise(accept=>{
    const socket=connect({host:'127.0.0.1',port});
    socket.once('connect',()=>{socket.destroy();accept(true);});
    socket.once('error',()=>{socket.destroy();accept(false);});
    socket.setTimeout(1000,()=>{socket.destroy();accept(true);});
  });
}
async function stop(child) {
  if(!child?.pid || child.exitCode!==null)return;
  if(process.platform==='win32')await new Promise((accept,reject)=>{
    const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.once('error',reject);killer.once('exit',code=>code===0||child.exitCode!==null?accept():reject(new Error('Owned launcher cleanup failed')));
  });
  else {child.kill('SIGTERM');await new Promise(accept=>child.once('exit',accept));}
}
async function main() {
  if(!process.argv.includes('--local-authorized'))throw new Error('Use --local-authorized for isolated local launcher verification.');
  localDatabaseTarget(process.env.DATABASE_URL??'',process.env.GSS_RUNTIME_ENV??'local');
  for(const port of [3000,4000,4100])if(await occupied(port))throw new Error('Required local port occupied; existing service left untouched.');
  const schema='gss_launch_'+randomUUID().replaceAll('-','');
  if(!/^gss_launch_[a-f0-9]{32}$/.test(schema))throw new Error('Invalid isolated schema');
  const admin=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  const folder=resolve('data/verification/launcher-'+Date.now());await mkdir(folder,{recursive:true});
  let created=false,child,browser,db,spawnFailed=false;
  const receipt={schemaVersion:'gss.launcher-check.v1',startedAt:new Date().toISOString(),status:'FAILED',
    environment:'local isolated PostgreSQL schema, real launcher/UI/worker connections',taskExecution:'NOT RUN',
    chronicle:'NOT RUN',sandbox:'NOT RUN',modelInference:'NOT RUN',cleanup:'NOT RUN'};
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);created=true;
    const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
    const env={...process.env};
    for(const key of Object.keys(env))if(/^(ASQ_|GSS_|OPENAI_|GROQ_|GOOGLE_|AWS_|OTEL_|CONTROL_PLANE_|DATABASE_)/.test(key))delete env[key];
    Object.assign(env,{DATABASE_URL:url.toString(),GSS_RUNTIME_ENV:'local',GSS_SOC_PROFILE:'lab',
      GSS_LOCAL_CONVERSATION_ENABLED:'false',GSS_DATA_DIR:resolve(folder,'runtime'),
      DOTENV_CONFIG_PATH:resolve('scripts/runtime-child.env')});
    db=new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000});
    child=spawn(process.execPath,[resolve('scripts/dev-stack.mjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    // Do not retain launcher output containing ephemeral/demo credentials or user-local configuration.
    child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});child.once('error',()=>{spawnFailed=true;});
    const deadline=Date.now()+180000;let ready=false;
    while(Date.now()<deadline && child.exitCode===null && !spawnFailed){
      try{const ui=await fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(1000)});
        const cp=await fetch('http://127.0.0.1:4100/readyz',{signal:AbortSignal.timeout(1000)});
        if(ui.ok && cp.ok && (await cp.json()).status==='ready'){ready=true;break;}}catch{}
      await new Promise(accept=>setTimeout(accept,250));
    }
    if(!ready)throw new Error('Launcher failed readiness; run dev:check to inspect prerequisites.');
    browser=await chromium.launch({headless:true});const page=await browser.newPage();
    await page.goto('http://127.0.0.1:3000/login');
    await page.getByLabel('Username',{exact:true}).fill('BaoNVG');await page.getByLabel('Password',{exact:true}).fill('1');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/\/standalone$/);
    let workers=[];const until=Date.now()+45000;
    while(Date.now()<until){
      const response=await page.request.get('http://127.0.0.1:3000/api/control/workers');
      if(!response.ok())throw new Error('Authenticated worker API unavailable');
      workers=(await response.json()).workers??[];
      if(['cli-worker-agent','ide-worker-agent'].every(id=>workers.some(w=>w.workerId===id&&w.presence==='ONLINE')))break;
      await new Promise(accept=>setTimeout(accept,300));
    }
    if(!['cli-worker-agent','ide-worker-agent'].every(id=>workers.some(w=>w.workerId===id&&w.presence==='ONLINE')))
      throw new Error('Worker connection/heartbeat verification failed');
    const counts=(await db.query('SELECT (SELECT count(*)::int FROM runtime_tasks) tasks,(SELECT count(*)::int FROM model_usage) model_calls')).rows[0];
    if(counts.tasks!==0 || counts.model_calls!==0)throw new Error('Unexpected task/model invocation in isolated startup');
    const migrations=(await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version);
    Object.assign(receipt,{status:'PASS',localDemoLogin:'PASS',controlReadiness:'PASS',workerConnections:workers.map(w=>({
      workerId:w.workerId,presence:w.presence,reportedReadiness:w.reportedReadiness})),migrations,counts});
  }catch(error){receipt.error=error instanceof Error?error.message:'Verification failed';throw error;}
  finally{
    try{await browser?.close();await stop(child);await db?.end();
      if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      receipt.cleanup='PASS: owned processes and isolated test schema only';
    }catch{receipt.status='FAILED';receipt.cleanup='FAILED: operator inspection required';process.exitCode=1;}
    finally{await admin.end();receipt.finishedAt=new Date().toISOString();
      await writeFile(resolve(folder,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
      console.log(JSON.stringify({...receipt,receipt:resolve(folder,'receipt.json')},null,2));}
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
