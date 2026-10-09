import { context, trace, ROOT_CONTEXT, SpanStatusCode, isSpanContextValid, type Attributes } from '@opentelemetry/api';

/** No baggage, prompts, credentials, parameters or worker output are ever propagated. */
export function validTraceparent(value: unknown): value is string {
  return typeof value === 'string' && /^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/.test(value) &&
    !value.includes('-' + '0'.repeat(32) + '-') && !value.includes('-' + '0'.repeat(16) + '-');
}
export function currentTraceparent(): string | undefined {
  const span = trace.getSpan(context.active())?.spanContext();
  return span && isSpanContextValid(span) ? `00-${span.traceId}-${span.spanId}-${(span.traceFlags & 1).toString(16).padStart(2, '0')}` : undefined;
}
export function currentTraceId(): string {
  const id = trace.getSpan(context.active())?.spanContext().traceId;
  if (!id || /^0+$/.test(id)) throw new Error('Tracing must be initialized before recording model usage');
  return id;
}
const attributeAllowlist = new Set(['gss.case_id', 'gss.task_id', 'gss.action', 'gss.target', 'gss.status', 'http.request.method']);
export async function withGssSpan<T>(name: string, attributes: Attributes, operation: () => Promise<T>, parent?: unknown): Promise<T> {
  let parentContext = context.active();
  if (validTraceparent(parent)) {
    const [, traceId, spanId, flags] = parent.split('-');
    parentContext = trace.setSpanContext(ROOT_CONTEXT, { traceId, spanId, traceFlags: parseInt(flags, 16), isRemote: true });
  }
  const safe: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (attributeAllowlist.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      safe[key] = typeof value === 'string' ? value.slice(0, 128) : value;
    }
  }
  return trace.getTracer('gss', '1.0.0').startActiveSpan(name, { attributes: safe }, parentContext, async span => {
    try { return await operation(); }
    catch (error) { span.setStatus({ code: SpanStatusCode.ERROR }); throw error; }
    finally { span.end(); }
  });
}
