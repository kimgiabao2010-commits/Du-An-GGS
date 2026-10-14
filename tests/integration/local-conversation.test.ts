import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { localConversation, localConversationConfig } from '../../services/standalone/src/agent/local-conversation.ts';
import { LlmRouter } from '../../services/standalone/src/agent/llm-router.ts';
import type { ModelCallGate } from '@asq/sdk';

let server:Server,port:number,requests:number,lastBody:Record<string,any>,mode:string;
const gate:ModelCallGate={reserve:async()=>({enabled:false}),start:async()=>({started:false})};
beforeEach(async()=>{
  requests=0;mode='ok';lastBody={};
  server=createServer((req,res)=>{
    requests++;const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
      lastBody=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(mode==='timeout')return;
      if(mode==='redirect'){res.writeHead(302,{location:'https://example.invalid/never-follow'});res.end();return;}
      if(mode==='quota'){res.writeHead(429);res.end();return;}
      if(mode==='oversize'){res.end('x'.repeat(70000));return;}
      if(mode==='json'){res.end('{broken');return;}
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({choices:[{finish_reason:mode==='length'?'length':'stop',message:{role:'assistant',
        content:'{"agent":"cli","action":"inspect_hostname"}',...(mode==='tools'?{tool_calls:[{type:'function'}]}:{})}}],
        usage:{prompt_tokens:20,completion_tokens:8}}));
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));port=(server.address() as {port:number}).port;
  vi.stubEnv('GSS_SOC_PROFILE','lab');vi.stubEnv('GSS_RUNTIME_ENV','local');
  vi.stubEnv('GSS_LOCAL_CONVERSATION_ENABLED','true');vi.stubEnv('GSS_LOCAL_CONVERSATION_MODEL','fixture-local-model');
  vi.stubEnv('GSS_LOCAL_MODEL_URL',`http://127.0.0.1:${port}/v1/chat/completions`);vi.stubEnv('GSS_LOCAL_MODEL_TIMEOUT_MS','1000');
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllEnvs();});
describe('experimental local conversation over real loopback HTTP; response fixtures, not model-quality evidence',()=>{
  it('uses bounded role-specific context and records only provider counts; tool-shaped prose cannot dispatch',async()=>{
    const decision=await new LlmRouter().routePrompt('Explain what an evidence gap means',gate);
    expect(decision.agent).toBe('chat');expect(decision.action).toBeUndefined();expect(decision.parameters).toBeUndefined();
    expect(decision.instruction).toContain('unverified');
    expect(decision.modelUsage).toMatchObject({inputTokens:20,outputTokens:8,cachedTokens:null,estimatedCostMicros:null,status:'SUCCEEDED',routeReason:'local_CONVERSATION_experimental_v1'});
    expect(lastBody.tools).toBeUndefined();expect(lastBody.messages[0].content).toContain('CONVERSATION');
    expect(lastBody).toMatchObject({stream:false,max_tokens:512});expect(requests).toBe(1);
  });
  it('requires durable invocation authority and honors refusal before network access',async()=>{
    expect((await localConversation('hello')).instruction).toContain('MODEL_BUDGET_BLOCKED');
    const denied:ModelCallGate={reserve:async()=>{throw new Error('blocked');},start:vi.fn()};
    expect((await localConversation('hello',denied)).instruction).toContain('MODEL_BUDGET_BLOCKED');expect(requests).toBe(0);
  });
  it('binds a reserved invocation to its acquisition and returns ledger identifiers',async()=>{
    const order:string[]=[];
    const durable:ModelCallGate={reserve:async input=>{order.push('reserve');expect(input.provider).toBe('llama.cpp');
      return {enabled:true,reservationId:'RES-local-fixture',state:'RESERVED',replay:false};},
      start:async()=>{order.push('start');return {started:true};}};
    const decision=await localConversation('hello',durable);expect(order).toEqual(['reserve','start']);
    expect(decision.modelUsage?.reservationId).toBe('RES-local-fixture');expect(decision.modelUsage?.invocationAttemptId).toMatch(/^[a-f0-9-]{36}$/);
  });
  it.each(['redirect','quota','oversize','json','length','tools'])('fails safely for %s without provider fallback',async failure=>{
    mode=failure;const decision=await localConversation('hello',gate);
    expect(decision.agent).toBe('system');expect(decision.action).toBeUndefined();expect(decision.modelUsage?.status).toBe('FAILED');expect(requests).toBe(1);
  });
  it('times out and bounds concurrency to one local model invocation',async()=>{
    mode='timeout';const running=localConversation('first',gate);
    await vi.waitFor(()=>expect(requests).toBe(1));
    expect((await localConversation('second',gate)).instruction).toContain('LOCAL_MODEL_BUSY');
    expect((await running).modelUsage?.status).toBe('FAILED');expect(requests).toBe(1);
  });
  it('rejects external hosts, alternate paths and staging before making a request',async()=>{
    for(const url of ['https://api.example.com/v1/chat/completions','http://localhost:8080/v1/chat/completions',
      'http://127.0.0.1:8080/admin','http://127.0.0.1:8080/v1/chat/completions?key=secret']) {
      expect(()=>localConversationConfig({...process.env,GSS_LOCAL_MODEL_URL:url})).toThrow();
    }
    vi.stubEnv('GSS_RUNTIME_ENV','staging');expect((await localConversation('hello',gate)).instruction).toContain('UNAVAILABLE');expect(requests).toBe(0);
  });
  it('keeps deterministic evidence intents independent of model availability',async()=>{
    expect((await new LlmRouter().routePrompt('hostname',gate)).agent).toBe('cli');
    expect((await new LlmRouter().routePrompt('investigate 203.0.113.1 in SIEM',gate)).agent).toBe('system');expect(requests).toBe(0);
  });
});
