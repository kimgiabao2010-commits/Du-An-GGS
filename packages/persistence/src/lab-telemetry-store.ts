import { Pool } from 'pg';
import { mkdir, lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { canonicalJson, labBatchHash, validateLabBatch, labQuery, LabTelemetryAdapter, labObservation, labReport,
  sha256Canonical, type LabBatch, type InvestigationRequest, type SocProfile } from '@asq/sdk';
import { PostgresInvestigationLoopStore, commitObservationAndDecisionWithClient } from './loop-store.js';

const error = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
export interface LabPolicy { profile: SocProfile; allowedSources: string[]; artifactRoot: string }
export function labPolicyFromEnvironment(): LabPolicy {
  return { profile: process.env.GSS_RUNTIME_ENV === 'staging' ? 'staging' : (process.env.GSS_SOC_PROFILE ?? 'staging') as SocProfile,
    allowedSources: process.env.GSS_LAB_OWN_DEVICE_AUTHORIZED === 'true'
      ? (process.env.GSS_LAB_ALLOWED_SOURCES ?? '').split(',').filter(id => /^[a-zA-Z0-9_-]{1,64}$/.test(id)) : [],
    artifactRoot: resolve(process.env.GSS_DATA_DIR ?? 'data', 'lab-artifacts') };
}
/** Only instantiated by Control Plane; workers/UI never receive PostgreSQL authority. */
export class PostgresLabTelemetryStore {
  constructor(private readonly pool: Pool, private readonly policy: LabPolicy) {}
  async report(caseId: string) {
    const row = (await this.pool.query(`SELECT q.payload,q.payload_hash,b.batch_hash,b.payload AS batch FROM lab_query_receipts q
      JOIN lab_telemetry_batches b ON b.batch_hash=q.batch_hash WHERE q.case_id=$1 AND b.expires_at>now()
      ORDER BY q.created_at DESC LIMIT 1`, [caseId])).rows[0];
    if (!row) throw error('lab_report_missing_or_expired', 404);
    this.allowed(validateLabBatch(row.batch));
    if (sha256Canonical(row.payload) !== row.payload_hash) throw error('lab_report_integrity_failed', 422);
    await this.verifyArtifact(row.batch_hash);
    return { report: row.payload.report, decision: row.payload.loop.decision, budget: row.payload.loop.run.budget };
  }
  private allowed(batch: LabBatch) {
    const expected = this.policy.profile === 'lab' ? 'LAB_LIVE' : this.policy.profile === 'replay' ? 'REPLAY' : null;
    if (!expected || batch.sourceKind !== expected || !this.policy.allowedSources.includes(batch.sourceId)) throw error('lab_source_not_authorized_for_profile', 403);
  }
  async importBatch(input: { batch: unknown; checksum: string; idempotencyKey: string }, actor: string) {
    const batch = validateLabBatch(input.batch); this.allowed(batch);
    const checksum = labBatchHash(batch);
    if (checksum !== input.checksum) throw error('lab_checksum_mismatch', 422);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.idempotencyKey) || !actor?.trim()) throw error('invalid_lab_import_identity', 422);
    const requestHash = sha256Canonical({ checksum, actor });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gss-lab-import-quota'))");
      const receipt = (await client.query('SELECT * FROM lab_import_receipts WHERE idempotency_key=$1', [input.idempotencyKey])).rows[0];
      if (receipt && receipt.request_hash !== requestHash) throw error('lab_idempotency_conflict', 409);
      const existing = (await client.query('SELECT artifact_ref,expires_at FROM lab_telemetry_batches WHERE batch_hash=$1', [checksum])).rows[0];
      if (existing) {
        await this.verifyArtifact(checksum);
        if (!receipt) await client.query('INSERT INTO lab_import_receipts VALUES($1,$2,$3,$4)', [input.idempotencyKey, requestHash, checksum, actor]);
        await client.query('COMMIT');
        return { batchHash: checksum, artifactRef: existing.artifact_ref, replay: true, expiresAt: new Date(existing.expires_at).toISOString() };
      }
      const content = canonicalJson(batch), bytes = Buffer.byteLength(content);
      const quota = (await client.query('SELECT count(*)::int AS n,COALESCE(sum(bytes),0)::bigint AS bytes FROM lab_telemetry_batches')).rows[0];
      if (quota.n >= 256 || Number(quota.bytes) + bytes > 128 * 1024 * 1024) throw error('lab_retention_quota_exhausted_manual_archive_required', 507);
      await this.storeArtifact(checksum, content);
      const artifactRef = `artifact://lab/${checksum}.json`;
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      await client.query(`INSERT INTO lab_telemetry_batches(batch_hash,source_id,source_kind,payload,bytes,imported_by,expires_at,artifact_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [checksum, batch.sourceId, batch.sourceKind, batch, bytes, actor, expiresAt, artifactRef]);
      await client.query('INSERT INTO lab_import_receipts VALUES($1,$2,$3,$4)', [input.idempotencyKey, requestHash, checksum, actor]);
      await client.query(`INSERT INTO audit_events(event_type,severity,actor_id,target_resource,action_payload)
        VALUES('LAB_TELEMETRY_IMPORTED','INFO',$1,$2,$3)`, [actor, checksum, { sourceId: batch.sourceId, sourceKind: batch.sourceKind, eventCount: batch.events.length }]);
      await client.query('COMMIT');
      return { batchHash: checksum, artifactRef, replay: false, expiresAt };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async investigate(batchHash: string, request: InvestigationRequest, actor: string) {
    labQuery(request);
    if (!/^[a-f0-9]{64}$/.test(batchHash) || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.idempotencyKey) ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(request.incidentId) || !actor?.trim()) throw error('invalid_lab_query_identity', 422);
    const hash = sha256Canonical({ batchHash, caseId: request.incidentId, query: labQuery(request), actor });
    // Request task ID is not authority. Stable identity derives from the authorized request.
    request = { ...request, taskId: 'LABTASK-' + hash.slice(0, 32), requestedBy: actor };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gss-lab-investigation'))");
      const authority = (await client.query('SELECT halted FROM control_runtime_state WHERE singleton=true FOR SHARE')).rows[0];
      if (!authority || authority.halted) throw error('control_halted', 503);
      const row = (await client.query('SELECT * FROM lab_telemetry_batches WHERE batch_hash=$1 AND expires_at>now()', [batchHash])).rows[0];
      if (!row) throw error('lab_batch_missing_or_expired', 404);
      this.allowed(validateLabBatch(row.payload));
      await this.verifyArtifact(batchHash);
      const replay = (await client.query('SELECT request_hash,payload,payload_hash FROM lab_query_receipts WHERE idempotency_key=$1', [request.idempotencyKey])).rows[0];
      if (replay) {
        if (replay.request_hash !== hash) throw error('lab_idempotency_conflict', 409);
        if (sha256Canonical(replay.payload) !== replay.payload_hash) throw error('lab_report_integrity_failed', 422);
        await client.query('COMMIT'); return { ...replay.payload, replay: true };
      }
      const owned = (await client.query('SELECT created_by,state FROM cases WHERE case_id=$1 FOR UPDATE', [request.incidentId])).rows[0];
      if (!owned || owned.created_by !== actor || owned.state === 'CLOSED') throw error('lab_case_owner_required', 403);
      const loops = new PostgresInvestigationLoopStore(this.pool);
      const run = await loops.ensureRun({ caseId: request.incidentId, requestedBy: actor, policyVersion: 'gss.lab-metadata-only.v1',
        budget: { maxDepth: 3, maxExternalQueries: 1, maxCostMicros: 1, deadlineAt: new Date(Date.now() + 600000).toISOString() } }, client);
      if (run.state !== 'ACTIVE') throw error('lab_run_terminal', 409);
      const adapter = new LabTelemetryAdapter(row.payload, batchHash, row.artifact_ref);
      const evidence = await adapter.investigate(request);
      const observation = labObservation(evidence);
      const loop = await commitObservationAndDecisionWithClient(client, { runId: run.runId, observation,
        source: `${row.source_kind}:${row.source_id}`, artifactHash: batchHash,
        proposal: { kind: 'BLOCKED', reasonCode: 'LAB_METADATA_ONLY', rationale: 'Telemetry metadata requires substantive SOC evidence; no benign/confirmed verdict or worker dispatch.' } });
      const report = labReport(evidence, loop.frontier);
      const payload = { evidence, observation, loop, report, replay: false, executionMode: 'CONTROL_INLINE_READONLY' };
      await client.query(`INSERT INTO lab_query_receipts(task_id,case_id,run_id,idempotency_key,request_hash,batch_hash,payload,payload_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [request.taskId, request.incidentId, run.runId, request.idempotencyKey, hash, batchHash, payload, sha256Canonical(payload)]);
      await client.query('COMMIT'); return payload;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  private async safeRoot() {
    const root = resolve(this.policy.artifactRoot);
    // Reject symbolic/reparse ancestors, not just the leaf artifact.
    for (let path = root; dirname(path) !== path; path = dirname(path)) {
      try { if ((await lstat(path)).isSymbolicLink()) throw error('lab_artifact_symlink_denied', 403); }
      catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    }
    await mkdir(root, { recursive: true });
    return root;
  }
  private async verifyArtifact(hash: string) {
    const file = resolve(await this.safeRoot(), hash + '.json');
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 512000) throw error('lab_artifact_integrity_failed', 422);
    const data = await readFile(file, 'utf8');
    if (sha256Canonical(validateLabBatch(JSON.parse(data))) !== hash) throw error('lab_artifact_integrity_failed', 422);
  }
  private async storeArtifact(hash: string, content: string) {
    const root = await this.safeRoot(), entries = await readdir(root, { withFileTypes: true });
    if (entries.length >= 256) throw error('lab_artifact_disk_quota_exhausted', 507);
    let used = 0;
    for (const entry of entries) {
      const stat = await lstat(resolve(root, entry.name));
      if (stat.isSymbolicLink() || !stat.isFile()) throw error('lab_artifact_directory_invalid', 403);
      used += stat.size;
    }
    if (used + Buffer.byteLength(content) > 128 * 1024 * 1024) throw error('lab_artifact_disk_quota_exhausted', 507);
    try { await writeFile(resolve(root, hash + '.json'), content, { flag: 'wx', mode: 0o600 }); }
    catch (e: any) { if (e.code !== 'EEXIST') throw e; await this.verifyArtifact(hash); }
  }
}
