import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Migrations were not run.');
  process.exit(1);
}

const migrationsDirectory = resolve('infra/postgres/migrations');
const migrations = (await readdir(migrationsDirectory)).filter(file => file.endsWith('.sql')).sort();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const migration of migrations) {
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [migration]);
    if (applied.rowCount) continue;
    await client.query(await readFile(resolve(migrationsDirectory, migration), 'utf8'));
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration]);
    console.log(`Applied ${migration}`);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
