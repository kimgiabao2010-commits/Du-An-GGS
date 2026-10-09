import { readFileSync,statSync } from 'node:fs';
import { createHash,X509Certificate } from 'node:crypto';
import type { TLSSocket } from 'node:tls';

const roles={ 'command-center':'STANDALONE','ui-gateway':'UI_GATEWAY',
  'cli-worker-agent':'CLI_DAEMON','ide-worker-agent':'IDE_AGENT','siem-worker-agent':'SIEM' } as const;
export type WorkloadId=keyof typeof roles;
export interface WorkloadIdentity { workloadId:WorkloadId; role:string; fingerprint:string; notAfter:number }
export interface WorkloadPolicy {
  schemaVersion:'gss.workload-policy.v1';
  workloads:{workloadId:WorkloadId;dnsName:string;pins:string[]}[];
  revokedFingerprints:string[];
}
const fail=(message:string,statusCode=403)=>Object.assign(new Error(message),{statusCode});
const hash=(v:unknown)=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
export function parseWorkloadPolicy(value:unknown):WorkloadPolicy {
  const p=value as WorkloadPolicy;
  if(!p || p.schemaVersion!=='gss.workload-policy.v1' || !Array.isArray(p.workloads) ||
     p.workloads.length<1 || p.workloads.length>5 || !Array.isArray(p.revokedFingerprints) ||
     p.revokedFingerprints.length>128 || !p.revokedFingerprints.every(hash)) throw fail('invalid_workload_policy',503);
  const ids=new Set(),names=new Set(),pins=new Set();
  for(const w of p.workloads) {
    if(!w || !Object.hasOwn(roles,w.workloadId) || typeof w.dnsName!=='string' || w.dnsName.length>253 ||
       !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(w.dnsName) ||
       !Array.isArray(w.pins) || w.pins.length<1 || w.pins.length>2 || !w.pins.every(hash) ||
       ids.has(w.workloadId) || names.has(w.dnsName)) throw fail('invalid_workload_policy',503);
    ids.add(w.workloadId);names.add(w.dnsName);
    for(const pin of w.pins) {if(pins.has(pin))throw fail('ambiguous_workload_pin',503);pins.add(pin);}
  }
  return p;
}
/** Leaf pin + exact DNS SAN; CA trust and possession are still enforced by TLS. */
export function identifyWorkload(raw:Buffer,policy:WorkloadPolicy,now=Date.now()):WorkloadIdentity {
  let cert:X509Certificate;
  try {cert=new X509Certificate(raw);}catch{throw fail('invalid_peer_certificate');}
  const start=Date.parse(cert.validFrom),end=Date.parse(cert.validTo);
  if(!Number.isFinite(start) || !Number.isFinite(end) || now<start || now>=end || cert.ca ||
      !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.2')) throw fail('peer_certificate_not_usable');
  const fingerprint=createHash('sha256').update(cert.raw).digest('hex');
  if(policy.revokedFingerprints.includes(fingerprint))throw fail('peer_certificate_revoked');
  const matches=policy.workloads.filter(w=>cert.checkHost(w.dnsName,{subject:'never',wildcards:false,
    partialWildcards:false,multiLabelWildcards:false,singleLabelSubdomains:false})?.toLowerCase()===w.dnsName);
  if(matches.length!==1 || !matches[0].pins.includes(fingerprint)) throw fail('peer_workload_binding_denied');
  const workloadId=matches[0].workloadId;
  return {workloadId,role:roles[workloadId],fingerprint,notAfter:end};
}
export function assertWorkerWorkload(peer:WorkloadIdentity,claims:{agentId:string;role:string}):void {
  if(peer.workloadId==='ui-gateway' && ['CISO_Admin','SECURITY_ADMIN'].includes(claims.role)) return;
  if(peer.workloadId!==claims.agentId || peer.role!==claims.role || !['CLI_DAEMON','IDE_AGENT','SIEM'].includes(peer.role)) {
    throw fail('token_certificate_identity_mismatch');
  }
}
/** Operator-managed public policy is re-read, so pin withdrawal also affects existing sockets. */
export class WorkloadPeerPolicy {
  readonly enabled:boolean;
  constructor(private readonly file=process.env.GSS_TLS_WORKLOAD_POLICY_FILE,
    required=process.env.GSS_RUNTIME_ENV==='staging') {
    this.enabled=Boolean(file);
    if(required && !this.enabled)throw fail('staging_workload_policy_required',503);
    if(this.enabled)this.load();
  }
  private load():WorkloadPolicy {
    try {
      if(!this.file || statSync(this.file).size>65536) throw new Error('bounded policy required');
      const bytes=readFileSync(this.file);if(bytes.length>65536)throw new Error('bounded policy required');
      return parseWorkloadPolicy(JSON.parse(bytes.toString('utf8')));
    }catch{throw fail('workload_policy_unavailable_or_invalid',503);}
  }
  authenticate(socket:unknown):WorkloadIdentity|undefined {
    if(!this.enabled)return undefined;
    const tls=socket as TLSSocket;
    if(tls.encrypted!==true || tls.authorized!==true || typeof tls.getPeerCertificate!=='function')throw fail('authorized_mtls_peer_required');
    const raw=tls.getPeerCertificate().raw;
    if(!Buffer.isBuffer(raw))throw fail('peer_certificate_required');
    return identifyWorkload(raw,this.load());
  }
}
