import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { sha256Canonical,type WorkloadId } from '@asq/sdk';

export interface WorkloadRevocationInput {
  schemaVersion:'gss.workload-revocation.v1'; fingerprint:string;workloadId:WorkloadId;
  idempotencyKey:string;reasonHash:string;
}
export interface WorkloadRevocationReceipt {
  schemaVersion:'gss.workload-revocation-receipt.v1';revocationId:string;revision:number;replay:boolean;
}
const ids=new Set(['command-center','ui-gateway','cli-worker-agent','ide-worker-agent','siem-worker-agent']);
const deny=(message:string,statusCode=403)=>Object.assign(new Error(message),{statusCode});
const hash=(v:unknown)=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const revision=(v:unknown)=>{const n=Number(v);if(!Number.isSafeInteger(n) || n<0)throw deny('revocation_revision_unavailable',503);return n;};

/** A permanent deny floor, not a certificate enrollment/grant policy. */
export class PostgresWorkloadRevocationStore {
  constructor(private readonly pool:Pool) {}
  async revoke(input:WorkloadRevocationInput,actorId:string):Promise<WorkloadRevocationReceipt> {
    if(input?.schemaVersion!=='gss.workload-revocation.v1' || !hash(input.fingerprint) || !hash(input.reasonHash) ||
      !ids.has(input.workloadId) || typeof input.idempotencyKey!=='string' || !input.idempotencyKey.trim() || input.idempotencyKey.length>256 ||
      typeof actorId!=='string' || !actorId.trim() || actorId.length>2048)throw deny('invalid_workload_revocation',422);
    // Trusted actor participates in replay binding; body/header impersonation never supplies it.
    const requestHash=sha256Canonical({input,actorId});
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const state=(await client.query('SELECT revision FROM workload_revocation_state WHERE singleton=true FOR UPDATE')).rows[0];
      if(!state)throw deny('revocation_authority_unavailable',503);
      const previous=(await client.query('SELECT * FROM workload_certificate_revocations WHERE idempotency_key=$1 OR fingerprint=$2',
        [input.idempotencyKey,input.fingerprint])).rows;
      if(previous.length) {
        const receipt=previous.find(r=>r.idempotency_key===input.idempotencyKey);
        if(!receipt || previous.length!==1 || receipt.request_hash!==requestHash)throw deny('revocation_idempotency_conflict',409);
        await client.query('COMMIT');
        return {schemaVersion:'gss.workload-revocation-receipt.v1',revocationId:receipt.revocation_id,revision:revision(receipt.revision),replay:true};
      }
      const next=revision(state.revision)+1;if(!Number.isSafeInteger(next))throw deny('revocation_revision_exhausted',503);
      const revocationId=randomUUID();
      await client.query(`INSERT INTO workload_certificate_revocations
        (fingerprint,revocation_id,idempotency_key,request_hash,workload_id,reason_hash,actor_id,revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[input.fingerprint,revocationId,input.idempotencyKey,requestHash,input.workloadId,input.reasonHash,actorId,next]);
      await client.query('UPDATE workload_revocation_state SET revision=$1 WHERE singleton=true',[next]);
      const payload={revocationId,fingerprint:input.fingerprint,workloadId:input.workloadId,reasonHash:input.reasonHash,revision:next};
      await client.query(`INSERT INTO audit_events(event_type,severity,actor_id,target_resource,action_payload,event_hash)
        VALUES('WORKLOAD_CERTIFICATE_REVOKED','WARNING',$1,$2,$3,$4)`,[actorId,input.workloadId,JSON.stringify(payload),
        sha256Canonical({eventId:randomUUID(),type:'WORKLOAD_CERTIFICATE_REVOKED',actorId,payload})]);
      await client.query('COMMIT');
      return {schemaVersion:'gss.workload-revocation-receipt.v1',revocationId,revision:next,replay:false};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async check(fingerprint:string):Promise<{allowed:true;revision:number}> {
    if(!hash(fingerprint))throw deny('invalid_workload_fingerprint',422);
    let state;
    try {state=(await this.pool.query(`SELECT revision,EXISTS(
      SELECT 1 FROM workload_certificate_revocations WHERE fingerprint=$1) AS revoked
      FROM workload_revocation_state WHERE singleton=true`,[fingerprint])).rows[0];}
    catch{throw deny('revocation_authority_unavailable',503);}
    if(!state)throw deny('revocation_authority_unavailable',503);
    if(state.revoked)throw deny('workload_certificate_revoked');
    return {allowed:true,revision:revision(state.revision)};
  }
  async list():Promise<Record<string,unknown>[]> {
    return (await this.pool.query(`SELECT fingerprint,revocation_id,workload_id,reason_hash,actor_id,revision,revoked_at
      FROM workload_certificate_revocations ORDER BY revision DESC LIMIT 100`)).rows;
  }
}
