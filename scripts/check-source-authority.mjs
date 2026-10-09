import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const violations = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await walk(child);
    else if (/\.(js|d\.ts|map)$/.test(entry.name)) violations.push(child);
  }
}
for (const group of ['packages', 'services']) {
  for (const entry of await readdir(group, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const source = join(group, entry.name, 'src');
      await walk(source).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
for (const dir of ['app', 'components', 'lib']) await walk(join('apps/standalone', dir));
const orchestrator = await readFile('services/standalone/src/command-center.ts', 'utf8');
if (/PostgresRuntimeStore|RuntimeStore|this\.store/.test(orchestrator)) {
  violations.push('Command Center has a direct persistence authority dependency');
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else console.log('TypeScript source and Control Plane writer boundary: PASS');
