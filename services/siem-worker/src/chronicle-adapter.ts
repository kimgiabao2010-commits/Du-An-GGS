import { createHash, randomUUID } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import type {
  IndicatorType, InvestigationEvidence, InvestigationRequest, SiemAdapter, SiemFailureCode,
} from '@asq/sdk';

export interface ChronicleConfig {
  project: string;
  location: string;
  instance: string;
  endpoint: string;
  timeoutMs?: number;
  maxRangeHours?: number;
  maxResults?: number;
}

export class SiemAdapterError extends Error {
  constructor(public readonly code: SiemFailureCode, message: string) {
    super(message);
    this.name = 'SiemAdapterError';
  }
}

type FetchLike = typeof fetch;
type TokenProvider = () => Promise<string>;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new SiemAdapterError('UNCONFIGURED', `${name} is required`);
  return value;
}

function validateEndpoint(endpoint: string): string {
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new SiemAdapterError('UNCONFIGURED', 'Chronicle endpoint is not a valid URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.hostname === 'chronicle.googleapis.com' || url.hostname.endsWith('-chronicle.googleapis.com'))) {
    throw new SiemAdapterError('UNCONFIGURED', 'Chronicle endpoint must be an HTTPS googleapis.com Chronicle endpoint');
  }
  return url.origin;
}

function validateIdentifier(value: string, label: string): string {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(value)) throw new SiemAdapterError('UNCONFIGURED', `Invalid ${label}`);
  return value;
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function validateIndicator(type: IndicatorType, value: string): string {
  const trimmed = value.trim();
  const validators: Record<IndicatorType, RegExp> = {
    IP: /^(?:[a-fA-F0-9:]{2,39}|(?:\d{1,3}\.){3}\d{1,3})$/,
    DOMAIN: /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,
    HASH: /^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/,
    USER: /^[a-zA-Z0-9._@\\-]{1,256}$/,
    HOSTNAME: /^[a-zA-Z0-9._-]{1,253}$/,
  };
  if (!validators[type]?.test(trimmed)) throw new SiemAdapterError('INVALID_QUERY', `Invalid ${type} indicator`);
  if (type === 'IP' && trimmed.includes('.')) {
    const octets = trimmed.split('.').map(Number);
    if (octets.some(part => part > 255)) throw new SiemAdapterError('INVALID_QUERY', 'Invalid IP indicator');
  }
  return trimmed;
}

