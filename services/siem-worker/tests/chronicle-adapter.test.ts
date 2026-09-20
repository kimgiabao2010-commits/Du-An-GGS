import { describe, expect, it, vi } from 'vitest';
import { ChronicleAdapter, SiemAdapterError, buildChronicleQuery } from '../src/chronicle-adapter.js';

const config = {
  project: 'security-project', location: 'us', instance: 'staging',
  endpoint: 'https://us-chronicle.googleapis.com', timeoutMs: 20, maxRangeHours: 24, maxResults: 100,
};
const request = {
  incidentId: 'CASE-1', taskId: 'TASK-1', idempotencyKey: 'idem-1', requestedBy: 'test',
  indicator: { type: 'IP' as const, value: '8.8.8.8' },
  timeRange: { start: '2026-09-20T00:00:00.000Z', end: '2026-09-20T01:00:00.000Z' }, limit: 25,
};

describe('ChronicleAdapter', () => {
  it('generates only predefined UDM templates', () => {
    expect(buildChronicleQuery('IP', '8.8.8.8')).toBe('principal.ip = "8.8.8.8" OR target.ip = "8.8.8.8" OR src.ip = "8.8.8.8"');
    expect(() => buildChronicleQuery('IP', '8.8.8.8 OR true')).toThrow(SiemAdapterError);
  });

  it('normalizes provenance and removes non-allowlisted fields', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ events: [{
      metadata: { id: 'event-1', event_type: 'NETWORK_DNS', hidden: 'secret' },
      principal: { ip: ['8.8.8.8'], user: { userid: 'analyst', email: 'private@example.com' }, secret: 'drop' },
      target: { hostname: 'host-1' }, extra: { credential: 'drop' },
    }], moreDataAvailable: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const evidence = await new ChronicleAdapter(config, fetcher as typeof fetch, async () => 'token').investigate(request);
    expect(evidence.eventIds).toEqual(['event-1']);
    expect(evidence.provenance).toMatchObject({ adapter: 'google-chronicle', resultCount: 1, truncated: true,
      redaction: 'ALLOWLISTED_FIELDS_ONLY' });
    expect(JSON.stringify(evidence.events)).not.toContain('private@example.com');
    expect(JSON.stringify(evidence.events)).not.toContain('credential');
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.pathname).toContain(':udmSearch');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  it.each([[401, 'AUTH_DENIED'], [403, 'AUTH_DENIED'], [400, 'INVALID_QUERY'], [429, 'RATE_LIMIT'], [500, 'UPSTREAM_FAILURE']] as const)(
    'fails closed for HTTP %s', async (status, code) => {
      const fetcher = vi.fn(async () => new Response('{}', { status }));
      const adapter = new ChronicleAdapter(config, fetcher as typeof fetch, async () => 'token');
      await expect(adapter.investigate(request)).rejects.toMatchObject({ code });
    });

  it('fails closed on timeout', async () => {
    const fetcher = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const adapter = new ChronicleAdapter(config, fetcher as typeof fetch, async () => 'token');
    await expect(adapter.investigate(request)).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  it('rejects oversized ranges and result limits before network access', async () => {
    const fetcher = vi.fn();
    const adapter = new ChronicleAdapter(config, fetcher as typeof fetch, async () => 'token');
    await expect(adapter.investigate({ ...request, limit: 101 })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
