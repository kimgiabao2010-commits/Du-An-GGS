import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
if(process.platform!=='win32' || !process.argv.includes('--own-device')) throw new Error('Windows and explicit --own-device authorization required. No company/remote logs collected.');
// No message, XML payload, user SID, command line or remote ComputerName collection.
const script="$ErrorActionPreference='Stop'; $events = @(Get-WinEvent -LogName System -MaxEvents 200 | Select-Object @{n='recordId';e={[string]$_.RecordId}}, @{n='eventCode';e={$_.Id}}, @{n='channel';e={$_.LogName}}, @{n='provider';e={$_.ProviderName}}, @{n='eventTime';e={$_.TimeCreated.ToUniversalTime().ToString('o')}}, @{n='level';e={[int]$_.Level}}); ConvertTo-Json -InputObject $events -Depth 4 -Compress";
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:512000});
if(result.error || result.status!==0) throw new Error('LAB_COLLECTION_BLOCKED: Windows Event Log unavailable/denied. No fixture substituted.');
const rows=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
if(!Array.isArray(rows))throw new Error('Invalid event export');
const hostId='host-'+createHash('sha256').update(hostname()).digest('hex');
const batch={schemaVersion:'gss.lab-telemetry.v1',sourceId:'local-windows',sourceKind:'LAB_LIVE',collectedAt:new Date().toISOString(),
  events:rows.map(row=>({...row,hostId})),truncated:rows.length===200};
await mkdir(resolve('data/lab'),{recursive:true});
const file=resolve('data/lab',`windows-${Date.now()}.json`);
await writeFile(file,JSON.stringify(batch),{flag:'wx',mode:0o600});
console.log('Own-device metadata exported: '+file+'; events='+batch.events.length+'. LAB_LIVE is operator-asserted, not remote attestation.');
