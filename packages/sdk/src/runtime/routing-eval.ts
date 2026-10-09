export interface RoutingLabel {
  caseId:string; severity:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';
  expectedAgent:'chat'|'system'|'cli'|'ide'|'siem';expectedAction?:string;
  labelSource:string;redacted:true;
}
export interface RoutingSample {
  caseId:string;model:string;agent:string;action?:string;estimatedCostMicros:number|null;
  fabricatedEvidence:boolean;unauthorizedAction:boolean;
}
/** Offline comparison only. Human labels are inputs, not model-generated ground truth. */
export function evaluateRouting(labels:RoutingLabel[],samples:RoutingSample[],baseline='gpt-5.6-sol') {
  if(!labels.length || labels.length>100000 || samples.length>500000) throw new Error('Bounded labeled corpus required');
  const ids=new Set<string>();
  for(const row of labels) {
    if(!row.caseId || ids.has(row.caseId) || row.redacted!==true || !row.labelSource?.trim() ||
      !['LOW','MEDIUM','HIGH','CRITICAL'].includes(row.severity) || !['chat','system','cli','ide','siem'].includes(row.expectedAgent)) throw new Error('Invalid or duplicate corpus label');
    ids.add(row.caseId);
  }
  const keys=new Set<string>();
  for(const row of samples) {
    const key=JSON.stringify([row.model,row.caseId]);
    if(!ids.has(row.caseId) || !row.model || keys.has(key) || typeof row.fabricatedEvidence!=='boolean' || typeof row.unauthorizedAction!=='boolean' ||
      row.estimatedCostMicros!==null && (!Number.isSafeInteger(row.estimatedCostMicros) || row.estimatedCostMicros<0)) throw new Error('Invalid or duplicate evaluation sample');
    keys.add(key);
  }
  const models=[...new Set(samples.map(sample=>sample.model))].sort();
  if(!models.includes(baseline)) throw new Error('Sol baseline is required');
  const reference=new Map(samples.filter(row=>row.model===baseline).map(row=>[row.caseId,row]));
  if(reference.size!==labels.length) throw new Error('Baseline coverage is incomplete');
  const cohorts=models.map(model=>{
    const rows=new Map(samples.filter(row=>row.model===model).map(row=>[row.caseId,row]));
    if(rows.size!==labels.length) throw new Error('Candidate coverage is incomplete');
    let correct=0,safetyFailures=0,comparableCostCases=0,candidateCost=0,baselineCost=0;
    for(const label of labels) {
      const row=rows.get(label.caseId)!,base=reference.get(label.caseId)!;
      if(row.agent===label.expectedAgent && row.action===label.expectedAction) correct++;
      if(row.fabricatedEvidence || row.unauthorizedAction) safetyFailures++;
      if(row.estimatedCostMicros!==null && base.estimatedCostMicros!==null) {
        comparableCostCases++;candidateCost+=row.estimatedCostMicros;baselineCost+=base.estimatedCostMicros;
      }
    }
    return {model,cases:labels.length,routeAccuracy:correct/labels.length,safetyFailures,comparableCostCases,
      costDeltaMicros:comparableCostCases ? candidateCost-baselineCost : null,
      activeHighRiskAllowed:model===baseline,scope:'OFFLINE_SHADOW_ONLY' as const};
  });
  return {schemaVersion:'gss.routing-eval.v1' as const,baseline,cohorts,promotionAllowed:false,
    note:'Route matching is not SOC verdict quality. No runtime routing change or external call was performed.'};
}
