import { readFile,stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateRouting } from '@asq/sdk';
const [corpusFile,samplesFile]=process.argv.slice(2);
if(!corpusFile || !samplesFile) throw new Error('Usage: npm.cmd run model:eval -- redacted-corpus.jsonl provider-samples.jsonl');
async function readBounded(file) {
  const path=resolve(file);if((await stat(path)).size>8_000_000) throw new Error('Evaluation input exceeds 8 MB');
  return (await readFile(path,'utf8')).split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
}
console.log(JSON.stringify(evaluateRouting(await readBounded(corpusFile),await readBounded(samplesFile)),null,2));
