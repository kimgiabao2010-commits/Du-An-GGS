import 'dotenv/config';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {connect} from 'node:net';
import {mkdir,writeFile,readdir,realpath,lstat,unlink} from 'node:fs/promises';
import {resolve,relative,sep,isAbsolute} from 'node:path';
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
  const candidateArg=process.argv.indexOf('--conversation-candidate'),pinArg=process.argv.indexOf('--candidate-pin');
  const conversation=candidateArg>=0;
  const candidate=conversation?process.argv[candidateArg+1]:null,candidatePin=pinArg>=0?process.argv[pinArg+1]:null;
  if(conversation&&(!candidate||!candidatePin||!/^[a-f0-9]{64}$/.test(candidatePin)))throw new Error('Pinned conversation candidate required');
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
  const markers=[];
  // Record only fixed diagnostic codes, never complete stdout/stderr, credentials or configuration.
  const diagnosticPatterns=[['MIGRATION_STARTED',/Checking PostgreSQL and applying immutable migrations/],
    ['MIGRATION_FAILED',/PostgreSQL migration failed/],['BUILD_STARTED',/Building runtime packages/],
    ['BUILD_PASS',/Workspace build: 6\/6 PASS/],['BUILD_FAILED',/Workspace build failed/],
    ['CONTROL_READY_TIMEOUT',/Control Plane did not become ready/],['CONTROL_READY',/GSS Control Plane ready on/],
    ['CONTROL_EXIT',/\[Control Plane\] exited with code/],['COMMAND_EXIT',/\[Command Center\] exited with code/],
    ['MODULE_LOAD_FAILED',/Cannot find (?:package|module)/],['MIGRATIONS_INCOMPLETE',/storage migrations are incomplete/],
    ['SCHEDULER_CONFLICT',/scheduler_activation_requires_|dispatch_concurrency_state_conflict/],
    ['QUERY_TIMEOUT',/Query read timeout|query_timeout|Connection terminated due to connection timeout/],
    ['POSTGRES_AUTH_FAILED',/password authentication failed/],['TYPE_LOADER_ERROR',/TSError|ERR_UNKNOWN_FILE_EXTENSION/]];
  diagnosticPatterns.push(['MODEL_PREFLIGHT_FAILED',/Local model preflight\/start failed/],['MODEL_READY',/Local model: authenticated CPU Conversation only/]);
  let tail='';const observe=chunk=>{
    tail=(tail+chunk.toString('utf8')).slice(-8192);
    for(const [code,pattern] of diagnosticPatterns)if(pattern.test(tail)&&!markers.some(m=>m.code===code))
      markers.push({code,at:new Date().toISOString()});
  };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);created=true;
    const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
    const env={...process.env};
    for(const key of Object.keys(env))if(/^(ASQ_|GSS_|OPENAI_|GROQ_|GOOGLE_|AWS_|OTEL_|CONTROL_PLANE_|DATABASE_)/.test(key))delete env[key];
    Object.assign(env,{DATABASE_URL:url.toString(),GSS_RUNTIME_ENV:'local',GSS_SOC_PROFILE:'lab',
      GSS_LOCAL_CONVERSATION_ENABLED:'false',GSS_DATA_DIR:resolve(folder,'runtime'),
      DOTENV_CONFIG_PATH:resolve('scripts/runtime-child.env')});
    await mkdir(env.GSS_DATA_DIR,{recursive:true});
    if(conversation)Object.assign(env,{GSS_LOCAL_CONVERSATION_ENABLED:'true',GSS_LOCAL_MODEL_MANAGED:'true',
      GSS_LOCAL_MODEL_CANDIDATE_FILE:resolve(candidate),GSS_LOCAL_MODEL_CANDIDATE_SHA256:candidatePin,GSS_LOCAL_MODEL_ASSET_DIR:resolve('data/models'),
      GSS_LOCAL_MODEL_URL:'http://127.0.0.1:8080/v1/chat/completions',GSS_LOCAL_CONVERSATION_MODEL:'qwen3-local-unpromoted',GSS_LOCAL_MODEL_TIMEOUT_MS:'60000'});
    db=new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000});
    child=spawn(process.execPath,[resolve('scripts/dev-stack.mjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    // Do not retain launcher output containing ephemeral/demo credentials or user-local configuration.
    child.stdout.on('data',observe);child.stderr.on('data',observe);child.once('error',()=>{spawnFailed=true;});
    // This entry point rebuilds all six workspaces first. The measured forced build
    // alone took277s on this host; do not misclassify a180s build interruption as a service failure.
    const deadline=Date.now()+600000;let ready=false;
    while(Date.now()<deadline && child.exitCode===null && !spawnFailed){
      try{const ui=await fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(1000)});
        const cp=await fetch('http://127.0.0.1:4100/readyz',{signal:AbortSignal.timeout(1000)});
        if(ui.ok && cp.ok && (await cp.json()).status==='ready'){ready=true;break;}}catch{}
      await new Promise(accept=>setTimeout(accept,250));
    }
    if(!ready)throw new Error(markers.some(m=>m.code==='BUILD_STARTED')&&!markers.some(m=>m.code==='BUILD_PASS')?
      'Launcher cold-build check exceeded its bounded budget; runtime readiness NOT RUN.':
      'Launcher failed readiness; run dev:check to inspect prerequisites.');
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
    if(conversation){
      const prompt='Reply in one short sentence: say hello, and do not claim to possess evidence. /no_think';
      const input=page.getByRole('textbox',{name:'SOC investigation request'}),send=page.getByRole('button',{name:'Send request',exact:true});
      await input.fill(prompt);await send.click({timeout:15000});
      await page.getByText(/Local model commentary/).first().waitFor({timeout:90000});
      const rows=await db.query(`SELECT model,route_reason,status,input_tokens,output_tokens,cached_tokens,estimated_cost_micros,cost_status,latency_ms
        FROM model_usage ORDER BY created_at`);
      if(rows.rowCount!==1||rows.rows[0].status!=='SUCCEEDED'||rows.rows[0].model!=='qwen3-local-unpromoted'||
        rows.rows[0].route_reason!=='local_CONVERSATION_experimental_v1'||rows.rows[0].estimated_cost_micros!==null||rows.rows[0].cost_status!=='UNKNOWN')
        throw new Error('Actual local conversation ledger/unknown cost mismatch');
      receipt.modelInference='PASS: ONE_SYNTHETIC_CONVERSATION_NOT_SOC_QUALITY';
      receipt.modelUsage=rows.rows[0];receipt.conversationPromptHash= (await import('node:crypto')).createHash('sha256').update(prompt).digest('hex');
    }
    const counts=(await db.query(`SELECT (SELECT count(*)::int FROM runtime_tasks) tasks,(SELECT count(*)::int FROM model_usage) model_calls,
      (SELECT count(*)::int FROM evidence_frontiers) frontiers,(SELECT count(*)::int FROM next_step_decisions) decisions`)).rows[0];
    if(counts.tasks!==0 || counts.model_calls!==(conversation?1:0)||counts.frontiers!==0||counts.decisions!==0)throw new Error('Unexpected task/fact/decision/model invocation in isolated check');
    const scheduler=(await db.query('SELECT enabled,active_run_id,max_pending FROM dispatch_scheduler_state WHERE singleton=true')).rows[0];
    if(!scheduler?.enabled || scheduler.active_run_id!==null || scheduler.max_pending!==32)throw new Error('Bounded dispatch activation not verified');
    const migrations=(await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version);
    Object.assign(receipt,{status:'PASS',localDemoLogin:'PASS',controlReadiness:'PASS',workerConnections:workers.map(w=>({
      workerId:w.workerId,presence:w.presence,reportedReadiness:w.reportedReadiness})),migrations,counts,scheduler});
  }catch(error){receipt.error=error instanceof Error?error.message:'Verification failed';throw error;}
  finally{
    try{await browser?.close();await stop(child);await db?.end();
      if(conversation){const root=resolve(folder,'runtime');
        for(const entry of await readdir(root,{withFileTypes:true})){if(!/^owned-model-runtime-[a-f0-9-]{36}$/.test(entry.name)||!entry.isDirectory())continue;
          const key=resolve(root,entry.name,'api-key.txt'),actualRoot=await realpath(resolve(root,entry.name));
          const within=relative(root,actualRoot);if(!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw new Error('Owned model credential root redirected');
          try{const st=await lstat(key);if(!st.isFile()||st.isSymbolicLink())throw new Error('Owned credential type denied');await unlink(key);}
          catch(error){if(error.code!=='ENOENT')throw error;}
        }
      }
      if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      receipt.cleanup='PASS: owned processes and isolated test schema only';
    }catch{receipt.status='FAILED';receipt.cleanup='FAILED: operator inspection required';process.exitCode=1;}
    finally{await admin.end();receipt.finishedAt=new Date().toISOString();
      receipt.diagnostics=markers;
      await writeFile(resolve(folder,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
      console.log(JSON.stringify({...receipt,receipt:resolve(folder,'receipt.json')},null,2));}
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
