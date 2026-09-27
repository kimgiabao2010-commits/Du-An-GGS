import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
  for (const migration of migrations) {
    const sql = await readFile(resolve(migrationsDirectory, migration), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [migration]);
    if (applied.rowCount) {
      const recorded = applied.rows[0]?.checksum;
      if (recorded && recorded !== checksum) throw new Error(`Applied migration checksum mismatch: ${migration}`);
      if (!recorded) await client.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [migration, checksum]);
      continue;
    }
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [migration, checksum]);
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
