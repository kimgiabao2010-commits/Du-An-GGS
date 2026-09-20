import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

export interface StoredArtifact {
  ref: string;
  sha256: string;
  bytes: number;
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
