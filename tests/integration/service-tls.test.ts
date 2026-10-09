import { afterEach,describe,expect,it,vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer,request } from 'node:https';
import { serviceFetch,serviceTlsOptions,validateServiceUrl } from '../../packages/sdk/src/security/service-tls.ts';

afterEach(()=>vi.unstubAllEnvs());
describe('Service TLS boundary',()=>{
  it('rejects plaintext remote transport, staging downgrade and disabled certificate verification',()=>{
    expect(()=>validateServiceUrl('http://remote.example')).toThrow('requires TLS');
    expect(()=>validateServiceUrl('ws://remote.example',true)).toThrow('requires TLS');
    expect(()=>validateServiceUrl('http://127.0.0.1')).not.toThrow();
    vi.stubEnv('GSS_RUNTIME_ENV','staging');
    expect(()=>validateServiceUrl('http://127.0.0.1')).toThrow('requires TLS');
    expect(()=>serviceTlsOptions()).toThrow('Staging requires');
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED','0');
    expect(()=>validateServiceUrl('https://localhost')).toThrow('Disabled TLS');
  });
  it('performs a real mTLS handshake and rejects a missing client certificate',async()=>{
    const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe')
      ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    const directory=await mkdtemp(join(tmpdir(),'gss-tls-test-'));
    const run=(args:string[])=>execFileSync(openssl,args,{cwd:directory,windowsHide:true,stdio:'pipe',timeout:15000});
    let server:ReturnType<typeof createServer>|undefined;
    try {
      run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=GSS Test CA']);
      run(['req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost',
        '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1']);
      run(['x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','server.pem','-days','1','-copy_extensions','copy']);
      run(['req','-newkey','rsa:2048','-nodes','-keyout','client.key','-out','client.csr','-subj','/CN=gss-fixture-client']);
      run(['x509','-req','-in','client.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','client.pem','-days','1']);
      const ca=await readFile(join(directory,'ca.pem'));
      server=createServer({ca,key:await readFile(join(directory,'server.key')),cert:await readFile(join(directory,'server.pem')),
        minVersion:'TLSv1.3',requestCert:true,rejectUnauthorized:true},(_request,response)=>response.end(JSON.stringify({ok:true})));
      await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
      const address=server.address();if (!address || typeof address==='string') throw new Error('No TLS port');
      const url='https://127.0.0.1:'+address.port;
      vi.stubEnv('GSS_TLS_CA_FILE',join(directory,'ca.pem'));vi.stubEnv('GSS_TLS_CERT_FILE',join(directory,'client.pem'));
      vi.stubEnv('GSS_TLS_KEY_FILE',join(directory,'client.key'));
      expect(await (await serviceFetch(url)).json()).toEqual({ok:true});
      await expect(new Promise((resolve,reject)=>{
        const req=request(url,{ca,rejectUnauthorized:true,minVersion:'TLSv1.3',signal:AbortSignal.timeout(3000)},resolve);
        req.on('error',reject);req.end();
      })).rejects.toThrow();
      await expect(serviceFetch(url.replace('127.0.0.1','127.0.0.2'))).rejects.toThrow();
    } finally {
      if (server) await new Promise<void>(resolve=>server!.close(()=>resolve()));
      const path=resolve(directory),allowed=resolve(tmpdir())+sep;
      if (!path.startsWith(allowed) || !path.split(sep).at(-1)?.startsWith('gss-tls-test-')) throw new Error('Unsafe TLS fixture cleanup');
      await rm(path,{recursive:true,force:true});
    }
  },20000);
});
