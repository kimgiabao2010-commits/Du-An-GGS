import {isInvestigationEvidence, type InvestigationEvidence, type InvestigationVerdict} from './types.js';

export const VERDICT_POLICY_VERSION = 'gss.deterministic-verdict.v2';

function securityResults(evidence: InvestigationEvidence): Array<Record<string, unknown>> {
  return evidence.events.flatMap(event => Array.isArray(event.security_result)
    ? event.security_result.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>> : []);
}

export function correlateEvidence(evidence: InvestigationEvidence): InvestigationVerdict {
  if(!isInvestigationEvidence(evidence) || evidence.events.length>1000 || evidence.eventIds.length!==evidence.events.length) {
    throw new Error('Invalid bounded verdict evidence/lineage');
  }
  if (evidence.provenance.adapter !== 'google-chronicle') return {
    incidentId: evidence.incidentId, taskId: evidence.taskId, verdict: 'INSUFFICIENT_EVIDENCE',
    evidenceIds: [evidence.evidenceId], policyVersion: 'gss.lab-metadata-only.v1',
    rationale: 'Lab event metadata does not establish a security verdict.', createdAt: new Date().toISOString(),
  };
  const findings = securityResults(evidence);
  const highFindings = findings.filter(item => typeof item.severity==='string' && ['HIGH', 'CRITICAL'].includes(item.severity.toUpperCase()));
  // Provider severity is a triage signal, not independently corroborated compromise.
  // ALLOW/LOW, missing security results or bounded zero results cannot prove a benign case.
  const verdict = highFindings.length>0 ? 'SUSPICIOUS' : 'INSUFFICIENT_EVIDENCE';
  const rationale = verdict === 'INSUFFICIENT_EVIDENCE' ? 'Chronicle returned no matching allowlisted events.' :
    'Provider HIGH/CRITICAL severity requires investigation; neither duplicate findings nor distinct event counts establish compromise.';
  return {
    incidentId: evidence.incidentId, taskId: evidence.taskId, verdict,
    evidenceIds: [evidence.evidenceId], policyVersion: VERDICT_POLICY_VERSION,
    rationale: (verdict==='INSUFFICIENT_EVIDENCE' && evidence.events.length>0 ?
      'Returned telemetry does not satisfy an independently reviewed benign/compromise rule; ALLOW/LOW is not proof of safety.' : rationale)+
      (evidence.provenance.truncated?' Results are truncated; coverage is incomplete.':''),
    createdAt: new Date().toISOString(),
  };
}
