import { describe,expect,it,vi } from 'vitest';
import { createServer } from 'node:http';
import { initializeTracing } from '../src/telemetry/runtime.ts';
import { withGssSpan } from '../src/telemetry/trace.ts';
describe('OTLP wire export to a local fixture receiver, not staging collector',()=>{
  it('exports correlated metadata without raw prompts/output',async()=>{
    const payloads: string[]=[];
    const receiver=createServer(async(req,res)=>{
      const buffers: Buffer[]=[]; for await(const chunk of req) buffers.push(Buffer.from(chunk));
      payloads.push(Buffer.concat(buffers).toString('utf8')); res.setHeader('content-type','application/json');res.end('{}');
    });
    await new Promise<void>(resolve=>receiver.listen(0,'127.0.0.1',resolve));
    const port=(receiver.address() as {port:number}).port;
    vi.stubEnv('GSS_TRACE_EXPORT','otlp'); vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',`http://127.0.0.1:${port}/v1/traces`);
    const provider=initializeTracing();
    try {
      await withGssSpan('gss.fixture',{ 'gss.task_id':'fixture-task', 'prompt':'fixture-secret-prompt', 'output':'fixture-secret-output' },async()=>{});
      await provider.forceFlush();
      expect(payloads.length).toBeGreaterThan(0); const body=payloads.join('');
      expect(body).toContain('fixture-task'); expect(body).not.toContain('fixture-secret');
      expect(body).toContain('traceId'); expect(body).toContain('spanId');
    } finally { await provider.shutdown(); await new Promise<void>(resolve=>receiver.close(()=>resolve()));vi.unstubAllEnvs(); }
  });
});
