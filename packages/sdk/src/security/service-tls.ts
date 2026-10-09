import { readFileSync } from 'node:fs';
import { createSecureContext, type SecureContextOptions } from 'node:tls';
import { request } from 'node:https';

/** Each service supplies its own certificate/key, never a shared private key. */
export function serviceTlsOptions(required = process.env.GSS_RUNTIME_ENV === 'staging'): SecureContextOptions | undefined {
  const names = ['GSS_TLS_CA_FILE','GSS_TLS_CERT_FILE','GSS_TLS_KEY_FILE'] as const;
  if (!names.some(name => process.env[name])) {
    if (required) throw new Error('Staging requires service-specific TLS CA, certificate and key');
    return undefined;
  }
  if (!names.every(name => process.env[name])) throw new Error('Incomplete service TLS configuration');
  const options: SecureContextOptions = { ca:readFileSync(process.env.GSS_TLS_CA_FILE!),
    cert:readFileSync(process.env.GSS_TLS_CERT_FILE!),key:readFileSync(process.env.GSS_TLS_KEY_FILE!),minVersion:'TLSv1.3' };
  createSecureContext(options); // Fail before binding/dispatch if keys or chain cannot be loaded.
  return options;
}

export function validateServiceUrl(value: string, websocket = false): URL {
  const url = new URL(value);
  const secure = websocket ? 'wss:' : 'https:';
  const plain = websocket ? 'ws:' : 'http:';
  const loopback = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.protocol !== secure && (url.protocol !== plain || !loopback || process.env.GSS_RUNTIME_ENV === 'staging')) {
    throw new Error('Service transport requires TLS; plaintext is loopback-local only');
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Disabled TLS verification is forbidden');
  return url;
}

/** Bounded native HTTPS transport supports mTLS without disabling CA/hostname verification. */
export async function serviceFetch(value: string, init: RequestInit = {}): Promise<Response> {
  const url = validateServiceUrl(value);
  if (url.protocol === 'http:') return fetch(value,init);
  const tls = serviceTlsOptions();
  if (init.body !== undefined && typeof init.body !== 'string') throw new Error('Service request requires a string body');
  return new Promise((resolve,reject) => {
    const req = request(url,{...tls,rejectUnauthorized:true,method:init.method ?? 'GET',
      headers:Object.fromEntries(new Headers(init.headers).entries()),signal:init.signal ?? AbortSignal.timeout(10000)},res => {
      const chunks: Buffer[] = []; let bytes=0;
      res.on('data',chunk => {
        bytes+=chunk.length;
        if (bytes>1_000_000) { req.destroy(new Error('Service response exceeds bounded limit')); return; }
        chunks.push(Buffer.from(chunk));
      });
      res.on('error',reject);
      res.on('end',() => resolve(new Response(Buffer.concat(chunks),{status:res.statusCode ?? 503,
        headers:{'content-type':'application/json'}})));
    });
    req.on('error',reject); if (typeof init.body==='string') req.write(init.body); req.end();
  });
}
