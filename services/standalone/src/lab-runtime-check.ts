import 'dotenv/config';
import {spawn, type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {ControlPlaneServer} from '../../control-plane/src/server.js';
import {serviceEnvironment} from '../../../scripts/service-environment.mjs';
import {localDatabaseTarget} from '../../../scripts/backup-local-postgres.mjs';

async function stop(child:ChildProcess) {
  if(!child.pid || child.exitCode!==null)return;
  if(process.platform==='win32') {
    // Only the exact child we spawned, never another process found by port/name.
    await new Promise<void>((done,reject)=>{
      const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('error',reject);killer.once('exit',code=>code===0 || child.exitCode!==null?done():reject(new Error('Owned UI process cleanup failed')));
    });
  }else child.kill('SIGTERM');
}
async function main() {
  const args=process.argv.slice(2),caseId=args[args.indexOf('--case')+1];
  if(!args.includes('--case') || !args.includes('--own-device') || !/^LABCASE-[a-zA-Z0-9_-]{1,100}$/.test(caseId??''))throw new Error('Explicit --case LABCASE-... --own-device required');
  localDatabaseTarget(process.env.DATABASE_URL??'',process.env.GSS_RUNTIME_ENV??'local');
  // Dedicated local demo identity and service scopes, never an OIDC/staging workaround.
  const secret=randomBytes(32).toString('base64url'),token=randomBytes(32).toString('base64url');
  Object.assign(process.env,{GSS_SOC_PROFILE:'lab',GSS_RUNTIME_ENV:'local',GSS_LAB_OWN_DEVICE_AUTHORIZED:'true',
    GSS_LAB_ALLOWED_SOURCES:'local-windows',ASQ_JWT_SECRET:secret,GSS_CONTROL_PLANE_TOKEN:token,GSS_UI_GATEWAY_TOKEN:token});
  const server=new ControlPlaneServer(0);let ui:ChildProcess|undefined,browser;
  try {
    const control='http://127.0.0.1:'+await server.ready();
    // Select a currently unused loopback port without adopting an existing server.
    const probe=createServer();await new Promise<void>((accept,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',accept);});
    const address=probe.address();if(!address || typeof address==='string')throw new Error('UI port unavailable');
    const port=address.port;await new Promise<void>((accept,reject)=>probe.close(error=>error?reject(error):accept()));
    const env=serviceEnvironment({...process.env,CONTROL_PLANE_URL:control,ASQ_LOCAL_RUNTIME:'true',ASQ_INSECURE_LOCAL_DEMO_AUTH:'true',
      ASQ_ADMIN_USERNAME:'BaoNVG',ASQ_ADMIN_PASSWORD:'1'},'Web UI');
    ui=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start',resolve('apps/standalone'),'-H','127.0.0.1','-p',String(port)],
      {env,windowsHide:true,stdio:['ignore','ignore','ignore']});
    let spawnError=false;ui.once('error',()=>{spawnError=true;});
    const base='http://127.0.0.1:'+port,until=Date.now()+30000;let ready=false;
    while(Date.now()<until && !spawnError && ui.exitCode===null) {
      try{if((await fetch(base+'/login',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
      await new Promise(accept=>setTimeout(accept,200));
    }
    if(!ready)throw new Error('Owned UI server unavailable; no browser evidence inferred');
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(base+'/login');await page.getByLabel('Username',{exact:true}).fill('BaoNVG');await page.getByLabel('Password',{exact:true}).fill('1');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/\/standalone$/);
    await page.goto(base+'/standalone/lab');await page.getByLabel('Case ID',{exact:true}).fill(caseId);
    const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/control/cases/'+caseId+'/lab-report'));
    await page.getByRole('button',{name:'Load report',exact:true}).click();const response=await responsePromise;
    if(response.status()!==200)throw new Error('Actual runtime report read failed: '+response.status());
    const data=await response.json(),report=data.report;
    if(report?.caseId!==caseId || report.verdict!=='INSUFFICIENT_EVIDENCE' || report.provenance?.sourceKind!=='LAB_LIVE' || !report.timeline?.length)throw new Error('Actual lab report provenance/contract mismatch');
    await page.locator('.lab-timeline li').last().waitFor();
    if(await page.locator('.lab-timeline li').count()!==report.timeline.length)throw new Error('Rendered report count differs from authority');
    await page.setViewportSize({width:375,height:812});
    if(!await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))throw new Error('Actual report overflows mobile viewport');
    const folder=resolve('data/verification/lab-runtime-browser-'+Date.now());await mkdir(folder,{recursive:true});
    await page.screenshot({path:resolve(folder,'private-runtime-report-mobile.png'),fullPage:true});
    await page.goto(base+'/standalone/investigation');await page.getByLabel('Case ID',{exact:true}).fill(caseId);
    const frontierResponsePromise=page.waitForResponse(r=>r.url().endsWith('/api/control/cases/'+caseId+'/frontier'));
    await page.getByRole('button',{name:'Load investigation',exact:true}).click();const frontierResponse=await frontierResponsePromise;
    if(frontierResponse.status()!==200)throw new Error('Actual runtime frontier read failed: '+frontierResponse.status());
    const snapshot=await frontierResponse.json();
    if(snapshot.run?.caseId!==caseId || snapshot.frontier?.version!==report.frontierVersion || snapshot.hypothesisPlan)
      throw new Error('Metadata-only runtime frontier binding/authority mismatch');
    await page.getByRole('heading',{name:'Authority snapshot',exact:true}).waitFor();
    await page.getByText('No stored hypothesis plan.',{exact:false}).waitFor();
    const timelineResponsePromise=page.waitForResponse(r=>r.url().endsWith('/api/control/cases/'+caseId+'/timeline'));
    await page.getByRole('button',{name:'Load case timeline',exact:true}).click();const timelineResponse=await timelineResponsePromise;
    if(timelineResponse.status()!==200)throw new Error('Actual case timeline API failed');
    const timeline=await timelineResponse.json();
    if(timeline.caseId!==caseId || timeline.schemaVersion!=='gss.case-timeline.v1' || timeline.entries?.length!==0)
      throw new Error('Metadata-only case must not acquire invented SOC query events');
    await page.getByText('No retained events in this snapshot.',{exact:false}).waitFor();
    const entityResponsePromise=page.waitForResponse(r=>r.url().endsWith('/api/control/cases/'+caseId+'/entities'));
    await page.getByRole('button',{name:'Load entity evidence',exact:true}).click();const entityResponse=await entityResponsePromise;
    if(entityResponse.status()!==200)throw new Error('Actual entity snapshot API failed');
    const entitySnapshot=await entityResponse.json();
    if(entitySnapshot.caseId!==caseId || entitySnapshot.schemaVersion!=='gss.case-entities.v1' || entitySnapshot.entries?.length!==0)
      throw new Error('Metadata-only case must not acquire invented entity associations');
    await page.getByText('No retained structured entity events.',{exact:false}).waitFor();
    const reportResponsePromise=page.waitForResponse(r=>r.url().endsWith('/api/control/cases/'+caseId+'/report'));
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download case report',exact:true}).click();
    const caseReportResponse=await reportResponsePromise;
    if(caseReportResponse.status()!==200)throw new Error('Actual atomic case report API failed');
    const caseReport=await caseReportResponse.json();
    if(caseReport.caseId!==caseId || caseReport.analystReview!=='REQUIRED' ||
      caseReport.investigation?.frontier?.version!==report.frontierVersion || caseReport.timeline?.snapshotHash!==timeline.snapshotHash ||
      caseReport.entities?.snapshotHash!==entitySnapshot.snapshotHash)
      throw new Error('Actual atomic report binding mismatch');
    if((await downloadPromise).suggestedFilename()!==`GSS-${caseId}-report.json`)throw new Error('Actual report download failed');
    if(!await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))throw new Error('Actual frontier overflows mobile viewport');
    await page.screenshot({path:resolve(folder,'private-runtime-frontier-mobile.png'),fullPage:true});
    const receipt={schemaVersion:'gss.lab-runtime-browser-check.v1',verifiedAt:new Date().toISOString(),status:'PASS',
      environment:'local runtime PostgreSQL, actual previously imported own-device metadata',renderedEvents:report.timeline.length,
      frontierVersion:report.frontierVersion,sourceKind:report.provenance.sourceKind,verdict:report.verdict,
      authentication:'local demo sign-in, not staging identity',rawReportPublished:false,staging:'NOT RUN'};
    Object.assign(receipt,{investigationFrontier:'PASS',caseTimeline:'PASS: no invented query events',entitySnapshot:'PASS: no invented associations',atomicCaseReportDownload:'PASS',
      hypothesisPlan:'NOT PRESENT: metadata-only, no reasoning inferred'});
    await writeFile(resolve(folder,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
    console.log(JSON.stringify({...receipt,privateEvidenceFolder:folder},null,2));
  } finally {await browser?.close();if(ui)await stop(ui);await server.close();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Runtime check failed');process.exitCode=1;});
