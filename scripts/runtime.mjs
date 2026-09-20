import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const targets = {
  standalone: 'services/standalone/src/main.ts',
  worker: 'services/cli-worker/src/main.ts',
  ide: 'services/ide-reasoning/src/main.ts',
  siem: 'services/siem-worker/src/main.ts',
  smoke: 'tests/e2e/test_closed_loop.ts'
};
const target = targets[process.argv[2]];
if (!target) throw new Error('Unknown runtime target');
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(process.execPath, ['--loader', 'ts-node/esm', resolve(root, target)], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true', TS_NODE_PREFER_TS_EXTS: 'true' }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
