import type { SandboxVerificationResult } from '@asq/sdk';

/** Legacy entry point is fail-closed until the verified proposal workflow exists. */
export class PrDispatcher {
  public async testAndDispatch(_patchCode: string): Promise<SandboxVerificationResult> {
    return { buildStatus:'FAILED',unitTestsPassed:false,
      reason:'GITOPS_BLOCKED: durable approval, artifact provenance and isolated patch verification required. No PR was created.' };
  }
}
