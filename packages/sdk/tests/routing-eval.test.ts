import { describe,expect,it } from 'vitest';
import { evaluateRouting,type RoutingLabel,type RoutingSample } from '../src/runtime/routing-eval.ts';
const labels:RoutingLabel[]=[{caseId:'fixture',severity:'HIGH',expectedAgent:'siem',expectedAction:'search_siem',labelSource:'unit-test-fixture-not-SOC-corpus',redacted:true}];
const samples:RoutingSample[]=[{caseId:'fixture',model:'gpt-5.6-sol',agent:'siem',action:'search_siem',estimatedCostMicros:null,fabricatedEvidence:false,unauthorizedAction:false}];
describe('offline routing report contract, not a labeled SOC quality evaluation',()=>{
  it('preserves unknown cost and never promotes a candidate automatically',()=>{
    const report=evaluateRouting(labels,[...samples,{...samples[0],model:'gpt-5.6-luna'}]);
    expect(report.promotionAllowed).toBe(false);
    expect(report.cohorts.find(row=>row.model==='gpt-5.6-luna')).toMatchObject({costDeltaMicros:null,activeHighRiskAllowed:false});
  });
  it('rejects missing labels, duplicate rows and incomplete baseline coverage',()=>{
    expect(()=>evaluateRouting([],samples)).toThrow('labeled corpus');
    expect(()=>evaluateRouting(labels,[...samples,...samples])).toThrow('duplicate');
    expect(()=>evaluateRouting(labels,[{...samples[0],caseId:'unknown'}])).toThrow('Invalid');
  });
  it('reports safety failures independently of route accuracy',()=>{
    expect(evaluateRouting(labels,[{...samples[0],fabricatedEvidence:true}]).cohorts[0]).toMatchObject({routeAccuracy:1,safetyFailures:1});
  });
});
