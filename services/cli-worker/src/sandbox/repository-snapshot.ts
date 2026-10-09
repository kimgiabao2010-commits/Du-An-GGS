import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

const extensions = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.md','.txt','.sql','.yaml','.yml','.css','.html','.py','.go','.rs','.java','.toml','.proto']);
const denied = /^(?:\.env(?:\..*)?|\.git|\.npmrc|\.pypirc|\.netrc|node_modules|data|worker-spool|dist|build|coverage|\.next.*|\.turbo|id_rsa|id_ed25519|credentials.*|secrets?.*)$/i;
/** Snapshot exposes only bounded source files, not the repository's private operational files. */
export async function createRepositorySnapshot(root: string): Promise<{ directory: string; dispose(): Promise<void> }> {
  const base = await realpath(resolve(root));
  const directory = await mkdtemp(join(tmpdir(),'gss-snapshot-'));
  const dispose = async () => {
    if (resolve(directory,'..') !== resolve(tmpdir()) || !basename(directory).startsWith('gss-snapshot-')) throw new Error('Unsafe snapshot cleanup');
    await rm(directory,{ recursive:true,force:true });
  };
  let files = 0, total = 0;
  try {
    await chmod(directory,0o755); // Sanitized snapshot must be readable by the container's mapped non-root UID.
    async function visit(source: string, target: string, depth: number): Promise<void> {
      if (depth > 12) throw new Error('Snapshot depth limit');
      for (const entry of await readdir(source,{ withFileTypes:true })) {
        if (denied.test(entry.name) || /(?:secret|credential|\.env)(?:[._-]|$)/i.test(entry.name)) continue;
        const input = join(source,entry.name), output = join(target,entry.name);
        const stat = await lstat(input);
        if (stat.isSymbolicLink()) throw new Error('Snapshot refuses symlinks');
        if (stat.isDirectory()) { await mkdir(output,{ mode:0o755 }); await visit(input,output,depth+1); }
        else if (stat.isFile() && extensions.has(extname(entry.name))) {
          if (++files>1000 || stat.size>256*1024) throw new Error('Snapshot resource limit');
          const handle = await open(input,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          try {
            if (!(await handle.stat()).isFile()) throw new Error('Snapshot input is not a regular file');
            const buffer=Buffer.alloc(256*1024+1);let bytes=0;
            while(bytes<buffer.length) { const next=await handle.read(buffer,bytes,buffer.length-bytes,null);if(!next.bytesRead)break;bytes+=next.bytesRead; }
            if(bytes>256*1024 || (total+=bytes)>8*1024*1024) throw new Error('Snapshot resource limit');
            await writeFile(output,buffer.subarray(0,bytes),{flag:'wx',mode:0o644});
          } finally { await handle.close(); }
        }
      }
    }
    await visit(base,directory,0);
    return { directory,dispose };
  } catch(e) { await dispose(); throw e; }
}
