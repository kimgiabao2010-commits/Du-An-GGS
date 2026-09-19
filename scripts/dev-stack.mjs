import 'dotenv/config';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { connect } from 'node:net';

const dryRun = process.argv.includes('--dry-run');
const now = Date.now();
const secret = process.env.ASQ_JWT_SECRET && process.env.ASQ_JWT_SECRET.length >= 32
  ? process.env.ASQ_JWT_SECRET : randomBytes(32).toString('base64url');
const username = process.env.ASQ_ADMIN_USERNAME || 'admin-local';
const hasConfiguredPassword = Boolean(process.env.ASQ_ADMIN_PASSWORD && process.env.ASQ_ADMIN_PASSWORD.length >= 16);
const password = hasConfiguredPassword ? process.env.ASQ_ADMIN_PASSWORD : randomBytes(15).toString('base64url');

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
  ASQ_WEB_ORIGIN: process.env.ASQ_WEB_ORIGIN || 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001',
  ASQ_WS_URL: process.env.ASQ_WS_URL || 'ws://127.0.0.1:4000',
  ASQ_WORKER_TOKEN: token('cli-worker-agent', 'CLI_DAEMON'),
  ASQ_IDE_TOKEN: token('ide-worker-agent', 'IDE_AGENT'),
};

const root = fileURLToPath(new URL('../', import.meta.url));
const tsRuntime = ['--loader', 'ts-node/esm'];
const nextBin = resolve(root, 'node_modules/next/dist/bin/next');
const webRoot = resolve(root, 'apps/standalone');
const services = [
  ['Command Center', process.execPath, [...tsRuntime, resolve(root, 'services/standalone/src/main.ts')], root],
  ['CLI worker', process.execPath, [...tsRuntime, resolve(root, 'services/cli-worker/src/main.ts')], root],
  ['IDE agent', process.execPath, [...tsRuntime, resolve(root, 'services/ide-reasoning/src/main.ts')], root],
  ['Web UI', process.execPath, [nextBin, 'start', '-p', '3000'], webRoot],
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
  console.error(`Không thể khởi động: cổng ${occupied.join(', ')} đang được tiến trình khác sử dụng.`);
  console.error('Dừng phiên GSS/Next cũ trong terminal bằng Ctrl+C rồi nhấn Ctrl+Shift+B lại.');
  process.exit(1);
}

if (dryRun) {
  console.log('\nGSS local stack check');
  console.log('URL: http://localhost:3000');
  if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) console.log('OK: đã cấu hình LLM provider (OpenAI/Groq).');
  console.log('OK: sẽ khởi động ' + services.map(([name]) => name).join(', '));
  console.log(occupied.length ? `CẢNH BÁO: cổng đang bận: ${occupied.join(', ')}.` : 'OK: cổng 3000 và 4000 đang trống.');
  if (!process.env.GROQ_API_KEY) console.log(process.env.OPENAI_API_KEY ? 'OK: đã có OPENAI_API_KEY.' : 'CẢNH BÁO: chưa có OPENAI_API_KEY hoặc GROQ_API_KEY; UI vẫn chạy nhưng router sẽ trả LLM_UNAVAILABLE.');
  process.exit(0);
}

console.log('Đang build Web UI ổn định (production local)…');
const webBuild = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: webRoot,
  env: runtimeEnv,
  stdio: 'inherit',
  windowsHide: true,
});
if (webBuild.status !== 0) {
  console.error('Build Web UI thất bại; chưa khởi động backend hoặc worker.');
  process.exit(webBuild.status ?? 1);
}

console.log('\nGSS local stack');
console.log('URL:      http://localhost:3000');
console.log('Username: ' + username);
console.log(hasConfiguredPassword ? 'Password: dùng ASQ_ADMIN_PASSWORD đã cấu hình trong .env' : 'Password: ' + password);
console.log('Lưu ý: credential trên chỉ dành cho phiên local hiện tại.\n');

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
    console.error(`[${name}] Không khởi động được: ${error.message}`);
    stop(1);
  });
  child.on('exit', code => {
    children.delete(child);
    if (!stopping && code !== 0) {
      console.error(`[${name}] đã dừng với mã ${code}. Đang dừng toàn bộ stack.`);
      stop(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
