import { afterEach,describe,expect,it } from 'vitest';
import { mkdtemp,mkdir,readFile,readdir,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createRepositorySnapshot } from '../../services/cli-worker/src/sandbox/repository-snapshot.ts';
const roots: string[]=[];
afterEach(async () => { for(const root of roots.splice(0)) {
  if(resolve(root,'..')!==resolve(tmpdir())) throw new Error('Unsafe test cleanup'); await rm(root,{recursive:true,force:true});
} });
describe('bounded repository snapshot, not a Docker escape test', () => {
  it('exposes source without private operational files and preserves host contents', async () => {
    const root=await mkdtemp(join(tmpdir(),'gss-snapshot-fixture-')); roots.push(root);
    await writeFile(join(root,'safe.ts'),'export const fixture = true;'); await writeFile(join(root,'.env'),'fixture secret');
    await writeFile(join(root,'signing.key'),'fixture key'); await mkdir(join(root,'data')); await writeFile(join(root,'data','output.txt'),'private fixture');
    const snapshot=await createRepositorySnapshot(root);
    try {
      expect(await readdir(snapshot.directory)).toEqual(['safe.ts']);
      expect(await readFile(join(snapshot.directory,'safe.ts'),'utf8')).toBe('export const fixture = true;');
      expect(await readFile(join(root,'.env'),'utf8')).toBe('fixture secret');
    } finally { await snapshot.dispose(); }
  });
  it('rejects resource overflow without claiming an execution artifact', async () => {
    const root=await mkdtemp(join(tmpdir(),'gss-snapshot-fixture-')); roots.push(root);
    await writeFile(join(root,'large.ts'),'x'.repeat(300000));
    await expect(createRepositorySnapshot(root)).rejects.toThrow('Snapshot resource limit');
  });
});
