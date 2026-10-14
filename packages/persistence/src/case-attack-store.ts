import type {PoolClient} from 'pg';
import {annotateCaseAttack,SOC_EVIDENCE_POLICY_VERSION,type AttackKnowledge,type EvidenceAttack} from '@asq/sdk';

/** Caller-owned read-only repeatable-read snapshot. Only retained Control Plane SOC projections. */
export async function readCaseAttackWithClient(c:PoolClient,caseId:string,catalog:AttackKnowledge|undefined,now:string) {
  const base=`FROM runtime_executions e JOIN runtime_tasks t ON t.task_id=e.task_id AND t.case_id=e.case_id
    LEFT JOIN investigation_runs r ON r.run_id=t.run_id AND r.case_id=e.case_id
    WHERE e.case_id=$1 AND e.status='COMPLETED' AND e.executor='siem' AND t.target='siem' AND t.action='search_siem'`;
  const eligible="r.policy_version=$2 AND jsonb_typeof(e.result->'attack')='object'";
  const count=(await c.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE ${eligible})::int AS projected ${base}`,
    [caseId,SOC_EVIDENCE_POLICY_VERSION])).rows[0];
  const rows=await c.query(`SELECT e.task_id,e.result->>'sha256' AS artifact_hash,e.result->'evidence'->>'evidenceId' AS evidence_id,
    e.result->'evidence'->'provenance'->>'queryHash' AS query_hash,e.evidence_refs,
    CASE WHEN octet_length((e.result->'attack')::text)<=512000 THEN e.result->'attack' END AS attack,
    EXISTS(SELECT 1 FROM artifact_registry a WHERE a.case_id=e.case_id AND a.task_id=e.task_id
      AND a.sha256=e.result->>'sha256' AND a.storage_ref=e.result->>'rawArtifactRef') AS registered,
    EXISTS(SELECT 1 FROM runtime_result_receipts receipt WHERE receipt.task_id=e.task_id) AS receipted
    ${base} AND ${eligible} ORDER BY e.task_id COLLATE "C" LIMIT 32`,[caseId,SOC_EVIDENCE_POLICY_VERSION]);
  for(const row of rows.rows){const p=row.attack as EvidenceAttack|null;
    if(!p?.timeline||!row.registered||!row.receipted||p.timeline.taskId!==row.task_id||p.timeline.caseId!==caseId||
      p.timeline.artifactHash!==row.artifact_hash||p.timeline.evidenceId!==row.evidence_id||p.queryHash!==row.query_hash||
      !row.evidence_refs.includes(p.timeline.evidenceId))throw Object.assign(new Error('attack_projection_integrity_failed'),{statusCode:409});
  }
  try{return annotateCaseAttack(caseId,rows.rows.map(r=>r.attack),{completedQueryCount:count.total,
    unprojectedQueryCount:count.total-count.projected,omittedProjectionCount:count.projected-rows.rows.length},catalog,now);}
  catch{throw Object.assign(new Error('attack_projection_integrity_failed'),{statusCode:409});}
}
