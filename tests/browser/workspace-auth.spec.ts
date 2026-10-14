import { test, expect, type BrowserContext } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { browserSecret } from '../../playwright.config.ts';

async function identity(context: BrowserContext, role: string, expired = false, invalid = false) {
  const now = Date.now();
  const data = Buffer.from(JSON.stringify({ agentId: 'browser-fixture', role, permissions: ['CONTROL'],
    timestamp: now - 10_000, expiresAt: expired ? now - 1_000 : now + 60_000 })).toString('base64url');
  const signature = createHmac('sha256', browserSecret).update(data).digest('base64url');
  await context.addCookies([{ name: 'asq-control-token', value: data + '.' + (invalid ? 'invalid' : signature),
    url: 'http://127.0.0.1:3107', httpOnly: true, sameSite: 'Strict' }]);
}

test('chat connection fixture fences stale close callbacks after New case and preserves the draft',async({page,context})=>{
  await identity(context,'SECURITY_ADMIN');
  await page.addInitScript(()=>{
    class FixtureSocket {
      static OPEN=1;static CLOSED=3;readyState=0;
      onopen:((event:unknown)=>void)|null=null;onclose:((event:unknown)=>void)|null=null;
      onerror:((event:unknown)=>void)|null=null;onmessage:((event:unknown)=>void)|null=null;
      constructor(_url:string){setTimeout(()=>{if(this.readyState===0){this.readyState=1;this.onopen?.({});}},30);}
      send(_value:string){}
      close(){this.readyState=3;const callback=this.onclose;setTimeout(()=>callback?.({code:1000}),120);}
    }
    Object.defineProperty(window,'WebSocket',{value:FixtureSocket,configurable:true});
  });
  await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/standalone');await expect(page.locator('#control-channel-status')).toContainText('online');
  const composer=page.getByRole('textbox',{name:'SOC investigation request'});await composer.fill('Fixture draft, not an investigation');
  await page.getByRole('button',{name:'New case',exact:true}).click();
  await expect(page.locator('#control-channel-status')).toContainText('online');
  await page.waitForTimeout(250); // Delayed stale close is the explicit regression event, not a readiness workaround.
  await expect(page.locator('#control-channel-status')).toContainText('online');
  await expect(composer).toHaveValue('Fixture draft, not an investigation');
  await expect(page.getByRole('button',{name:'Send request',exact:true})).toBeEnabled();
});

test('investigation desk reads authority only and never fabricates unavailable state',async({page,context})=>{
  await page.goto('/standalone/investigation');await expect(page).toHaveURL(/\/login\?next=/);
  await identity(context,'SOC_ANALYST');await page.goto('/standalone/investigation');
  await page.getByRole('button',{name:'Load investigation',exact:true}).click();
  await expect(page.locator('#investigation-error')).toContainText('valid case ID');await expect(page.getByLabel('Case ID',{exact:true})).toBeFocused();
  await page.getByLabel('Case ID',{exact:true}).fill('CASE-unavailable');await page.getByRole('button',{name:'Load investigation',exact:true}).click();
  await expect(page.locator('#investigation-error')).toContainText('unavailable');await expect(page.locator('.investigation-snapshot')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/dispatch|approve|execute/i})).toHaveCount(0);
  await identity(context,'AUDITOR');expect((await page.goto('/standalone/investigation'))?.status()).toBe(403);
});

