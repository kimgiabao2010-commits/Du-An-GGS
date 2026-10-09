import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

// Keep regression/fault-injection data out of the developer's runtime schema.
const schema = 'gss_suite_' + randomUUID().replaceAll('-', '');
let administrator, database;
const env = { ...process.env };
try {
  if (env.DATABASE_URL) {
    if (!/^gss_suite_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema');
    administrator = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
    await administrator.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(env.DATABASE_URL);
    url.searchParams.set('options', '-c search_path=' + schema);
    env.DATABASE_URL = url.toString();
    database = new Pool({ connectionString: env.DATABASE_URL });
    for (const file of (await readdir(resolve('infra/postgres/migrations'))).filter(file => file.endsWith('.sql')).sort()) {
      await database.query(await readFile(resolve('infra/postgres/migrations', file), 'utf8'));
    }
    console.log('Integration PostgreSQL: isolated schema, all migrations applied.');
  } else console.log('Integration PostgreSQL: NOT RUN (DATABASE_URL missing).');
  process.exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run',
      '--config', 'vitest.integration.config.ts', ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1));
  });
} finally {
  await database?.end();
  if (administrator) {
    if (!/^gss_suite_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test cleanup');
    await administrator.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await administrator.end();
  }
}
