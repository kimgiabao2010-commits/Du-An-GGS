import type { Pool, PoolClient } from 'pg';
import { buildCaseTimeline, SOC_EVIDENCE_POLICY_VERSION, type EvidenceTimeline } from '@asq/sdk';

/** Read-only snapshot. No backfill: older caller-authored projections remain unavailable. */
export async function readCaseTimeline(pool: Pool, caseId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(caseId)) throw Object.assign(new Error('invalid_case_id'), { statusCode: 422 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const snapshot = await readCaseTimelineWithClient(client, caseId);
    await client.query('COMMIT');
    return snapshot;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function readCaseTimelineWithClient(client: PoolClient, caseId: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(caseId)) throw Object.assign(new Error('invalid_case_id'), { statusCode: 422 });
    if (!(await client.query('SELECT 1 FROM cases WHERE case_id=$1', [caseId])).rowCount) {
      throw Object.assign(new Error('case_not_found'), { statusCode: 404 });
    }
    const base = `FROM runtime_executions e JOIN runtime_tasks t ON t.task_id=e.task_id AND t.case_id=e.case_id
      LEFT JOIN investigation_runs r ON r.run_id=t.run_id AND r.case_id=e.case_id
      WHERE e.case_id=$1 AND e.status='COMPLETED' AND e.executor='siem' AND t.target='siem' AND t.action='search_siem'`;
    const eligible = "r.policy_version=$2 AND jsonb_typeof(e.result->'timeline')='object'";
    const count = (await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE ${eligible})::int AS projected ${base}`, [caseId, SOC_EVIDENCE_POLICY_VERSION])).rows[0];
    const result = await client.query(`SELECT e.task_id, e.result->>'sha256' AS artifact_hash,
      e.result->'evidence'->>'evidenceId' AS evidence_id, e.evidence_refs,
      CASE WHEN octet_length((e.result->'timeline')::text)<=512000 THEN e.result->'timeline' END AS timeline,
      EXISTS(SELECT 1 FROM artifact_registry a WHERE a.case_id=e.case_id AND a.task_id=e.task_id
        AND a.sha256=e.result->>'sha256' AND a.storage_ref=e.result->>'rawArtifactRef') AS registered,
      EXISTS(SELECT 1 FROM runtime_result_receipts receipt WHERE receipt.task_id=e.task_id) AS receipted
      ${base} AND ${eligible} ORDER BY e.task_id COLLATE "C" LIMIT 32`, [caseId, SOC_EVIDENCE_POLICY_VERSION]);
    for (const row of result.rows) {
      const t = row.timeline as EvidenceTimeline | null;
      if (!t || !row.registered || !row.receipted || t.taskId !== row.task_id || t.caseId !== caseId ||
        t.artifactHash !== row.artifact_hash || t.evidenceId !== row.evidence_id || !row.evidence_refs.includes(t.evidenceId)) {
        throw Object.assign(new Error('timeline_integrity_failed'), { statusCode: 409 });
      }
    }
    let snapshot;
    try { snapshot = buildCaseTimeline(caseId, result.rows.map(row => row.timeline), {
      completedQueryCount: count.total, unprojectedQueryCount: count.total - count.projected,
      omittedProjectionCount: count.projected - result.rows.length }); }
    catch { throw Object.assign(new Error('timeline_integrity_failed'), { statusCode: 409 }); }
    return snapshot;
}
