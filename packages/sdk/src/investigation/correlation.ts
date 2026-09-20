import type { InvestigationEvidence, InvestigationVerdict } from './types.js';

export const VERDICT_POLICY_VERSION = 'gss.deterministic-verdict.v1';

function securityResults(evidence: InvestigationEvidence): Array<Record<string, unknown>> {
  return evidence.events.flatMap(event => Array.isArray(event.security_result)
    ? event.security_result.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>> : []);
}

export function correlateEvidence(evidence: InvestigationEvidence): InvestigationVerdict {
  const findings = securityResults(evidence);
  const highFindings = findings.filter(item => ['HIGH', 'CRITICAL'].includes(String(item.severity).toUpperCase()));
  const explicitlyBenign = findings.length > 0 && findings.every(item =>
    ['ALLOW', 'ALLOWED'].includes(String(item.action).toUpperCase()) &&
    ['LOW', 'INFORMATIONAL', 'INFO'].includes(String(item.severity).toUpperCase()));
  const verdict = evidence.events.length === 0 ? 'INSUFFICIENT_EVIDENCE' :
    highFindings.length >= 2 && new Set(evidence.eventIds).size >= 2 ? 'CONFIRMED' :
      explicitlyBenign ? 'BENIGN' : 'SUSPICIOUS';
  const rationale = verdict === 'INSUFFICIENT_EVIDENCE' ? 'Chronicle returned no matching allowlisted events.' :
    verdict === 'CONFIRMED' ? 'At least two distinct matching events contain high or critical deterministic findings.' :
      verdict === 'BENIGN' ? 'All returned security results are explicitly allowed and low/informational severity.' :
        'Matching events exist, but the deterministic confirmation threshold was not met.';
  return {
    incidentId: evidence.incidentId, taskId: evidence.taskId, verdict,
    evidenceIds: [evidence.evidenceId], policyVersion: VERDICT_POLICY_VERSION, rationale,
    createdAt: new Date().toISOString(),
  };
}
