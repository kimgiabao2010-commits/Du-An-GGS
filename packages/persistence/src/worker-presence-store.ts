import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { sha256Canonical } from '@asq/sdk';

export interface WorkerConnectionInput {
  workerId: string; role: string; connectionId: string; observerId: string;
}
export interface WorkerHeartbeatInput extends WorkerConnectionInput {
  executionId: string; sequence: number; readiness: 'READY' | 'BUSY' | 'BLOCKED' | 'HALTED';
}
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,256}$/.test(value)) throw fail('invalid_worker_identity', 422);
  return value;
}
export class PostgresWorkerPresenceStore {
  constructor(private readonly pool: Pool) {}
  private validate(input: WorkerConnectionInput): void {
    [input.workerId,input.role,input.connectionId,input.observerId].forEach(identity);
  }
  async register(input: WorkerConnectionInput): Promise<{ registered: true; replay: boolean }> {
    this.validate(input);
    return this.tx(async c => {
      const worker = await this.worker(c,input);
      const old = (await c.query('SELECT * FROM worker_connections WHERE connection_id=$1',[input.connectionId])).rows[0];
      if (old) {
        if (old.worker_id !== input.workerId || old.observer_id !== input.observerId || worker.current_connection_id !== input.connectionId ||
            !['CONNECTED','ONLINE'].includes(old.state)) throw fail('worker_connection_fenced');
        // Registration replay never extends a lease.
        return { registered: true, replay: true };
      }
      if (worker.current_connection_id) {
        const previous = (await c.query('SELECT *,lease_until>clock_timestamp() AS fresh FROM worker_connections WHERE connection_id=$1 FOR UPDATE',
          [worker.current_connection_id])).rows[0];
        if (previous.fresh && ['CONNECTED','ONLINE'].includes(previous.state)) throw fail('worker_already_connected');
        if (['CONNECTED','ONLINE'].includes(previous.state)) {
          await c.query("UPDATE worker_connections SET state='FENCED',closed_at=clock_timestamp() WHERE connection_id=$1",[previous.connection_id]);
        }
      }
      const generation = BigInt(worker.generation)+1n;
      await c.query(`INSERT INTO worker_connections(connection_id,worker_id,observer_id,generation) VALUES($1,$2,$3,$4)`,
        [input.connectionId,input.workerId,input.observerId,generation.toString()]);
      await c.query('UPDATE worker_registry SET current_connection_id=$2,generation=$3 WHERE worker_id=$1',
        [input.workerId,input.connectionId,generation.toString()]);
      await this.audit(c,'WORKER_CONNECTED',input,{ generation: generation.toString() });
      return { registered: true, replay: false };
    });
  }
  async heartbeat(input: WorkerHeartbeatInput): Promise<{ committed: true; replay: boolean }> {
    this.validate(input); identity(input.executionId);
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1 || !['READY','BUSY','BLOCKED','HALTED'].includes(input.readiness)) {
      throw fail('invalid_worker_heartbeat',422);
    }
    const hash=sha256Canonical(input);
    return this.tx(async c => {
      const worker=await this.worker(c,input);
      const row=(await c.query('SELECT *,lease_until>clock_timestamp() AS fresh FROM worker_connections WHERE connection_id=$1 FOR UPDATE',
        [input.connectionId])).rows[0];
      if (!row || worker.current_connection_id!==input.connectionId || row.worker_id!==input.workerId ||
          row.observer_id!==input.observerId || !row.fresh || !['CONNECTED','ONLINE'].includes(row.state)) throw fail('worker_connection_fenced');
      if (row.execution_id && row.execution_id!==input.executionId) throw fail('worker_execution_binding_mismatch');
      if (Number(row.sequence)===input.sequence) {
        if (row.heartbeat_hash!==hash) throw fail('worker_heartbeat_payload_mismatch');
        return { committed:true,replay:true };
      }
      if (Number(row.sequence)>input.sequence) throw fail('worker_heartbeat_replayed');
      await c.query(`UPDATE worker_connections SET execution_id=$2,sequence=$3,heartbeat_hash=$4,readiness=$5,
        state='ONLINE',last_seen=clock_timestamp(),lease_until=clock_timestamp()+interval '20 seconds' WHERE connection_id=$1`,
        [input.connectionId,input.executionId,input.sequence,hash,input.readiness]);
      if (row.state!=='ONLINE' || row.readiness!==input.readiness) await this.audit(c,'WORKER_READINESS_OBSERVED',input,{readiness:input.readiness});
      return { committed:true,replay:false };
    });
  }
  async disconnect(input: WorkerConnectionInput): Promise<{ closed: boolean }> {
    this.validate(input);
    return this.tx(async c => {
      await this.worker(c,input);
      const row=(await c.query('SELECT * FROM worker_connections WHERE connection_id=$1 FOR UPDATE',[input.connectionId])).rows[0];
      if (!row || row.worker_id!==input.workerId || row.observer_id!==input.observerId) throw fail('worker_connection_binding_mismatch');
      if (['OFFLINE','FENCED'].includes(row.state)) return { closed:false };
      await c.query("UPDATE worker_connections SET state='OFFLINE',closed_at=clock_timestamp(),lease_until=clock_timestamp() WHERE connection_id=$1",[input.connectionId]);
      await this.audit(c,'WORKER_DISCONNECTED',input,{});
      return { closed:true };
    });
  }
  async list(): Promise<Record<string,unknown>[]> {
    return (await this.pool.query(`SELECT w.worker_id AS "workerId",w.role,w.capabilities,w.generation::text,
      CASE WHEN c.connection_id IS NULL THEN 'UNKNOWN' WHEN c.state IN ('OFFLINE','FENCED') THEN 'OFFLINE'
        WHEN c.lease_until<=clock_timestamp() THEN 'STALE' ELSE c.state END AS presence,
      COALESCE(c.readiness,'UNKNOWN') AS "reportedReadiness",c.last_seen AS "lastSeen",c.lease_until AS "leaseUntil",
      clock_timestamp() AS "observedAt",(SELECT count(*)::int FROM worker_task_acceptances a
        JOIN runtime_tasks t ON t.task_id=a.task_id WHERE a.worker_id=w.worker_id AND t.status='RUNNING') AS "activeTasks"
      FROM worker_registry w LEFT JOIN worker_connections c ON c.connection_id=w.current_connection_id ORDER BY w.worker_id`)).rows;
  }
  private async worker(c:PoolClient,input:WorkerConnectionInput):Promise<any> {
    const worker=(await c.query('SELECT * FROM worker_registry WHERE worker_id=$1 FOR UPDATE',[input.workerId])).rows[0];
    if (!worker || worker.role!==input.role) throw fail('worker_role_denied',403);
    return worker;
  }
  private async audit(c:PoolClient,event:string,input:WorkerConnectionInput,details:Record<string,unknown>):Promise<void> {
    const payload={connectionId:input.connectionId,observerId:input.observerId,...details};
    await c.query(`INSERT INTO audit_events(event_type,severity,actor_id,target_resource,action_payload,event_hash)
      VALUES($1,'INFO',$2,$3,$4,$5)`,[event,input.observerId,input.workerId,JSON.stringify(payload),
      sha256Canonical({event,...payload,nonce:randomUUID()})]);
  }
  private async tx<T>(op:(c:PoolClient)=>Promise<T>):Promise<T> {
    const c=await this.pool.connect();
    try {await c.query('BEGIN');const result=await op(c);await c.query('COMMIT');return result;}
    catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  }
}