export function buildChronicleQuery(type: IndicatorType, rawValue: string): string {
  const value = quote(validateIndicator(type, rawValue));
  const templates: Record<IndicatorType, string[]> = {
    IP: ['principal.ip', 'target.ip', 'src.ip'],
    DOMAIN: ['principal.hostname', 'target.hostname', 'network.dns.questions.name'],
    HASH: ['target.file.md5', 'target.file.sha1', 'target.file.sha256'],
    USER: ['principal.user.userid', 'target.user.userid'],
    HOSTNAME: ['principal.hostname', 'target.hostname'],
  };
  return templates[type].map(field => `${field} = ${value}`).join(' OR ');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

function allowlistEntity(value: unknown): Record<string, unknown> {
  const entity = record(value);
  const user = pick(record(entity.user), ['userid']);
  const file = pick(record(entity.file), ['md5', 'sha1', 'sha256']);
  return { ...pick(entity, ['ip', 'hostname']), ...(Object.keys(user).length ? { user } : {}),
    ...(Object.keys(file).length ? { file } : {}) };
}

function allowlistEvent(event: unknown): Record<string, unknown> {
  const source = record(event);
  const dns = record(record(source.network).dns);
  const questions = Array.isArray(dns.questions) ? dns.questions.slice(0, 20).map(item => pick(record(item), ['name'])) : [];
  return {
    metadata: pick(record(source.metadata), ['id', 'event_timestamp', 'event_type', 'product_event_type']),
    principal: allowlistEntity(source.principal),
    target: allowlistEntity(source.target),
    src: pick(record(source.src), ['ip', 'hostname']),
    network: questions.length ? { dns: { questions } } : {},
    security_result: Array.isArray(source.security_result)
      ? source.security_result.slice(0, 20).map(item => pick(record(item), ['action', 'severity', 'threat_name'])) : [],
  };
}

function eventId(event: Record<string, unknown>): string {
  const metadata = event.metadata;
  if (metadata && typeof metadata === 'object') {
    const id = (metadata as Record<string, unknown>).id;
    if (typeof id === 'string' && id) return id;
  }
  return `EVT-${createHash('sha256').update(JSON.stringify(event)).digest('hex').slice(0, 24)}`;
}

export class ChronicleAdapter implements SiemAdapter {
  private readonly config: Required<ChronicleConfig>;

  constructor(config: ChronicleConfig, private fetchImpl: FetchLike = fetch, private tokenProvider: TokenProvider = async () => {
    const token = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
    if (!token) throw new SiemAdapterError('AUTH_DENIED', 'Google Application Default Credentials did not return an access token');
    return token;
  }) {
    this.config = {
      ...config,
      project: validateIdentifier(config.project, 'project'),
      location: validateIdentifier(config.location, 'location'),
      instance: validateIdentifier(config.instance, 'instance'),
      endpoint: validateEndpoint(config.endpoint),
      timeoutMs: config.timeoutMs ?? 15_000,
      maxRangeHours: config.maxRangeHours ?? 168,
      maxResults: config.maxResults ?? 1_000,
    };
  }

  static fromEnvironment(): ChronicleAdapter {
    return new ChronicleAdapter({
      project: requireEnv('GSS_CHRONICLE_PROJECT'),
      location: requireEnv('GSS_CHRONICLE_LOCATION'),
      instance: requireEnv('GSS_CHRONICLE_INSTANCE'),
      endpoint: requireEnv('GSS_CHRONICLE_ENDPOINT'),
    });
  }

  async investigate(request: InvestigationRequest): Promise<InvestigationEvidence> {
    const start = new Date(request.timeRange.start);
    const end = new Date(request.timeRange.end);
    if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || start >= end ||
        end.valueOf() - start.valueOf() > this.config.maxRangeHours * 3_600_000) {
      throw new SiemAdapterError('INVALID_QUERY', `Time range must be positive and at most ${this.config.maxRangeHours} hours`);
    }
    const limit = request.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.config.maxResults) {
      throw new SiemAdapterError('INVALID_QUERY', `Result limit must be between 1 and ${this.config.maxResults}`);
    }
    const query = buildChronicleQuery(request.indicator.type, request.indicator.value);
    const queryHash = createHash('sha256').update(query).digest('hex');
    const instancePath = `projects/${this.config.project}/locations/${this.config.location}/instances/${this.config.instance}`;
    const url = new URL(`/v1/${instancePath}:udmSearch`, this.config.endpoint);
    url.searchParams.set('query', query);
    url.searchParams.set('timeRange.startTime', start.toISOString());
    url.searchParams.set('timeRange.endTime', end.toISOString());
    url.searchParams.set('limit', String(limit));

    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        response = await this.fetchImpl(url, {
          method: 'GET', signal: controller.signal,
          headers: { authorization: `Bearer ${await this.tokenProvider()}`, accept: 'application/json' },
        });
      } catch (error) {
        if (error instanceof SiemAdapterError) throw error;
        if ((error as Error).name === 'AbortError') throw new SiemAdapterError('UPSTREAM_TIMEOUT', 'Chronicle UDM Search timed out');
        throw new SiemAdapterError('UPSTREAM_FAILURE', 'Chronicle UDM Search was unavailable');
      } finally { clearTimeout(timeout); }
      if (response.status !== 429 || attempt === 1) break;
      const retryAfter = Math.min(Number(response.headers.get('retry-after') ?? 0), 2);
      if (retryAfter > 0) await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    }
    if (!response) throw new SiemAdapterError('UPSTREAM_FAILURE', 'Chronicle returned no response');
    if (response.status === 401 || response.status === 403) throw new SiemAdapterError('AUTH_DENIED', 'Chronicle rejected the read-only identity');
    if (response.status === 429) throw new SiemAdapterError('RATE_LIMIT', 'Chronicle rate limit was exceeded');
    if (response.status === 400) throw new SiemAdapterError('INVALID_QUERY', 'Chronicle rejected the generated UDM query');
    if (!response.ok) throw new SiemAdapterError('UPSTREAM_FAILURE', `Chronicle returned HTTP ${response.status}`);

    let body: { events?: unknown[]; moreDataAvailable?: boolean };
    try { body = await response.json() as typeof body; }
    catch { throw new SiemAdapterError('UPSTREAM_FAILURE', 'Chronicle returned malformed JSON'); }
    const events = (Array.isArray(body.events) ? body.events : []).map(allowlistEvent);
    return {
      evidenceId: `EVD-${randomUUID()}`,
      incidentId: request.incidentId,
      taskId: request.taskId,
      eventIds: events.map(eventId),
      events,
      provenance: {
        adapter: 'google-chronicle', adapterVersion: 'v1', queryHash,
        sourceInstance: instancePath, queriedAt: new Date().toISOString(), timeRange: request.timeRange,
        resultCount: events.length, truncated: Boolean(body.moreDataAvailable), redaction: 'ALLOWLISTED_FIELDS_ONLY',
      },
    };
  }
}
