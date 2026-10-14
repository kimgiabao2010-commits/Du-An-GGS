import type { EvidenceFrontier, InvestigationRun, HypothesisPlan } from '@asq/sdk';

export type InvestigationView = {run: InvestigationRun; frontier: EvidenceFrontier; hypothesisPlan?: HypothesisPlan};
const text = (x: unknown, max = 300): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const date = (x: unknown) => text(x, 64) && Number.isFinite(Date.parse(x));
const count = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0;
const refs = (x: unknown, allowed?: Set<string>): x is string[] => Array.isArray(x) && x.length <= 5000 &&
  x.every(s => text(s) && (!allowed || allowed.has(s))) && new Set(x).size === x.length;

/** Browser display boundary only. Authority still validates hashes, policy, session and incident ACL server-side. */
export function investigationView(input: unknown, caseId: string): InvestigationView {
  const value = input as InvestigationView, r = value?.run, f = value?.frontier, p = value?.hypothesisPlan;
  if (r?.schemaVersion !== 'gss.investigation-run.v1' || f?.schemaVersion !== 'gss.evidence-frontier.v1' ||
    r.caseId !== caseId || f.caseId !== caseId || !text(r.runId,128) || r.runId !== f.runId ||
    !count(f.version) || r.frontierVersion !== f.version || !count(r.depth) || !text(r.policyVersion,128) ||
    !['ACTIVE','WAITING_APPROVAL','FINALIZED','BLOCKED','FAILED'].includes(r.state) ||
    !count(r.budget?.maxDepth) || !count(r.budget?.maxExternalQueries) || !count(r.budget?.maxCostMicros) || !date(r.budget?.deadlineAt) ||
    !count(r.usage?.costMicros) || !count(r.usage?.externalQueries) || !date(f.updatedAt) ||
    !refs(f.evidenceRefs) || !refs(f.sourceObservationIds) || !Array.isArray(f.facts) || f.facts.length > 5000 ||
    !Array.isArray(f.contradictions) || f.contradictions.length > 5000) throw new Error('Invalid investigation contract; nothing inferred.');
  const evidence = new Set(f.evidenceRefs), facts = new Map(f.facts.map(x => [x?.factId,x]));
  if (facts.size !== f.facts.length || f.facts.some(x => !text(x?.factId,128) || !text(x.key) || !text(x.value,32000) ||
    !['FACT','INFERENCE','HYPOTHESIS','UNKNOWN'].includes(x.semanticType) || !Array.isArray(x.provenance) ||
    !x.provenance.length || x.provenance.length > 1000 || x.provenance.some(y => !text(y?.taskId,128) ||
      !text(y.source) || !evidence.has(y.evidenceRef) || !date(y.observedAt) ||
      (y.artifactHash !== undefined && !/^[a-f0-9]{64}$/.test(y.artifactHash)))) ||
    f.contradictions.some(x => !text(x?.contradictionId,128) || !text(x.key) || !refs(x.factIds,new Set(facts.keys())) ||
      x.factIds.length < 2 || x.factIds.some(id => facts.get(id)?.key !== x.key))) throw new Error('Invalid evidence references; nothing inferred.');
  if (p !== undefined && (p?.schemaVersion !== 'gss.hypothesis-plan.v1' || !text(p.planId,128) ||
    p.runId !== r.runId || p.caseId !== caseId || p.frontierVersion !== f.version || p.policyVersion !== r.policyVersion ||
    !Array.isArray(p.hypotheses) || !p.hypotheses.length || p.hypotheses.length > 16 ||
    new Set(p.hypotheses.map(h => h?.hypothesisId)).size !== p.hypotheses.length ||
    p.hypotheses.some(h => !text(h?.hypothesisId,128) || !text(h.statement,500) ||
      !['SUPPORTED','REFUTED','INSUFFICIENT_EVIDENCE'].includes(h.status) ||
      ![null,'MISSING','STALE','CONTRADICTORY','UNRECOGNIZED_VALUE'].includes(h.gap) ||
      !refs(h.factIds,new Set(facts.keys())) || !refs(h.evidenceIds,evidence)) ||
    !refs(p.selectedFactIds,new Set(facts.keys())) || !refs(p.selectedEvidenceIds,evidence) ||
    !(p.selectedQuestionId === null || text(p.selectedQuestionId,128)) ||
    p.decision?.schemaVersion !== 'gss.next-step.v1' || p.decision.runId !== r.runId || p.decision.caseId !== caseId ||
    p.decision.frontierVersion !== f.version || p.decision.policyVersion !== r.policyVersion ||
    !text(p.decision.decisionId,128) || !['DISPATCH','WAIT_APPROVAL','FINALIZE','BLOCKED'].includes(p.decision.kind) ||
    !text(p.decision.reasonCode,128) || !text(p.decision.rationale,4000) || !date(p.decision.createdAt))) {
    throw new Error('Invalid stored hypothesis plan; nothing inferred.');
  }
  const c=p?.coverage;
  if(c !== undefined && (c?.schemaVersion!=='gss.hypothesis-coverage.v1' || c.scope!=='ALLOWLISTED_STRUCTURED_FIELDS_ONLY' ||
    !count(c.discoveredIndicators) || c.discoveredIndicators>5000 || !count(c.evaluatedIndicators) || c.evaluatedIndicators>16 ||
    !count(c.omittedIndicators) || c.discoveredIndicators!==c.evaluatedIndicators+c.omittedIndicators ||
    !refs(c.partialExtractionEvidenceIds,evidence) || !Array.isArray(c.limitations) || c.limitations.length>2 ||
    new Set(c.limitations).size!==c.limitations.length || c.limitations.some(s=>!['CANDIDATE_LIMIT','PARTIAL_EXTRACTION'].includes(s)) ||
    c.limitations.includes('CANDIDATE_LIMIT')!==(c.omittedIndicators>0) ||
    c.limitations.includes('PARTIAL_EXTRACTION')!==(c.partialExtractionEvidenceIds.length>0))) throw new Error('Invalid hypothesis coverage; nothing inferred.');
  return value;
}