test('investigation browser fixture retains contradictory references and responsive read-only hypothesis state',async({page,context},testInfo)=>{
  await identity(context,'SOC_ANALYST');await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce'});
  const caseId='CASE-fixture',runId='RUN-fixture',policyVersion='gss.soc-evidence.v1',time='2026-10-10T12:00:00Z';
  const provenance={taskId:'TASK-fixture',evidenceRef:'EVIDENCE-fixture',source:'REPLAY_BROWSER_FIXTURE_NOT_LIVE',observedAt:time,artifactHash:'a'.repeat(64)};
  const snapshot={run:{schemaVersion:'gss.investigation-run.v1',caseId,runId,policyVersion,state:'BLOCKED',frontierVersion:1,depth:1,
    budget:{maxDepth:3,maxExternalQueries:3,maxCostMicros:0,deadlineAt:time},usage:{externalQueries:1,costMicros:0,costUnknown:true}},
    frontier:{schemaVersion:'gss.evidence-frontier.v1',caseId,runId,version:1,updatedAt:time,
      facts:['MATCHED','NO_MATCHES'].map((value,i)=>({factId:'FACT-'+i,key:'fixture.query',value,semanticType:'FACT',provenance:[provenance]})),
      evidenceRefs:['EVIDENCE-fixture'],sourceObservationIds:['OBS-fixture'],contradictions:[{contradictionId:'CON-fixture',key:'fixture.query',factIds:['FACT-0','FACT-1']}]},
    hypothesisPlan:{schemaVersion:'gss.hypothesis-plan.v1',planId:'HPLAN-fixture',caseId,runId,policyVersion,frontierVersion:1,
      coverage:{schemaVersion:'gss.hypothesis-coverage.v1',scope:'ALLOWLISTED_STRUCTURED_FIELDS_ONLY',discoveredIndicators:20,evaluatedIndicators:16,omittedIndicators:4,
        partialExtractionEvidenceIds:['EVIDENCE-fixture'],limitations:['CANDIDATE_LIMIT','PARTIAL_EXTRACTION']},
      hypotheses:[{hypothesisId:'HYPO-fixture',statement:'Browser fixture only; not live SOC evidence.',status:'INSUFFICIENT_EVIDENCE',gap:'CONTRADICTORY',factIds:['FACT-0','FACT-1'],evidenceIds:['EVIDENCE-fixture']}],
      selectedQuestionId:null,selectedFactIds:[],selectedEvidenceIds:[],decision:{schemaVersion:'gss.next-step.v1',decisionId:'DEC-fixture',caseId,runId,policyVersion,frontierVersion:1,
        kind:'BLOCKED',reasonCode:'NO_SAFE_EVIDENCE_QUESTION',rationale:'No safe evidence action available; no verdict inferred.',createdAt:time}}};
  await page.route('**/api/control/cases/CASE-fixture/frontier',route=>route.fulfill({json:snapshot}));
  const source={taskId:'TASK-fixture',evidenceId:'EVIDENCE-fixture',artifactHash:'a'.repeat(64),projectionHash:'b'.repeat(64),
    adapter:'google-chronicle',sourceKind:'CHRONICLE_UNATTESTED',sourceInstance:'BROWSER_FIXTURE_NOT_LIVE',queriedAt:time,collectedAt:null,
    queryRange:{start:'2026-10-10T10:00:00Z',end:time},inputCount:2,omittedCount:0,uncertainTimeCount:1,
    truncated:false,fieldTruncated:false,precision:'MILLISECOND_SORT_ONLY_RAW_PRESERVED'};
  const timeline={schemaVersion:'gss.case-timeline.v1',caseId,snapshotHash:'c'.repeat(64),scope:'RETAINED_AUTHORITY_PROJECTIONS',
    ordering:'UTC_MILLISECONDS_THEN_PROVENANCE_NOT_CAUSAL',completedQueryCount:1,unprojectedQueryCount:0,omittedProjectionCount:0,
    inputEventCount:2,omittedEventCount:0,uncertainTimeCount:1,partial:false,entryLimit:200,sources:[source],entries:[
      {taskId:source.taskId,evidenceId:source.evidenceId,artifactHash:source.artifactHash,projectionHash:source.projectionHash,
        eventId:'fixture-timed-event',sourceIndex:0,rawTimestamp:'2026-10-10T17:00:00+07:00',occurredAt:'2026-10-10T10:00:00.000Z',timeStatus:'VALID'},
      {taskId:source.taskId,evidenceId:source.evidenceId,artifactHash:source.artifactHash,projectionHash:source.projectionHash,
        eventId:'fixture-untimed-event',sourceIndex:1,rawTimestamp:null,occurredAt:null,timeStatus:'MISSING'}]};
  await page.route('**/api/control/cases/CASE-fixture/timeline',route=>route.fulfill({json:timeline}));
  const entities={schemaVersion:'gss.case-entities.v1',caseId,snapshotHash:'e'.repeat(64),scope:'RETAINED_AUTHORITY_PROJECTIONS',
    comparison:'EXACT_TYPED_VALUE_WITHIN_SOURCE_ONLY',completedQueryCount:1,unprojectedQueryCount:0,omittedProjectionCount:0,
    inputEventCount:2,omittedEventCount:0,parsedMentionCount:3,omittedParsedMentionCount:0,partial:false,
    sources:[{...source,caseId,queryHash:'a'.repeat(64),adapterVersion:'v1',redaction:'ALLOWLISTED_FIELDS_ONLY'}],
    entries:timeline.entries.map((e,i)=>({...e,relationship:'CO_OBSERVED_ONLY',mentions:i===0?[
      {type:'USER',field:'principal.user.userid',value:'alice',valueKey:'VALUE-'+'a'.repeat(64)},
      {type:'IP',field:'target.ip',value:'203.0.113.2',valueKey:'VALUE-'+'b'.repeat(64)}]:[
      {type:'USER',field:'principal.user.userid',value:'bob',valueKey:'VALUE-'+'c'.repeat(64)}]}))};
  await page.route('**/api/control/cases/CASE-fixture/entities',route=>route.fulfill({json:entities}));
  await page.route('**/api/control/cases/CASE-fixture/report',route=>route.fulfill({json:{schemaVersion:'gss.case-report.v1',caseId,
    generatedAt:time,scope:'LATEST_INVESTIGATION_AND_BOUNDED_CASE_TIMELINE',analystReview:'REQUIRED',investigation:snapshot,timeline,entities,
    limitations:['Browser contract fixture only'],reportHash:'d'.repeat(64)}}));
  await page.goto('/standalone/investigation');await page.getByLabel('Case ID',{exact:true}).fill(caseId);
  await page.getByRole('button',{name:'Load investigation',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hypotheses & evidence gaps',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Investigation coverage',exact:true})).toBeVisible();await expect(page.getByText('Limits: CANDIDATE_LIMIT, PARTIAL_EXTRACTION',{exact:true})).toBeVisible();
  await expect(page.getByText('INSUFFICIENT_EVIDENCE · Gap: CONTRADICTORY',{exact:true})).toBeVisible();
  await page.getByText('Inspect all contradiction references',{exact:true}).click();
  await expect(page.getByText('fixture.query: FACT-0, FACT-1',{exact:true})).toBeVisible();
  await page.getByText('Provenance for FACT-0',{exact:true}).click();
  const firstFact=page.locator('.investigation-facts > li').first();
  await expect(firstFact.getByText(provenance.source,{exact:true})).toBeVisible();await expect(firstFact.getByText(provenance.artifactHash,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Load case timeline',exact:true}).click();
  await expect(page.locator('.case-timeline')).toContainText('2026-10-10T17:00:00+07:00');
  await expect(page.locator('.case-timeline')).toContainText('Event time: MISSING');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download timeline JSON',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('GSS-CASE-fixture-timeline.json');
  const reportDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download case report',exact:true}).click();
  expect((await reportDownload).suggestedFilename()).toBe('GSS-CASE-fixture-report.json');
  await page.getByRole('button',{name:'Load entity evidence',exact:true}).click();
  const groups=page.locator('.case-entities .investigation-facts > li');
  await expect(groups).toHaveCount(2);await expect(groups.first()).toContainText('alice');await expect(groups.first()).toContainText('203.0.113.2');
  await expect(groups.last()).toContainText('bob');await expect(groups.last()).not.toContainText('alice');
  const entityDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download entity JSON',exact:true}).click();
  expect((await entityDownload).suggestedFilename()).toBe('GSS-CASE-fixture-entities.json');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('investigation-mobile.png'),fullPage:true});
  await page.setViewportSize({width:812,height:375});
  // Double actual computed desk text, including px-based styles; changing only root rem size would miss them.
  await page.evaluate(()=>{
    const sizes=Array.from(document.querySelectorAll<HTMLElement>('.investigation-console *')).map(node=>({node,size:parseFloat(getComputedStyle(node).fontSize)}));
    sizes.forEach(({node,size})=>node.style.fontSize=(size*2)+'px');
  });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(await page.locator('.investigation-snapshot').evaluate(el=>Array.from(el.querySelectorAll('p,dd,dt,summary,h2,h3')).every(node=>{
    const rect=node.getBoundingClientRect();return rect.width===0 || (rect.left>=0 && rect.right<=window.innerWidth);
  }))).toBe(true);
});

