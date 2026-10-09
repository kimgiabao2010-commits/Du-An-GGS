import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, SimpleSpanProcessor, BatchSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

/** Runtime retains no evidence or span buffer. Export is opt-in. */
let initialized: BasicTracerProvider | undefined;
export function initializeTracing(exporter?: SpanExporter): BasicTracerProvider {
  if (initialized) return initialized;
  const safeConsole: SpanExporter = {
    export(spans, callback) {
      if (process.env.GSS_TRACE_EXPORT === 'console') {
        for (const span of spans) console.log(JSON.stringify({ type: 'gss.trace.v1', name: span.name,
          traceId: span.spanContext().traceId, spanId: span.spanContext().spanId,
          parentSpanId: span.parentSpanContext?.spanId, attributes: span.attributes, status: span.status.code }));
      }
      callback({ code: 0 });
    },
    shutdown: async () => {},
  };
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  let selected: SpanExporter = exporter ?? safeConsole;
  if (!exporter && process.env.GSS_TRACE_EXPORT === 'otlp') {
    if (!endpoint) throw new Error('OTLP trace endpoint is required');
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) {
      throw new Error('OTLP requires HTTPS or explicit loopback HTTP');
    }
    selected = new OTLPTraceExporter({ url: endpoint, timeoutMillis: 5000 });
  }
  const processor = selected instanceof OTLPTraceExporter ? new BatchSpanProcessor(selected, {
    maxQueueSize: 512, maxExportBatchSize: 64, scheduledDelayMillis: 1000, exportTimeoutMillis: 5000,
  }) : new SimpleSpanProcessor(selected);
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  trace.setGlobalTracerProvider(provider);
  initialized = provider;
  return provider;
}
