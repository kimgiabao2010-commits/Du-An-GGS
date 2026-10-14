import 'dotenv/config';
import {Pool} from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {localDatabaseTarget} from './backup-local-postgres.mjs';
import {backupApprovedArtifacts,restoreApprovedArtifacts,PostgresLabTelemetryStore} from '@asq/persistence';
import {validateLabBatch,labBatchHash,sha256Canonical} from '@asq/sdk';
const args=process.argv.slice(2),caseId=args[args.indexOf('--case')+1];
if(!args.includes('--case')||!/^LABCASE-[a-zA-Z0-9_-]{1,100}$/.test(caseId??'')||!args.includes('--own-device')||!args.includes('--local-authorized'))
  throw new Error('Explicit --case LABCASE-... --own-device --local-authorized required');
localDatabaseTarget(process.env.DATABASE_URL??'',process.env.GSS_RUNTIME_ENV??'local');
const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:5000});
try{
  const row=(await pool.query(`SELECT b.payload,b.batch_hash,b.bytes::text,b.artifact_ref FROM lab_query_receipts q
    JOIN lab_telemetry_batches b ON b.batch_hash=q.batch_hash WHERE q.case_id=$1 AND b.source_id='local-windows'
    AND b.source_kind='LAB_LIVE' AND b.expires_at>now() ORDER BY q.created_at DESC LIMIT 1`,[caseId])).rows[0];
  if(!row)throw new Error('Authorized own-device metadata case missing/expired');
  const batch=validateLabBatch(row.payload);
  if(batch.sourceId!=='local-windows'||batch.sourceKind!=='LAB_LIVE'||labBatchHash(batch)!==row.batch_hash)throw new Error('Lab recovery source/hash mismatch');
  const root=resolve(process.env.GSS_DATA_DIR??'data'),policy={profile:'lab',allowedSources:['local-windows'],artifactRoot:resolve(root,'lab-artifacts')};
  const before=await new PostgresLabTelemetryStore(pool,policy).report(caseId);
  const backup=await backupApprovedArtifacts(root,resolve('data/backups/artifacts'),[{ref:row.artifact_ref,sha256:row.batch_hash,bytes:Number(row.bytes),hashMode:'JCS_LAB_BATCH'}]);
  const restored=await restoreApprovedArtifacts(backup.directory,resolve('data/recovery'),backup.manifestHash);
  const after=await new PostgresLabTelemetryStore(pool,{...policy,artifactRoot:resolve(restored.root,'lab-artifacts')}).report(caseId);
  if(sha256Canonical(before)!==sha256Canonical(after))throw new Error('Restored artifact report differs from retained authority receipt');
  const receipt={schemaVersion:'gss.lab-artifact-recovery-check.v1',verifiedAt:new Date().toISOString(),status:'PASS',
    scope:'ONE_AUTHORIZED_OWN_DEVICE_METADATA_CASE',artifactCount:restored.restoredCount,bytes:restored.totalBytes,
    manifestHash:backup.manifestHash,reportHash:sha256Canonical(after),backup:backup.directory,restored:restored.root,
    originalOverwritten:false,database:'EXISTING_LOCAL_READONLY_QUERIES',wholeStoreRecovery:'NOT RUN',staging:'NOT RUN',privateData:true};
  await mkdir(resolve('data/verification'),{recursive:true});
  const receiptFile=resolve('data/verification','lab-artifact-recovery-'+Date.now()+'.json');
  await writeFile(receiptFile,JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'PASS',artifactCount:receipt.artifactCount,bytes:receipt.bytes,manifestHash:receipt.manifestHash,
    reportMatches:true,originalOverwritten:false,wholeStoreRecovery:'NOT RUN',receipt:receiptFile},null,2));
}finally{await pool.end();}