test('investigation rejects malformed authority payload without rendering a plan',async({page,context})=>{
  await identity(context,'SECURITY_ADMIN');await page.route('**/api/control/cases/CASE-invalid/frontier',route=>route.fulfill({json:{run:{caseId:'CASE-invalid'},hypothesisPlan:{status:'SUPPORTED'}}}));
  await page.goto('/standalone/investigation');await page.getByLabel('Case ID',{exact:true}).fill('CASE-invalid');await page.getByRole('button',{name:'Load investigation',exact:true}).click();
  await expect(page.locator('#investigation-error')).toContainText('Invalid investigation contract');await expect(page.locator('.investigation-snapshot')).toHaveCount(0);
});

test('anonymous cannot render either protected workspace', async ({ page }) => {
  for (const path of ['/standalone', '/control/executions']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole('heading', { name: 'Sign in to continue.' })).toBeVisible();
  }
});
test('lab report desk validates input and shows unavailable authority without fabricated timeline',async({page,context})=>{
  await identity(context,'SECURITY_ADMIN');await page.goto('/standalone/lab');
  await expect(page.getByRole('heading',{name:'Lab evidence',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Load report',exact:true}).click();
  await expect(page.locator('#lab-error[role="alert"]')).toContainText('valid case ID');await expect(page.getByLabel('Case ID',{exact:true})).toBeFocused();
  await page.getByLabel('Case ID',{exact:true}).fill('LABCASE-unavailable');await page.getByRole('button',{name:'Load report',exact:true}).click();
  await expect(page.locator('#lab-error[role="alert"]')).toContainText('unavailable');await expect(page.locator('.lab-timeline')).toHaveCount(0);
});
test('lab report contract keeps replay labels, evidence links and mobile/reduced-motion layout',async({page,context},testInfo)=>{
  await identity(context,'SECURITY_ADMIN');await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/control/cases/LABCASE-fixture/lab-report',route=>route.fulfill({json:{report:{schemaVersion:'gss.lab-report.v1',caseId:'LABCASE-fixture',
    verdict:'INSUFFICIENT_EVIDENCE',frontierVersion:1,limitations:['Browser fixture only; NOT live evidence.'],
    provenance:{sourceKind:'REPLAY',sourceInstance:'local-windows',artifactHash:'a'.repeat(64),collectedAt:'2026-10-09T01:00:00Z',queriedAt:'2026-10-09T02:00:00Z',truncated:true},
    timeline:[{eventId:'fixture-event',evidenceId:'fixture-evidence',event:{eventTime:'2026-10-09T00:00:00Z',provider:'Fixture',channel:'System',eventCode:1001}}]}}}));
  await page.goto('/standalone/lab');await page.getByLabel('Case ID',{exact:true}).fill('LABCASE-fixture');await page.getByRole('button',{name:'Load report',exact:true}).click();
  await expect(page.locator('.lab-timeline')).toContainText('fixture-evidence');await expect(page.getByText('REPLAY · local-windows',{exact:true})).toBeVisible();
  await expect(page.getByText('Truncated; not exhaustive',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('lab-report-mobile.png'),fullPage:true});
  await page.setViewportSize({width:812,height:375});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('real local login rejects wrong password then grants admin workspaces', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Authentication failed');
  await page.getByLabel('Password', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/standalone$/);
  const session = (await context.cookies()).find(cookie => cookie.name === 'asq-control-token');
  expect(session?.httpOnly).toBe(true); expect(session?.sameSite).toBe('Strict');
  const response = await page.goto('/control/executions');
  expect(response?.status()).toBe(200);
  await expect(page.locator('main')).toBeVisible();
});
test('analyst can investigate but cannot render Control Plane', async ({ page, context }) => {
  await identity(context, 'SOC_ANALYST');
  expect((await page.goto('/standalone/tasks'))?.status()).toBe(200);
  await expect(page.locator('main')).toBeVisible();
  expect((await page.goto('/control/executions'))?.status()).toBe(403);
  await expect(page.locator('body')).toHaveText('Forbidden');
});
test('auditor lands in its authorized workspace and cannot investigate', async ({ page, context }) => {
  await identity(context, 'AUDITOR');
  await page.goto('/'); await expect(page).toHaveURL(/\/control\/executions$/);
  expect((await page.goto('/standalone'))?.status()).toBe(403);
  await expect(page.locator('body')).toHaveText('Forbidden');
});
for (const kind of ['expired', 'invalid'] as const) {
  test(kind + ' session cannot render protected workspace', async ({ page, context }) => {
    await identity(context, 'SECURITY_ADMIN', kind === 'expired', kind === 'invalid');
    await page.goto('/control/executions');
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole('heading', { name: 'Sign in to continue.' })).toBeVisible();
  });
}
test('legacy routes redirect through the same authorization boundary', async ({ page, context }) => {
  await page.goto('/executions'); await expect(page).toHaveURL(/\/login\?next=/);
  await identity(context, 'SOC_ANALYST');
  await page.goto('/tasks'); await expect(page).toHaveURL(/\/standalone\/tasks$/);
  expect((await page.goto('/executions'))?.status()).toBe(403);
});
test('approval desk exposes authority failure, never manufactured approval rows',async({page,context})=>{
  await identity(context,'SECURITY_ADMIN');
  await page.goto('/control/approvals');
  await expect(page.getByRole('heading',{name:'Approval desk',exact:true})).toBeVisible();
  await expect(page.locator('.approval-error[role="alert"]')).toContainText(/unavailable|failed/i);
  await expect(page.getByRole('button',{name:'Approve this bound proposal'})).toHaveCount(0);
});

