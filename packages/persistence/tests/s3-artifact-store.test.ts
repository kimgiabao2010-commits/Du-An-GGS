import { describe,expect,it,vi } from 'vitest';
import { S3ArtifactStore } from '../src/s3-artifact-store.ts';
import { createHash } from 'node:crypto';
describe('S3 adapter contracts (provider mocked, not live Object Lock)', () => {
  it('writes full SHA-256 key, conditional put and compliance retention', async () => {
    const send=vi.fn().mockResolvedValue({});
    const store=new S3ArtifactStore({ bucket:'fixture-bucket',region:'test',retentionDays:30 },{ send } as any);
    const artifact=await store.storeEvidence('case','task','fixture');
    const input=send.mock.calls[0][0].input;
    expect(artifact.ref).toBe('s3://fixture-bucket/evidence/case/task/'+artifact.sha256);
    expect(input.IfNoneMatch).toBe('*'); expect(input.ObjectLockMode).toBe('COMPLIANCE');
    expect(input.ChecksumAlgorithm).toBe('SHA256'); expect(input.Body.toString()).toBe('fixture');
  });
  it('verifies content and retention on replay and fails closed on content mismatch', async () => {
    const hash=createHash('sha256').update('fixture').digest('hex');
    const send=vi.fn().mockRejectedValueOnce({ $metadata:{ httpStatusCode:412 } })
      .mockResolvedValueOnce({ ContentLength:7,Metadata:{sha256:hash},ObjectLockMode:'COMPLIANCE',ObjectLockRetainUntilDate:new Date(Date.now()+60000) })
      .mockResolvedValueOnce({ Body:(async function*(){ yield Buffer.from('changed'); })() });
    const store=new S3ArtifactStore({ bucket:'fixture-bucket',region:'test',retentionDays:30 },{send} as any);
    await expect(store.storeEvidence('case','task','fixture')).rejects.toThrow('content hash mismatch');
  });
  it('does not downgrade rejected retention or credentials into local success', async () => {
    const send=vi.fn().mockRejectedValue({ $metadata:{ httpStatusCode:403 } });
    const store=new S3ArtifactStore({ bucket:'fixture-bucket',region:'test',retentionDays:30 },{send} as any);
    await expect(store.storeEvidence('case','task','fixture')).rejects.toThrow('no evidence accepted');
  });
  it('rejects traversal identifiers and insecure remote endpoints', async () => {
    const store=new S3ArtifactStore({ bucket:'fixture-bucket',region:'test',retentionDays:30 },{send:vi.fn()} as any);
    await expect(store.storeEvidence('../case','task','fixture')).rejects.toThrow('Unsafe artifact');
    expect(()=>new S3ArtifactStore({bucket:'fixture-bucket',region:'test',retentionDays:30,endpoint:'http://remote.example'})).toThrow('requires HTTPS');
  });
  it('bounds stalled body reads after GET headers and aborts the transport', async () => {
    const hash=createHash('sha256').update('fixture').digest('hex');
    const destroy=vi.fn();
    const stalled={ [Symbol.asyncIterator]: () => ({ next: () => new Promise(()=>{}) }), destroy };
    const send=vi.fn().mockRejectedValueOnce({ $metadata:{ httpStatusCode:412 } })
      .mockResolvedValueOnce({ ContentLength:7,Metadata:{sha256:hash},ObjectLockMode:'COMPLIANCE',ObjectLockRetainUntilDate:new Date(Date.now()+60000) })
      .mockResolvedValueOnce({ Body:stalled });
    const store=new S3ArtifactStore({bucket:'fixture-bucket',region:'test',retentionDays:30,timeoutMs:25},{send} as any);
    await expect(store.storeEvidence('case','task','fixture')).rejects.toThrow('deadline exceeded');
    expect(destroy).toHaveBeenCalled();
    expect(send.mock.calls[2][1].abortSignal.aborted).toBe(true);
  });
  it('bounds a stalled transport even if it ignores cancellation', async () => {
    const send=vi.fn().mockImplementation(()=>new Promise(()=>{}));
    const store=new S3ArtifactStore({bucket:'fixture-bucket',region:'test',retentionDays:30,timeoutMs:25},{send} as any);
    await expect(store.storeEvidence('case','task','fixture')).rejects.toThrow('deadline exceeded');
    expect(send.mock.calls[0][1].abortSignal.aborted).toBe(true);
  });
});
