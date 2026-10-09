import { describe,expect,it } from 'vitest';
import { PrDispatcher } from '../../services/cli-worker/src/gitops/pr-dispatcher.ts';
import { PatchGenerator } from '../../services/ide-reasoning/src/remediation/patch-generator.ts';
import { AstSemanticParser } from '../../services/ide-reasoning/src/ast/ast-parser.ts';
import { BlastRadiusAssessmentEngine } from '../../services/standalone/src/assessment/blast-radius.ts';
import { CanaryRollbackGuard } from '../../packages/guardrails/src/canary/rollback-guard.ts';
import { SastScanner } from '../../services/cli-worker/src/scanners/sast-scanner.ts';
import { NetworkReconScanner } from '../../services/cli-worker/src/scanners/network-recon.ts';
import { SiemReceiver } from '../../services/standalone/src/ingestion/siem-receiver.ts';
describe('legacy proposal entry points never fabricate completion',()=>{
  it('does not fabricate scanner findings, IPs or Chronicle provenance',async()=>{
    expect(await new SastScanner().scanCodebase()).toMatchObject({status:'BLOCKED',findings:[]});
    expect(await new NetworkReconScanner().scanTarget('203.0.113.4')).toMatchObject({status:'BLOCKED',openPorts:[],vulnerabilities:[]});
    const log=new SiemReceiver().ingestRawLog('fixture-only');
    expect(log.source).toBe('user-provided-log');expect(log.details.verified).toBe(false);
    expect(log.details).not.toHaveProperty('principalIp');
  });
  it('returns no PR URL or verified build from an unverified patch',async()=>{
    expect(await new PrDispatcher().testAndDispatch('fixture')).toMatchObject({buildStatus:'FAILED',unitTestsPassed:false});
    expect(await new PrDispatcher().testAndDispatch('fixture')).not.toHaveProperty('pullRequestUrl');
  });
  it('does not invent an AST defect or source-independent patch',()=>{
    expect(()=>new AstSemanticParser().parseIaC('safe fixture')).toThrow('AST_BLOCKED');
    expect(()=>new AstSemanticParser().parseAppCode('safe fixture')).toThrow('AST_BLOCKED');
    expect(()=>new PatchGenerator().generateRemediation({startLine:1,endLine:1,rootCause:'fixture',type:'IaC'})).toThrow('PATCH_BLOCKED');
  });
  it('never authorizes auto deploy from a filename heuristic or claims real rollback',()=>{
    expect(new BlastRadiusAssessmentEngine().calculateRiskScore(['infra/fixture.tf']).isSafeForAutoDeploy).toBe(false);
    const guard=new CanaryRollbackGuard();
    expect(()=>{for(let n=0;n<50;n++) guard.recordRequest(true);}).toThrow('no rollback performed');
  });
});
