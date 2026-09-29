import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';

const checks = [];
function check(name, pass, detail, hard = true) {
  checks.push({ name, pass, detail, hard });
}

function commandAvailable(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const chronicleReady = ['GSS_CHRONICLE_PROJECT', 'GSS_CHRONICLE_LOCATION', 'GSS_CHRONICLE_INSTANCE', 'GSS_CHRONICLE_ENDPOINT']
  .every(name => Boolean(process.env[name]?.trim()));

let postgresLive = false;
let postgresDetail = 'DATABASE_URL is missing.';
if (process.env.DATABASE_URL?.trim()) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3_000 });
  try {
    await pool.query('SELECT 1');
    postgresLive = true;
    postgresDetail = 'PostgreSQL accepted SELECT 1.';
  } catch (error) {
    postgresDetail = `PostgreSQL connectivity failed: ${error instanceof Error ? error.message : 'unknown error'}`;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

check('PostgreSQL configuration', Boolean(process.env.DATABASE_URL?.trim()),
  process.env.DATABASE_URL ? 'DATABASE_URL is configured.' : 'DATABASE_URL is missing.');
check('PostgreSQL connectivity', postgresLive, postgresDetail);
check('Control Plane configuration', true,
  process.env.CONTROL_PLANE_URL || 'Using Ctrl+Shift+B loopback default http://127.0.0.1:4100.');
check('Chronicle staging configuration', chronicleReady,
  chronicleReady ? 'Project, location, instance and endpoint are configured.' : 'GSS_CHRONICLE_* coordinates are incomplete.');
check('Docker runtime', commandAvailable('docker', ['version']),
  commandAvailable('docker', ['version']) ? 'Docker daemon is reachable.' : 'Docker is unavailable; sandbox hard gate cannot run.');
check('Google viewer identity', Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT),
  process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT ? 'ADC/project hints are present; IAM permission still requires staging verification.' : 'ADC/project configuration is absent.');

console.log('\nGSS readiness report');
for (const item of checks) console.log(`${item.pass ? 'PASS' : item.hard ? 'BLOCKED' : 'NOT RUN'}  ${item.name}: ${item.detail}`);
const blocked = checks.filter(item => item.hard && !item.pass).length;
console.log(`\nResult: ${blocked ? `BLOCKED (${blocked} hard prerequisite${blocked === 1 ? '' : 's'})` : 'CONFIGURED; run live integration gates next.'}`);
process.exitCode = blocked ? 1 : 0;
