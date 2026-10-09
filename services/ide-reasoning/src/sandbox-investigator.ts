import type { GssTaskContract } from '@asq/sdk';
import { isIdeInvestigationRecord } from '@asq/sdk';
import { EphemeralSandboxRunner } from '../../cli-worker/src/sandbox/ephemeral-runner.js';
import { ReadonlyRepoInvestigator, type IdeWorkerResult } from './readonly-investigator.js';

export class SandboxRepoInvestigator {
  async execute(task: GssTaskContract, signal?: AbortSignal): Promise<IdeWorkerResult> {
    const fail = (code: string, message: string): IdeWorkerResult => ({ taskId:task.taskId,status:'BLOCKED',output:message,failure:{ code,message },durationMs:0 });
    if (signal?.aborted) return { ...fail('CANCELLED','Investigation cancelled'),status:'CANCELLED' };
    const bounded = { ...task, parameters:{ question:String(task.parameters.question ?? task.parameters.query ?? task.action).slice(0,512) } };
    const input = Buffer.from(JSON.stringify(bounded)).toString('base64url');
    if (input.length>2000) return fail('TASK_INPUT_LIMIT','Sandbox task exceeds bounded request size');
    const result = await new EphemeralSandboxRunner({ timeoutMs:Math.min(task.timeoutMs,120000) }).runInSandbox('node',
      ['/opt/gss/node_modules/tsx/dist/cli.mjs','/opt/gss/scripts/sandbox-ide-entry.ts',input],signal);
    if (signal?.aborted) return { ...fail('CANCELLED','Investigation cancelled'),status:'CANCELLED' };
    if (result.status !== 'COMPLETED') return { ...fail(result.status === 'BLOCKED' ? 'SANDBOX_UNAVAILABLE':'SANDBOX_FAILED',result.stderr),status:result.status,durationMs:result.durationMs };
    try {
      const output = JSON.parse(result.stdout) as IdeWorkerResult;
      if (output.taskId!==task.taskId || output.status!=='SUCCESS' || !isIdeInvestigationRecord(output.investigation) ||
        output.investigation.taskId!==task.taskId || output.investigation.caseId!==task.caseId) throw new Error('Invalid sandbox provenance');
      return { ...output,durationMs:result.durationMs };
    } catch { return fail('SANDBOX_RESULT_INVALID','Sandbox output failed investigation contract validation'); }
  }
}
export function repoInvestigatorFromEnvironment(): Pick<ReadonlyRepoInvestigator,'execute'> {
  return process.env.GSS_RUNTIME_ENV==='staging' ? new SandboxRepoInvestigator() : ReadonlyRepoInvestigator.fromEnvironment();
}