test('fleet exposes authority failure without demo metrics',async({page,context})=>{
  await identity(context,'SECURITY_ADMIN');await page.goto('/control/agents');
  await expect(page.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();
  await expect(page.locator('.fleet-error[role="alert"]')).toContainText('unavailable');
  await expect(page.locator('.agent-panel')).toHaveCount(0);
  await expect(page.getByText('Success rate',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Tokens today',{exact:true})).toHaveCount(0);
});
test('fleet renders contract states, expires stale snapshots and fits mobile',async({page,context},testInfo)=>{
  await identity(context,'SECURITY_ADMIN');await page.setViewportSize({width:375,height:812});
  await page.route('**/api/control/workers',route=>route.fulfill({json:{schemaVersion:'gss.worker-presence.v1',workers:[
    {workerId:'cli-worker-agent',role:'CLI_DAEMON',capabilities:['inspect_hostname'],generation:'4',presence:'ONLINE',
      reportedReadiness:'READY',activeTasks:1,lastSeen:'2026-10-04T00:00:00Z',observedAt:'2026-10-04T00:00:00Z',leaseUntil:'2026-10-04T00:00:01Z'},
    {workerId:'siem-worker-agent',role:'SIEM',capabilities:['search_siem'],generation:'0',presence:'UNKNOWN',
      reportedReadiness:'UNKNOWN',activeTasks:0,lastSeen:null,leaseUntil:null,observedAt:'2026-10-04T00:00:00Z'}]}}));
  await page.goto('/control/agents');await expect(page.locator('.agent-panel')).toHaveCount(2);
  await expect(page.locator('.fleet-presence').first()).toHaveText('ONLINE');
  await expect(page.locator('.fleet-presence').first()).toHaveText('STALE',{timeout:4000});
  await expect(page.getByText('Presence is not execution evidence',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('fleet-mobile.png'),fullPage:true});
  for(const width of [768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
  await page.screenshot({path:testInfo.outputPath('fleet-desktop.png'),fullPage:true});
});
test('fleet retains last observations as unverified on failed refresh',async({page,context})=>{
  await identity(context,'SECURITY_ADMIN');let requests=0;
  await page.route('**/api/control/workers',route=>++requests===1?route.fulfill({json:{schemaVersion:'gss.worker-presence.v1',workers:[
    {workerId:'cli-worker-agent',role:'CLI_DAEMON',capabilities:[],generation:'1',presence:'ONLINE',reportedReadiness:'READY',activeTasks:0,
      lastSeen:'2026-10-04T00:00:00Z',observedAt:'2026-10-04T00:00:00Z',leaseUntil:'2026-10-04T00:01:00Z'}]}}):route.fulfill({status:503,json:{error:'unavailable'}}));
  await page.goto('/control/agents');await expect(page.locator('.fleet-presence')).toHaveText('ONLINE');
  await page.getByRole('button',{name:'Refresh fleet'}).click();
  await expect(page.locator('.fleet-presence')).toHaveText('UNVERIFIED');
  await expect(page.locator('.fleet-error')).toContainText('Previous observations');
});
test('fleet rejects invalid contract instead of inventing workers',async({page,context})=>{
  await identity(context,'SECURITY_ADMIN');
  await page.route('**/api/control/workers',route=>route.fulfill({json:{workers:[{workerId:'fake',presence:'ONLINE'}]}}));
  await page.goto('/control/agents');await expect(page.locator('.fleet-error')).toContainText('contract invalid');
  await expect(page.locator('.agent-panel')).toHaveCount(0);
});
