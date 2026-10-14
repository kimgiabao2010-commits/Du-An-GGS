import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {loadOfflineIntel} from '../../../services/control-plane/src/offline-intel.js';
it('loads only a bounded pinned private offline catalog; no traversal/hash/config fallback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gss-offline-intel-fixture-'));
  try{
    const dir=join(root,'offline-intel');await mkdir(dir);
    const file=join(dir,'fixture.json'),raw=JSON.stringify({schemaVersion:'gss.offline-intel-catalog.v1',catalogId:'FIXTURE-ONLY',version:'1',
      sourceUrl:'https://fixture.example/source',license:{identifier:'FIXTURE-ONLY',url:'https://fixture.example/license'},
      review:{owner:'fixture',reviewedAt:'2026-10-14T05:00:00Z',authorization:'APPROVED_FOR_OFFLINE_LOCAL_USE'},
      updatedAt:'2026-10-14T04:00:00Z',expiresAt:'2026-10-15T04:00:00Z',entries:[]});await writeFile(file,raw);
    const env={GSS_DATA_DIR:root,GSS_OFFLINE_INTEL_CATALOG_FILE:file,GSS_OFFLINE_INTEL_CATALOG_SHA256:createHash('sha256').update(raw).digest('hex')};
    expect((await loadOfflineIntel(env))?.catalogId).toBe('FIXTURE-ONLY');expect(await loadOfflineIntel({})).toBeUndefined();
    await expect(loadOfflineIntel({...env,GSS_OFFLINE_INTEL_CATALOG_SHA256:'0'.repeat(64)})).rejects.toThrow('pin');
    const outside=join(root,'outside.json');await writeFile(outside,raw);
    await expect(loadOfflineIntel({...env,GSS_OFFLINE_INTEL_CATALOG_FILE:outside})).rejects.toThrow('outside');
    await expect(loadOfflineIntel({...env,GSS_OFFLINE_INTEL_CATALOG_FILE:'https://fixture.example/catalog.json'})).rejects.toThrow();
    await expect(loadOfflineIntel({...env,GSS_OFFLINE_INTEL_CATALOG_FILE:'//network-share/catalog.json'})).rejects.toThrow();
    await expect(loadOfflineIntel({...env,GSS_OFFLINE_INTEL_CATALOG_SHA256:undefined})).rejects.toThrow();
    await writeFile(file,'x'.repeat(512_001));await expect(loadOfflineIntel(env)).rejects.toThrow('size');
  }finally{await rm(root,{recursive:true,force:true});}
});
