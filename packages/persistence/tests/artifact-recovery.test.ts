import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {backupApprovedArtifacts,restoreApprovedArtifacts,type RecoverableArtifact} from '../src/artifact-recovery.js';
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
describe('explicit approved artifact recovery, no broad directory restore/overwrite',()=>{
  it('copies content-addressed evidence into fresh backup/restore roots and leaves originals intact',async()=>{
    const root=await mkdtemp(join(tmpdir(),'gss-artifact-recovery-fixture-'));
    try{
      const text='Private contract fixture, not operational evidence',sha256=hash(text),name='task-'+sha256.slice(0,12)+'.txt';
      await mkdir(join(root,'source','evidence','case'),{recursive:true});await writeFile(join(root,'source','evidence','case',name),text);
      const entry:RecoverableArtifact={ref:'artifact://evidence/case/'+name,sha256,bytes:Buffer.byteLength(text),hashMode:'SHA256_BYTES'};
      const backup=await backupApprovedArtifacts(join(root,'source'),join(root,'backup'),[entry]);
      const a=await restoreApprovedArtifacts(backup.directory,join(root,'restored'),backup.manifestHash);
      const b=await restoreApprovedArtifacts(backup.directory,join(root,'restored'),backup.manifestHash);
      expect(a.root).not.toBe(b.root);expect(a).toMatchObject({restoredCount:1,originalOverwritten:false,totalBytes:entry.bytes});
      expect(await readFile(join(a.root,'evidence','case',name),'utf8')).toBe(text);
      expect(await readFile(join(root,'source','evidence','case',name),'utf8')).toBe(text);
      await writeFile(join(backup.directory,'blobs',sha256+'.bin'),'tampered');
      await expect(restoreApprovedArtifacts(backup.directory,join(root,'restored'),backup.manifestHash)).rejects.toThrow();
      await expect(restoreApprovedArtifacts(backup.directory,join(root,'restored'),'0'.repeat(64))).rejects.toThrow('identity');
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('rejects missing/hash-mismatched, traversal, remote, duplicate and symlink sources before claiming recovery',async()=>{
    const root=await mkdtemp(join(tmpdir(),'gss-artifact-negative-fixture-'));
    try{
      const sha256=hash('expected'),e:RecoverableArtifact={ref:'artifact://evidence/case/task-'+sha256.slice(0,12)+'.txt',sha256,bytes:8,hashMode:'SHA256_BYTES'};
      for(const ref of ['artifact://evidence/../secret.txt','s3://bucket/object','artifact://lab/'+sha256+'.json'])
        await expect(backupApprovedArtifacts(root,join(root,'backup'),[{...e,ref}])).rejects.toThrow();
      await expect(backupApprovedArtifacts(root,join(root,'backup'),[e,e])).rejects.toThrow('unique');
      await expect(backupApprovedArtifacts(root,join(root,'backup'),[e])).rejects.toThrow();
      await mkdir(join(root,'evidence','case'),{recursive:true});await writeFile(join(root,'evidence','case','task-'+sha256.slice(0,12)+'.txt'),'wrong!!!');
      await expect(backupApprovedArtifacts(root,join(root,'backup'),[e])).rejects.toThrow('hash');
      const linked=join(root,'linked');await symlink(join(root,'evidence'),linked,'junction');
      await expect(backupApprovedArtifacts(root,join(linked,'backup'),[e])).rejects.toThrow('symlink');
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
