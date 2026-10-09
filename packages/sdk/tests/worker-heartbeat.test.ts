import { afterEach,describe,expect,it,vi } from 'vitest';
import { ASQWebSocketClient } from '../src/transport/ws-client.js';
import { WsCommandServer } from '../src/transport/ws-server.js';
import { TokenSigner } from '../src/security/token-signer.js';

let server:WsCommandServer,client:ASQWebSocketClient;
afterEach(async()=>{client?.disconnect();await server?.close();vi.unstubAllEnvs();});
describe('worker heartbeat retry budget (local transport fixture, not staging)',()=>{
  it('does not reset retry budget merely because an unregistered TCP session opened',async()=>{
    vi.stubEnv('GSS_REQUIRE_WORKER_PRESENCE','true');
    const signer=new TokenSigner('heartbeat-test-secret-at-least-32characters');
    server=new WsCommandServer(0,{signer});let connections=0;let exhausted=false;
    server.on('worker:connected',()=>connections++);
    server.on('message',msg=>{if(msg.type==='HEARTBEAT') server.sendToConnection(msg.connectionId,
      {source:'STANDALONE',type:'HEARTBEAT_ACK',payload:{...msg.payload,committed:false}});});
    const now=Date.now();const token=signer.sign({agentId:'ide-worker-agent',role:'IDE_AGENT',permissions:['REPORT'],timestamp:now,expiresAt:now+60000});
    client=new ASQWebSocketClient('ws://127.0.0.1:'+await server.ready(),token,1,{workerId:'ide-worker-agent'});
    client.subscribe('system:error',error=>{if(error.error==='Max reconnect attempts reached') exhausted=true;});
    client.connect();await vi.waitFor(()=>expect(exhausted).toBe(true),{timeout:5000});
    expect(connections).toBe(2);
  });
});
