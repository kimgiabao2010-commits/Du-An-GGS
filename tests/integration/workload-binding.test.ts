import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { createHash,X509Certificate,randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { WebSocket } from 'ws';
import { WsCommandServer } from '../../packages/sdk/src/transport/ws-server.ts';
import { TokenSigner } from '../../packages/sdk/src/security/token-signer.ts';
import { identifyWorkload,parseWorkloadPolicy,WorkloadPeerPolicy,type WorkloadPolicy } from '../../packages/sdk/src/security/workload-policy.ts';
import { ControlPlaneServer } from '../../services/control-plane/src/server.ts';
import { HttpControlPlaneClient } from '../../services/standalone/src/control-plane-client.ts';

describe('Pinned workload identity over real local mTLS (disposable PKI)',()=>{
  let directory:string,ca:Buffer,policy:WorkloadPolicy,wsServer:WsCommandServer,control:ControlPlaneServer;
  let wsPort:number,controlPort:number;
  const leaves:Record<string,{cert:Buffer;key:Buffer;pin:string}>={};
  const signer=new TokenSigner('workload-test-signing-secret-at-least-32');
  const serviceToken='workload-test-control-secret-at-least-32';
  const token=(agentId='cli-worker-agent',role='CLI_DAEMON')=>signer.sign({agentId,role,permissions:[],timestamp:Date.now(),expiresAt:Date.now()+60000});
  const save=()=>writeFile(join(directory,'policy.json'),JSON.stringify(policy));
  const options=(name:string)=>({ca,cert:leaves[name].cert,key:leaves[name].key,rejectUnauthorized:true,minVersion:'TLSv1.3' as const});
  const connect=(name:string,bearer=token())=>new Promise<WebSocket>((resolve,reject)=>{
    const socket=new WebSocket('wss://127.0.0.1:'+wsPort,{...options(name),headers:{authorization:'Bearer '+bearer},handshakeTimeout:3000});
    socket.once('open',()=>resolve(socket));socket.once('error',reject);
  });
  const get=(name:string,bearer=serviceToken)=>new Promise<number>((resolve,reject)=>{
    const req=request('https://127.0.0.1:'+controlPort+'/control/v1/workers',{
      ...options(name),headers:{authorization:'Bearer '+bearer},signal:AbortSignal.timeout(5000)},res=>{
        res.resume();res.once('end',()=>resolve(res.statusCode!));
      });req.once('error',reject);req.end();
  });
  const revoke=(name:string,workloadId:string)=>new Promise<number>((resolve,reject)=>{
    const req=request('https://127.0.0.1:'+controlPort+'/control/v1/workload-certificates/revocations',{
      ...options('ui'),method:'POST',headers:{authorization:'Bearer workload-test-gateway-secret-at-least-32',
        'content-type':'application/json','x-gss-session':token('certificate-admin','SECURITY_ADMIN')},
      signal:AbortSignal.timeout(5000)},res=>{res.resume();res.once('end',()=>resolve(res.statusCode!));});
    req.once('error',reject);req.end(JSON.stringify({schemaVersion:'gss.workload-revocation.v1',fingerprint:leaves[name].pin,
      workloadId,idempotencyKey:randomUUID(),reasonHash:createHash('sha256').update('disposable fixture revocation').digest('hex')}));
  });
  beforeAll(async()=>{
    if(process.env.DATABASE_URL && !new URL(process.env.DATABASE_URL).searchParams.get('options')?.includes('gss_suite_'))throw new Error('isolated PostgreSQL runner required');
    directory=await mkdtemp(join(tmpdir(),'gss-workload-test-'));
    const executable=process.platform==='win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
    const run=(args:string[])=>execFileSync(executable,args,{cwd:directory,stdio:'pipe',windowsHide:true,timeout:10000});
    run(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=GSS Disposable Workload CA']);
    const issue=async(name:string,san?:string,eku=true)=>{
      run(['req','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN=cli.gss.internal',
        ...(san?['-addext','subjectAltName='+san]:[]),...(eku?['-addext','extendedKeyUsage=clientAuth,serverAuth']:[])]);
      run(['x509','-req','-in',name+'.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out',name+'.pem','-days','1','-copy_extensions','copy']);
      const cert=await readFile(join(directory,name+'.pem'));
      leaves[name]={cert,key:await readFile(join(directory,name+'.key')),pin:createHash('sha256').update(new X509Certificate(cert).raw).digest('hex')};
    };
    await issue('server','DNS:localhost,IP:127.0.0.1');
    await issue('cli','DNS:cli.gss.internal');await issue('cli2','DNS:cli.gss.internal');
    await issue('ide','DNS:ide.gss.internal');await issue('command','DNS:command.gss.internal');await issue('ui','DNS:ui.gss.internal');
    await issue('siem','DNS:siem.gss.internal');
    await issue('rogue','DNS:rogue.gss.internal');await issue('cn');await issue('wildcard','DNS:*.gss.internal');
    await issue('multi','DNS:cli.gss.internal,DNS:ide.gss.internal');await issue('noeku','DNS:cli.gss.internal',false);
    ca=await readFile(join(directory,'ca.pem'));
    policy={schemaVersion:'gss.workload-policy.v1',workloads:[
      {workloadId:'cli-worker-agent',dnsName:'cli.gss.internal',pins:[leaves.cli.pin,leaves.cli2.pin]},
      {workloadId:'ide-worker-agent',dnsName:'ide.gss.internal',pins:[leaves.ide.pin]},
      {workloadId:'command-center',dnsName:'command.gss.internal',pins:[leaves.command.pin]},
      {workloadId:'ui-gateway',dnsName:'ui.gss.internal',pins:[leaves.ui.pin]},
      {workloadId:'siem-worker-agent',dnsName:'siem.gss.internal',pins:[leaves.siem.pin]}],revokedFingerprints:[]};
    await save();
    vi.stubEnv('GSS_RUNTIME_ENV','local');vi.stubEnv('GSS_TLS_CA_FILE',join(directory,'ca.pem'));
    vi.stubEnv('GSS_TLS_CERT_FILE',join(directory,'server.pem'));vi.stubEnv('GSS_TLS_KEY_FILE',join(directory,'server.key'));
    vi.stubEnv('GSS_TLS_WORKLOAD_POLICY_FILE',join(directory,'policy.json'));vi.stubEnv('GSS_CONTROL_PLANE_TOKEN',serviceToken);
    vi.stubEnv('GSS_OIDC_ISSUER','');
    wsServer=new WsCommandServer(0,{signer});wsPort=await wsServer.ready();
    if(process.env.DATABASE_URL){control=new ControlPlaneServer(0);controlPort=await control.ready();}
  },30000);
  afterAll(async()=>{
    await wsServer?.close();await control?.close();vi.unstubAllEnvs();
    if(directory){const path=resolve(directory);if(!path.startsWith(resolve(tmpdir())+sep) || !path.split(sep).at(-1)?.startsWith('gss-workload-test-'))throw new Error('Unsafe fixture cleanup');await rm(path,{recursive:true,force:true});}
  },20000);
  it('requires staging policy and rejects ambiguous pins, unbounded overlap and wildcard config',()=>{
    expect(()=>new WorkloadPeerPolicy('',true)).toThrow('staging_workload_policy_required');
    const clone=()=>JSON.parse(JSON.stringify(policy)) as WorkloadPolicy;
    const duplicated=clone();duplicated.workloads[1].pins=[leaves.cli.pin];expect(()=>parseWorkloadPolicy(duplicated)).toThrow('ambiguous');
    const overlap=clone();overlap.workloads[0].pins.push(leaves.rogue.pin);expect(()=>parseWorkloadPolicy(overlap)).toThrow('invalid');
    const wildcard=clone();wildcard.workloads[0].dnsName='*.gss.internal';expect(()=>parseWorkloadPolicy(wildcard)).toThrow('invalid');
  });
  it('derives fixed role from exact SAN and leaf hash, never CN, wildcard, ambiguous SAN or absent client EKU',()=>{
    expect(identifyWorkload(leaves.cli.cert,policy)).toMatchObject({workloadId:'cli-worker-agent',role:'CLI_DAEMON',fingerprint:leaves.cli.pin});
    for(const name of ['rogue','cn','wildcard','multi','noeku']) {
      const pinned=JSON.parse(JSON.stringify(policy)) as WorkloadPolicy;
      pinned.workloads[0].pins=[leaves[name].pin];
      expect(()=>identifyWorkload(leaves[name].cert,pinned)).toThrow();
    }
    expect(()=>identifyWorkload(leaves.cli.cert,policy,Date.parse(new X509Certificate(leaves.cli.cert).validTo)+1)).toThrow('not_usable');
    expect(()=>identifyWorkload(ca,policy)).toThrow('not_usable');
  });
  it('denies CA-trusted unknown leaf, swapped worker token and admin impersonation over WSS',async()=>{
    await expect(connect('rogue')).rejects.toThrow('403');
    await expect(connect('cli',token('ide-worker-agent','IDE_AGENT'))).rejects.toThrow('403');
    await expect(connect('cli',token('operator','SECURITY_ADMIN'))).rejects.toThrow('403');
    const socket=await connect('ide',token('ide-worker-agent','IDE_AGENT'));socket.terminate();
  });
  it.skipIf(!process.env.DATABASE_URL)('separates control service bearer from worker and UI gateway certificates over HTTPS + PostgreSQL',async()=>{
    expect(await get('command')).toBe(200);
    expect(await get('cli')).toBe(403);expect(await get('ui')).toBe(403);expect(await get('rogue')).toBe(403);
    expect(await get('command','wrong-bearer')).toBe(403);
  });
  it('supports two-pin overlap then withdraws old pin without restarting, including outbound dispatch',async()=>{
    const socket=await connect('cli');
    const closed=new Promise<number>(resolve=>socket.once('close',resolve));
    const pins=policy.workloads[0].pins;policy.workloads[0].pins=[leaves.cli2.pin];await save();
    expect(wsServer.sendToAgent('cli-worker-agent',{type:'COMMAND',payload:{}})).toBe(false);
    expect(await closed).toBe(1008);await expect(connect('cli')).rejects.toThrow('403');
    const replacement=await connect('cli2');replacement.terminate();policy.workloads[0].pins=pins;await save();
  });
  it('revokes idle connections and retains denylist across a fresh policy reader',async()=>{
    const socket=await connect('ide',token('ide-worker-agent','IDE_AGENT'));
    const closed=new Promise<number>(resolve=>socket.once('close',resolve));
    policy.revokedFingerprints=[leaves.ide.pin];await save();expect(await closed).toBe(1008);
    const reader=new WorkloadPeerPolicy(join(directory,'policy.json'));
    expect(()=>reader.authenticate({encrypted:true,authorized:true,getPeerCertificate:()=>({raw:new X509Certificate(leaves.ide.cert).raw})})).toThrow('revoked');
    policy.revokedFingerprints=[];await save();
  },6000);
  it('fails closed on policy corruption, missing file or unauthenticated transport',async()=>{
    const reader=new WorkloadPeerPolicy(join(directory,'policy.json'));
    expect(()=>reader.authenticate({encrypted:false})).toThrow('authorized_mtls');
    const existing=await connect('cli');const closed=new Promise<number>(resolve=>existing.once('close',resolve));
    await writeFile(join(directory,'policy.json'),'broken');
    expect(wsServer.sendToAgent('cli-worker-agent',{type:'COMMAND',payload:{}})).toBe(false);expect(await closed).toBe(1008);
    await expect(connect('cli')).rejects.toThrow('403');
    await rm(join(directory,'policy.json'));await expect(connect('cli')).rejects.toThrow('403');await save();
    const socket=await connect('cli');socket.terminate();
  });
  it('cannot disable required authority via a staging/local switch without an authorizer',()=>{
    vi.stubEnv('GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION','true');
    expect(()=>new WsCommandServer(0,{signer})).toThrow('Durable workload revocation authority required');
    vi.stubEnv('GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION','false');
    vi.stubEnv('GSS_RUNTIME_ENV','staging');
    expect(()=>new WsCommandServer(0,{signer})).toThrow('Durable workload revocation authority required');
    vi.stubEnv('GSS_RUNTIME_ENV','local');
  });
  it.skipIf(!process.env.DATABASE_URL)('enforces PostgreSQL revocation on actual WSS dispatch, inbound frame, idle lease and restart despite pin-file rollback',async()=>{
    await wsServer.close();
    const authority=new HttpControlPlaneClient('https://127.0.0.1:'+controlPort,serviceToken);
    vi.stubEnv('ASQ_LOCAL_RUNTIME','true');vi.stubEnv('GSS_UI_GATEWAY_TOKEN','workload-test-gateway-secret-at-least-32');
    vi.stubEnv('ASQ_JWT_SECRET','workload-test-signing-secret-at-least-32');vi.stubEnv('GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION','true');
    const start=async()=>{
      vi.stubEnv('GSS_TLS_CERT_FILE',join(directory,'server.pem'));vi.stubEnv('GSS_TLS_KEY_FILE',join(directory,'server.key'));
      wsServer=new WsCommandServer(0,{signer,peerAuthorizer:peer=>authority.checkWorkload(peer)});wsPort=await wsServer.ready();
      // Same process simulates CC's separate outbound key; server contexts were loaded above.
      vi.stubEnv('GSS_TLS_CERT_FILE',join(directory,'command.pem'));vi.stubEnv('GSS_TLS_KEY_FILE',join(directory,'command.key'));
    };
    await start();
    const socket=await connect('cli');
    expect(wsServer.sendToAgent('cli-worker-agent',{type:'TASK',payload:{}})).toBe(false);
    const delivered=new Promise<string>(resolve=>socket.once('message',data=>resolve(data.toString())));
    expect(await wsServer.sendToAgentAuthorized('cli-worker-agent',{type:'STATUS',payload:{fixture:true}})).toBe(true);
    expect(JSON.parse(await delivered).payload.fixture).toBe(true);
    expect(await revoke('cli','cli-worker-agent')).toBe(201);
    const closed=new Promise<number>(resolve=>socket.once('close',resolve));
    policy.revokedFingerprints=[];await save(); // Old allow file cannot undo DB tombstone.
    expect(await wsServer.sendToAgentAuthorized('cli-worker-agent',{type:'TASK',payload:{}})).toBe(false);
    expect(await closed).toBe(1008);await expect(connect('cli')).rejects.toThrow('403');
    const ide=await connect('ide',token('ide-worker-agent','IDE_AGENT'));
    const rejectedFrame=vi.fn();wsServer.on('message',rejectedFrame);
    const ideClosed=new Promise<number>(resolve=>ide.once('close',resolve));
    expect(await revoke('ide','ide-worker-agent')).toBe(201);
    ide.send(JSON.stringify({type:'STATUS',message_id:randomUUID(),incident_id:'fixture-case',timestamp:Date.now(),payload:{}}));
    expect(await ideClosed).toBe(1008);expect(rejectedFrame).not.toHaveBeenCalled();
    wsServer.off('message',rejectedFrame);
    const idle=await connect('siem',token('siem-worker-agent','SIEM'));
    const idleClosed=new Promise<number>(resolve=>idle.once('close',resolve));
    expect(await revoke('siem','siem-worker-agent')).toBe(201);expect(await idleClosed).toBe(1008);
    await wsServer.close();await start();await expect(connect('cli')).rejects.toThrow('403');
    const replacement=await connect('cli2');replacement.terminate();
    // CP also enforces its own peer's tombstone before any authority/health route.
    expect(await revoke('ui','ui-gateway')).toBe(201);expect(await get('ui')).toBe(403);
  },20000);
  it.skipIf(!process.env.DATABASE_URL)('denies authority outage instead of silently using file-only trust',async()=>{
    await wsServer.close();
    const stoppedAuthority=new HttpControlPlaneClient('https://127.0.0.1:'+controlPort,serviceToken);
    await control.close();
    vi.stubEnv('GSS_TLS_CERT_FILE',join(directory,'server.pem'));vi.stubEnv('GSS_TLS_KEY_FILE',join(directory,'server.key'));
    wsServer=new WsCommandServer(0,{signer,peerAuthorizer:peer=>stoppedAuthority.checkWorkload(peer)});
    wsPort=await wsServer.ready();
    vi.stubEnv('GSS_TLS_CERT_FILE',join(directory,'command.pem'));vi.stubEnv('GSS_TLS_KEY_FILE',join(directory,'command.key'));
    await expect(connect('cli2')).rejects.toThrow('403');
    vi.stubEnv('GSS_TLS_CERT_FILE',join(directory,'server.pem'));vi.stubEnv('GSS_TLS_KEY_FILE',join(directory,'server.key'));
    control=new ControlPlaneServer(0);controlPort=await control.ready();
  });
  it.skipIf(!process.env.DATABASE_URL)('bounds a hung authority and prevents unbounded inbound authorization backlog',async()=>{
    await wsServer.close();vi.stubEnv('GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION','false');
    let hung=false;
    wsServer=new WsCommandServer(0,{signer,peerAuthorizer:async()=>{if(hung)await new Promise<void>(()=>{});}});
    wsPort=await wsServer.ready();const socket=await connect('cli2');
    const closed=new Promise<number>(resolve=>socket.once('close',resolve));hung=true;
    for(let i=0;i<9;i++)socket.send(JSON.stringify({type:'STATUS',message_id:randomUUID(),incident_id:'fixture-case',timestamp:Date.now(),payload:{}}));
    expect(await closed).toBe(1008);
    // A fresh upgrade cannot hang indefinitely either (native client timeout also bounded).
    await expect(connect('cli2')).rejects.toThrow();
  },10000);
});
