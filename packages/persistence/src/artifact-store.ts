import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';

export interface StoredArtifact {
  ref: string;
  sha256: string;
  bytes: number;
}

export interface ArtifactRegistration extends StoredArtifact {
  caseId: string;
  taskId: string;
  storageProvider: 'filesystem' | 's3';
  mediaType: string;
  retentionUntil?: string;
}

export class PostgresArtifactRegistry {
  public constructor(private readonly pool: Pool) {}

  public async register(input: ArtifactRegistration): Promise<{ artifactId: string; created: boolean }> {
    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error('sha256 must be a SHA-256 hex digest');
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) throw new Error('bytes must be a non-negative integer');
    const inserted = await this.pool.query<{ artifact_id: string }>(`INSERT INTO artifact_registry
      (case_id,task_id,sha256,bytes,storage_provider,storage_ref,media_type,retention_until)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (case_id,task_id,sha256) DO NOTHING RETURNING artifact_id`,
      [input.caseId, input.taskId, input.sha256.toLowerCase(), input.bytes, input.storageProvider, input.ref,
        input.mediaType, input.retentionUntil ?? null]);
    if (inserted.rows[0]) return { artifactId: inserted.rows[0].artifact_id, created: true };
    const existing = await this.pool.query<{ artifact_id: string; bytes: string; storage_provider: string; storage_ref: string; media_type: string }>(
      `SELECT artifact_id,bytes::text,storage_provider,storage_ref,media_type FROM artifact_registry
       WHERE case_id=$1 AND task_id=$2 AND sha256=$3`, [input.caseId, input.taskId, input.sha256.toLowerCase()]);
    const row = existing.rows[0];
    if (!row || Number(row.bytes) !== input.bytes || row.storage_provider !== input.storageProvider ||
      row.storage_ref !== input.ref || row.media_type !== input.mediaType) throw new Error('artifact registration conflicts with immutable metadata');
    return { artifactId: row.artifact_id, created: false };
  }

  public async exists(caseId: string, taskId: string, sha256: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM artifact_registry WHERE case_id=$1 AND task_id=$2 AND sha256=$3',
      [caseId, taskId, sha256.toLowerCase()]);
    return Boolean(result.rows[0]);
  }
}

export class FilesystemArtifactStore {
  private readonly root: string;
  public constructor(root = process.env.GSS_DATA_DIR || resolve(tmpdir(), 'gss-data')) { this.root = resolve(root); }

  public async storeEvidence(caseId: string, taskId: string, content: string): Promise<StoredArtifact> {
    if (!/^[a-zA-Z0-9_-]+$/.test(caseId) || !/^[a-zA-Z0-9_-]+$/.test(taskId)) throw new Error('Unsafe artifact identifier');
    const bytes = Buffer.byteLength(content, 'utf8');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const directory = resolve(this.root, 'evidence', caseId);
    const file = resolve(directory, `${taskId}-${sha256.slice(0, 12)}.txt`);
    const allowedRoot = resolve(this.root, 'evidence') + sep;
    if (!file.startsWith(allowedRoot)) throw new Error('Artifact path escaped evidence root');
    await mkdir(directory, { recursive: true });
    try { await writeFile(file, content, { encoding: 'utf8', flag: 'wx' }); }
    catch (error: any) { if (error?.code !== 'EEXIST') throw error; }
    return { ref: `artifact://evidence/${caseId}/${taskId}-${sha256.slice(0, 12)}.txt`, sha256, bytes };
  }
}
