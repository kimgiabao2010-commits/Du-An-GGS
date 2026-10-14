import 'dotenv/config';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,stat,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';

export function localDatabaseTarget(connectionString, runtime='local') {
  const u=new URL(connectionString);
  if(runtime==='staging' || !['postgres:','postgresql:'].includes(u.protocol) ||
    !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || !u.pathname.slice(1) ||
    [...u.searchParams.keys()].some(k=>!['sslmode'].includes(k)) ||
    (u.searchParams.has('sslmode') && !['disable','prefer','require'].includes(u.searchParams.get('sslmode')))) {
    throw new Error('Explicit loopback local database required; no staging/remote/service overrides');
  }
  return {host:u.hostname.replace(/^\[|\]$/g,''),port:u.port||'5432',database:decodeURIComponent(u.pathname.slice(1)),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),sslmode:u.searchParams.get('sslmode')??'prefer'};
}
async function execute(executable,args,env) {
  await new Promise((accept,reject)=>{
    const child=spawn(executable,args,{env,windowsHide:true,stdio:['ignore','ignore','ignore']});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Local PostgreSQL backup timeout; partial file retained, not certified'));},120000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('pg_dump/pg_restore unavailable; no backup inferred'));});
    child.once('exit',code=>{clearTimeout(timer);code===0?accept():reject(new Error('PostgreSQL backup command failed; no backup inferred'));});
  });
}
async function main() {
  if(!process.argv.includes('--local-authorized'))throw new Error('Use db:backup -- --local-authorized; private local database backup only');
  const target=localDatabaseTarget(process.env.DATABASE_URL??'',process.env.GSS_RUNTIME_ENV??'local');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  try {
    const bytes=Number((await pool.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes);
    if(!Number.isSafeInteger(bytes)||bytes>256*1024*1024)throw new Error('Local backup exceeds 256 MiB policy; operator backup required');
  }finally{await pool.end();}
  const folder=resolve('data/backups');
  for(let path=folder;dirname(path)!==path;path=dirname(path)){
    try{if((await lstat(path)).isSymbolicLink())throw new Error('Backup symlink ancestor denied');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  await mkdir(folder,{recursive:true});
  const name=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID(),file=resolve(folder,name+'.dump');
  // Paths refer to the installed native utility; no downloading or database password in argv/logs.
  const dump=process.env.GSS_PG_DUMP_PATH??(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe':'pg_dump');
  const restore=process.env.GSS_PG_RESTORE_PATH??(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe':'pg_restore');
  const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,PGHOST:target.host,PGPORT:target.port,
    PGDATABASE:target.database,PGUSER:target.user,PGPASSWORD:target.password,PGSSLMODE:target.sslmode,PGCONNECT_TIMEOUT:'5'};
  await execute(dump,['--format=custom','--no-owner','--no-acl','--file',file],env);
  await execute(restore,['--list',file],env);
  const sha=createHash('sha256');for await(const chunk of createReadStream(file))sha.update(chunk);
  const receipt={schemaVersion:'gss.local-db-backup.v1',createdAt:new Date().toISOString(),file,
    bytes:(await stat(file)).size,sha256:sha.digest('hex'),archiveListVerified:true,restoreDrill:'NOT RUN',privateData:true};
  await writeFile(resolve(folder,name+'.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(receipt,null,2));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
