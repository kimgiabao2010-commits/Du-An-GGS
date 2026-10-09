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
