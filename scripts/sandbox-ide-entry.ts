import { isGssTaskContract } from '@asq/sdk';
import { ReadonlyRepoInvestigator } from '../services/ide-reasoning/src/readonly-investigator.js';
const encoded = process.argv[2];
if (!encoded || encoded.length>2000) throw new Error('Bounded sandbox input required');
const task = JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
if (!isGssTaskContract(task) || task.target!=='ide') throw new Error('Read-only IDE task required');
const result = await new ReadonlyRepoInvestigator(['/repo']).execute(task);
console.log(JSON.stringify(result));
if (result.status!=='SUCCESS') process.exitCode=1;
