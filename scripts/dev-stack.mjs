import 'dotenv/config';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { connect } from 'node:net';

const dryRun = process.argv.includes('--dry-run');
const now = Date.now();
const root = fileURLToPath(new URL('../', import.meta.url));
const secret = process.env.ASQ_JWT_SECRET && process.env.ASQ_JWT_SECRET.length >= 32
  ? process.env.ASQ_JWT_SECRET : randomBytes(32).toString('base64url');
// Fixed preview credentials requested for the one-button local runtime. The
// auth route accepts this weak password only when the launcher marks the
// request as an explicitly insecure loopback demo session.
const username = 'BaoNVG';
const password = '1';

function token(agentId, role) {
  const claims = { agentId, role, permissions: ['REPORT'], timestamp: now, expiresAt: now + 8 * 60 * 60 * 1000 };
  const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
}

const runtimeEnv = {
  ...process.env,
  ASQ_JWT_SECRET: secret,
  ASQ_ADMIN_USERNAME: username,
  ASQ_ADMIN_PASSWORD: password,
  ASQ_INSECURE_LOCAL_DEMO_AUTH: 'true',
  ASQ_WEB_ORIGIN: process.env.ASQ_WEB_ORIGIN || 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001',
  ASQ_WS_URL: process.env.ASQ_WS_URL || 'ws://127.0.0.1:4000',
  ASQ_LOCAL_RUNTIME: 'true',
  GSS_DATA_DIR: process.env.GSS_DATA_DIR || resolve(root, 'data'),
  GSS_IDE_REPOSITORY_ROOTS: process.env.GSS_IDE_REPOSITORY_ROOTS || root,
  ASQ_WORKER_TOKEN: token('cli-worker-agent', 'CLI_DAEMON'),
  ASQ_IDE_TOKEN: token('ide-worker-agent', 'IDE_AGENT'),
  ASQ_SIEM_TOKEN: token('siem-worker-agent', 'SIEM'),
};

const tsRuntime = ['--loader', 'ts-node/esm'];
const nextBin = resolve(root, 'node_modules/next/dist/bin/next');
const webRoot = resolve(root, 'apps/standalone');
const services = [
  ['Command Center', process.execPath, [...tsRuntime, resolve(root, 'services/standalone/src/main.ts')], root],
  ['CLI worker', process.execPath, [...tsRuntime, resolve(root, 'services/cli-worker/src/main.ts')], root],
  ['IDE agent', process.execPath, [...tsRuntime, resolve(root, 'services/ide-reasoning/src/main.ts')], root],
  ['SIEM worker', process.execPath, [...tsRuntime, resolve(root, 'services/siem-worker/src/main.ts')], root],
  ['Web UI', process.execPath, [nextBin, 'start', '-H', '127.0.0.1', '-p', '3000'], webRoot],
];

function portInUse(port) {
  return new Promise(resolvePort => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolvePort(true); });
    socket.once('error', () => { socket.destroy(); resolvePort(false); });
    socket.setTimeout(500, () => { socket.destroy(); resolvePort(false); });
  });
}

const occupied = [];
for (const port of [3000, 4000]) if (await portInUse(port)) occupied.push(port);
if (occupied.length && !dryRun) {
  console.error(`Cannot start: port ${occupied.join(', ')} is already in use.`);
  console.error('Stop the previous GSS/Next terminal with Ctrl+C, then press Ctrl+Shift+B again.');
  process.exit(1);
}

if (dryRun) {
  console.log('\nGSS local stack check');
  console.log('URL: http://localhost:3000');
  console.log(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY ? 'OK: LLM provider configured.' : 'WARNING: no LLM provider; deterministic read-only intents still work.');
  console.log('OK: will start ' + services.map(([name]) => name).join(', '));
  console.log(`OK: IDE read-only root configured (${runtimeEnv.GSS_IDE_REPOSITORY_ROOTS === root ? 'repository root' : 'custom allowlist'}).`);
  console.log(process.env.GSS_CHRONICLE_PROJECT && process.env.GSS_CHRONICLE_LOCATION && process.env.GSS_CHRONICLE_INSTANCE && process.env.GSS_CHRONICLE_ENDPOINT
    ? 'OK: Chronicle read-only worker configured.' : 'WARNING: Chronicle worker will remain disabled until its four GSS_CHRONICLE_* settings are configured.');
  console.log(occupied.length ? `WARNING: occupied ports: ${occupied.join(', ')}.` : 'OK: ports 3000 and 4000 are available.');
  console.log(process.env.DATABASE_URL ? 'OK: PostgreSQL persistence configured.' : 'WARNING: DATABASE_URL is not configured; runtime will be persistence-degraded and will not use SQLite.');
  process.exit(0);
}

console.log('Building a stable local production UI...');
const webBuild = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: webRoot,
  env: runtimeEnv,
  stdio: 'inherit',
  windowsHide: true,
});
if (webBuild.status !== 0) {
  console.error('Web UI build failed; backend and workers were not started.');
  process.exit(webBuild.status ?? 1);
}

console.log('\nGSS local stack');
console.log('URL:      http://localhost:3000');
console.log('Username: ' + username);
console.log('Password: ' + password + ' (insecure local demo only)');
console.log(process.env.DATABASE_URL ? 'Storage:  PostgreSQL' : 'Storage:  DEGRADED (configure DATABASE_URL for durable state)');
console.log('These credentials are only for this local runtime.\n');

const children = new Set();
let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 1000);
}

for (const [name, command, args, cwd] of services) {
  const child = spawn(command, args, {
    cwd,
    env: { ...runtimeEnv, TS_NODE_TRANSPILE_ONLY: 'true', TS_NODE_PREFER_TS_EXTS: 'true' },
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.on('error', error => {
    console.error(`[${name}] failed to start: ${error.message}`);
    stop(1);
  });
  child.on('exit', code => {
    children.delete(child);
    if (!stopping && code !== 0) {
      console.error(`[${name}] exited with code ${code}; stopping the full stack.`);
      stop(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
