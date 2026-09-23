import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const skillsRoot = resolve(root, 'skills');
const evalsRoot = resolve(root, 'evals');
const expectedSkills = new Set([
  'gss-skill-router',
  'gss-ide-readonly-investigation',
  'gss-evidence-next-step',
  'gss-durable-approval',
  'gss-model-routing-eval',
  'gss-verification-gate',
]);
const requiredSections = [
  '## Purpose',
  '## Trigger / Do not trigger',
  '## Required inputs and preconditions',
  '## Allowed tools and data boundaries',
  '## Ordered process',
  '## Stop / BLOCKED conditions',
  '## Forbidden actions',
  '## Evidence output contract',
  '## Verification',
];

const issues = [];
const reports = [];

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

const entries = await readdir(skillsRoot, { withFileTypes: true });
const skillNames = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

for (const expected of expectedSkills) {
  if (!skillNames.includes(expected)) issues.push(`Missing expected skill: ${expected}`);
}
for (const actual of skillNames) {
  if (!expectedSkills.has(actual)) issues.push(`Unexpected skill directory: ${actual}`);
  const path = resolve(skillsRoot, actual, 'SKILL.md');
  if (!(await exists(path))) { issues.push(`Missing SKILL.md: ${actual}`); continue; }
  const text = await readFile(path, 'utf8');
  const frontmatter = parseFrontmatter(text);
  const lines = text.split(/\r?\n/).length;
  const estimatedTokens = Math.ceil(text.length / 4);
  if (!frontmatter) issues.push(`${actual}: invalid or missing YAML frontmatter`);
  if (frontmatter?.name !== actual) issues.push(`${actual}: frontmatter name does not match directory`);
  if (!frontmatter?.description || frontmatter.description.length < 40) issues.push(`${actual}: description is missing or not discriminating`);
  if (lines >= 500) issues.push(`${actual}: ${lines} lines exceeds the <500 line budget`);
  for (const section of requiredSections) if (!text.includes(section)) issues.push(`${actual}: missing section ${section}`);
  if (!text.includes('`FAILED`')) issues.push(`${actual}: missing explicit FAILED semantics`);
  const referenceLinks = [...text.matchAll(/\]\((\.\.\/\.\.\/references\/[^)]+)\)/g)].map(match => match[1]);
  for (const link of referenceLinks) {
    const target = resolve(dirname(path), link);
    if (!(await exists(target))) issues.push(`${actual}: broken reference ${link}`);
  }
  reports.push({ name: actual, lines, estimatedTokens, references: referenceLinks.length });
}

for (const file of ['trigger-cases.json', 'safety-cases.json', 'milestone-cases.json']) {
  const path = resolve(evalsRoot, file);
  if (!(await exists(path))) { issues.push(`Missing eval file: ${file}`); continue; }
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(data.cases) || data.cases.length === 0) issues.push(`${file}: cases must be a non-empty array`);
    const ids = (data.cases ?? []).map(item => item.id);
    if (new Set(ids).size !== ids.length) issues.push(`${file}: case IDs must be unique`);
    if (ids.some(id => typeof id !== 'string' || !id)) issues.push(`${file}: every case needs a string ID`);
  } catch (error) {
    issues.push(`${file}: invalid JSON (${error.message})`);
  }
}

const totalTokens = reports.reduce((sum, report) => sum + report.estimatedTokens, 0);
console.log('GSS skill audit');
console.log(`Root: ${relative(process.cwd(), root) || '.'}`);
for (const report of reports) {
  console.log(`- ${report.name}: ${report.lines} lines, ~${report.estimatedTokens} tokens, ${report.references} references`);
}
console.log(`Total skill body estimate: ~${totalTokens} tokens`);

if (issues.length) {
  console.error(`FAILED: ${issues.length} issue(s)`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${reports.length} skills and 3 eval files validated.`);
}
