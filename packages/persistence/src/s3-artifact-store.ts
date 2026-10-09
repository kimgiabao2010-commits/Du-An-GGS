import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { FilesystemArtifactStore, type ArtifactStore, type StoredArtifact } from './artifact-store.js';

export interface S3ArtifactOptions { bucket: string; region: string; endpoint?: string; retentionDays: number; timeoutMs?: number }
type S3Transport = Pick<S3Client, 'send'>;
export class S3ArtifactStore implements ArtifactStore {
  private client: S3Transport;
  constructor(private readonly options: S3ArtifactOptions, client?: S3Transport) {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket) || !options.region ||
      !Number.isSafeInteger(options.retentionDays) || options.retentionDays < 1 || options.retentionDays > 3650 ||
      !Number.isSafeInteger(options.timeoutMs ?? 30000) || (options.timeoutMs ?? 30000) < 1 || (options.timeoutMs ?? 30000) > 60000) {
      throw new Error('Invalid S3 artifact configuration');
    }
    if (options.endpoint) {
      const url = new URL(options.endpoint);
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) {
        throw new Error('S3 endpoint requires HTTPS or explicit loopback HTTP');
      }
    }
    this.client = client ?? new S3Client({ region: options.region, endpoint: options.endpoint,
      forcePathStyle: Boolean(options.endpoint), maxAttempts: 3 });
  }
  async storeEvidence(caseId: string, taskId: string, content: string): Promise<StoredArtifact> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('S3 artifact deadline exceeded; no evidence accepted'));
      }, this.options.timeoutMs ?? 30000);
    });
    try { return await Promise.race([this.storeBounded(caseId, taskId, content, controller.signal), deadline]); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  private async storeBounded(caseId: string, taskId: string, content: string, signal: AbortSignal): Promise<StoredArtifact> {
    if (![caseId, taskId].every(v => /^[a-zA-Z0-9_-]{1,256}$/.test(v))) throw new Error('Unsafe artifact identifier');
    const body = Buffer.from(content, 'utf8');
    if (body.length > 1_000_000) throw new Error('Artifact exceeds bounded size');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const Key = `evidence/${caseId}/${taskId}/${sha256}`;
    const Bucket = this.options.bucket;
    // Object Lock providers commonly persist second precision; keep replay metadata identical.
    let retentionUntil = new Date(Math.floor((Date.now() + this.options.retentionDays * 86400000)/1000)*1000).toISOString();
    try {
      await this.client.send(new PutObjectCommand({ Bucket, Key, Body: body, ContentLength: body.length,
        ContentType: 'text/plain; charset=utf-8', ChecksumAlgorithm: 'SHA256', ChecksumSHA256: Buffer.from(sha256,'hex').toString('base64'),
        Metadata: { sha256 }, IfNoneMatch: '*', ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: new Date(retentionUntil),
      }), { abortSignal: signal });
    } catch (error) {
      signal.throwIfAborted();
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw new Error('S3 artifact write failed; no evidence accepted');
      const head = await this.client.send(new HeadObjectCommand({ Bucket, Key }), { abortSignal: signal });
      signal.throwIfAborted();
      if (head.ContentLength !== body.length || head.Metadata?.sha256 !== sha256 || head.ObjectLockMode !== 'COMPLIANCE' ||
        !head.ObjectLockRetainUntilDate || head.ObjectLockRetainUntilDate.getTime() <= Date.now()) throw new Error('Existing S3 artifact retention/integrity failed');
      retentionUntil = head.ObjectLockRetainUntilDate.toISOString();
      const object = await this.client.send(new GetObjectCommand({ Bucket, Key }), { abortSignal: signal });
      signal.throwIfAborted();
      if (!object.Body) throw new Error('Existing S3 artifact missing');
      // Size was checked by HEAD; stream remains bounded even if a provider violates that metadata.
      const chunks: Buffer[] = []; let total = 0;
      const stream = object.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
      const stop = () => stream.destroy?.();
      signal.addEventListener('abort', stop, { once: true });
      try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          total += chunk.length; if (total > body.length) throw new Error('Existing S3 artifact exceeds expected size');
          chunks.push(Buffer.from(chunk));
        }
        signal.throwIfAborted();
      } finally {
        signal.removeEventListener('abort', stop);
        stop();
      }
      if (createHash('sha256').update(Buffer.concat(chunks)).digest('hex') !== sha256) throw new Error('Existing S3 artifact content hash mismatch');
    }
    return { ref: `s3://${Bucket}/${Key}`, sha256, bytes: body.length, storageProvider: 's3', retentionUntil };
  }
}
export function artifactStoreFromEnvironment(): ArtifactStore {
  if (process.env.GSS_ARTIFACT_STORE === 's3') return new S3ArtifactStore({ bucket: process.env.GSS_S3_BUCKET ?? '',
    region: process.env.GSS_S3_REGION ?? '', endpoint: process.env.GSS_S3_ENDPOINT, retentionDays: Number(process.env.GSS_S3_RETENTION_DAYS ?? 30) });
  if (process.env.GSS_RUNTIME_ENV === 'staging') throw new Error('Staging requires S3 with verified retention');
  return new FilesystemArtifactStore();
}
