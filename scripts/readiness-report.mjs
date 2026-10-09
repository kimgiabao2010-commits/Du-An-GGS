import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';

const checks = [];
const profile = process.env.GSS_SOC_PROFILE ?? 'staging';
const profileValid = ['lab','replay','staging'].includes(profile) && !(process.env.GSS_RUNTIME_ENV==='staging' && profile!=='staging');
const lab = profileValid && profile!=='staging';
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
check('SOC profile', profileValid, profileValid ? `${profile}; local PASS is not staging evidence.` : 'Invalid profile or staging downgrade.');
if (lab) check('Own-device data authorization', process.env.GSS_LAB_OWN_DEVICE_AUTHORIZED==='true' && Boolean(process.env.GSS_LAB_ALLOWED_SOURCES?.trim()),
  'Lab sources must be explicitly authorized; no company/remote logs or paid-model fallback.');
check('Control Plane configuration', true,
  process.env.CONTROL_PLANE_URL || 'Using Ctrl+Shift+B loopback default http://127.0.0.1:4100.');
check('Control Plane internal authentication', true,
  process.env.GSS_CONTROL_PLANE_TOKEN?.length >= 32
    ? 'A service token is configured.' : 'Ctrl+Shift+B will generate an ephemeral 256-bit service token.');
const signatureRequired = process.env.GSS_REQUIRE_ARTIFACT_SIGNATURE === 'true';
const signingConfigured = Boolean(process.env.GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64?.trim() && process.env.GSS_ARTIFACT_SIGNING_KEY_ID?.trim());
check('Artifact signing', signingConfigured,
  signingConfigured ? 'Control Plane Ed25519 signing key and key ID are configured.' :
    signatureRequired ? 'Artifact signatures are required but the Control Plane signing key is missing.' :
      'Local mode permits unsigned artifacts; staging should require signatures.', signatureRequired);
check('Chronicle staging configuration', chronicleReady,
  chronicleReady ? 'Coordinates configured, NOT a live connection/permission test.' : 'GSS_CHRONICLE_* coordinates are incomplete.', !lab);
check('Docker runtime', commandAvailable('docker', ['version']),
  commandAvailable('docker', ['version']) ? 'Docker daemon is reachable; rootless/isolation NOT verified.' : 'Docker is unavailable; IDE sandbox remains BLOCKED.', !lab);
check('Google viewer identity', Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT),
  process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT ? 'ADC/project hints are present; IAM permission still requires staging verification.' : 'ADC/project configuration is absent.', !lab);

console.log('\nGSS readiness report');
for (const item of checks) console.log(`${item.pass ? 'PASS' : item.hard ? 'BLOCKED' : 'NOT RUN'}  ${item.name}: ${item.detail}`);
const blocked = checks.filter(item => item.hard && !item.pass).length;
console.log(`\nResult: ${blocked ? `BLOCKED (${blocked} hard prerequisite${blocked === 1 ? '' : 's'})` : `${profile.toUpperCase()} CONFIGURED; not a verified live release. Chronicle/sandbox staging gates remain independent.`}`);
process.exitCode = blocked ? 1 : 0;
