import { mkdirSync, readdirSync, readFileSync, lstatSync, openSync, writeFileSync,
  fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { workerDeliveryId, type WorkerDeliveryInput } from '../runtime/worker-delivery.js';

/** Transport journal only: PostgreSQL remains the lifecycle/evidence authority. */
export class ReliableResultQueue {
  private readonly records = new Map<string, WorkerDeliveryInput>();
  private readonly root?: string;
  constructor(private readonly workerId: string, directory?: string, private readonly capacity = 100) {
    if (!['cli-worker-agent', 'ide-worker-agent', 'siem-worker-agent'].includes(workerId)) throw new Error('Invalid result queue identity');
    if (!directory) return;
    this.root = resolve(directory);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (lstatSync(this.root).isSymbolicLink()) throw new Error('Result spool symlink denied');
    for (const file of readdirSync(this.root)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue; // Interrupted .tmp writes are never replayed as results.
      const path = resolve(this.root, file), stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 52_000) throw new Error('Invalid result spool file');
      let input: WorkerDeliveryInput;
      try { input = JSON.parse(readFileSync(path, 'utf8')) as WorkerDeliveryInput; }
      catch { throw new Error('Invalid result spool JSON'); }
      this.validate(input);
      if (file !== input.deliveryId + '.json' || this.records.size >= this.capacity) throw new Error('Invalid result spool capacity/hash');
      this.records.set(input.deliveryId, input);
    }
  }
  public enqueue(caseId: string, payload: Record<string, unknown>): WorkerDeliveryInput {
    const copy = JSON.parse(JSON.stringify(payload));
    const body = { caseId, taskId: String(copy.taskId ?? ''), workerId: this.workerId, payload: copy };
    const input: WorkerDeliveryInput = { schemaVersion: 'gss.worker-delivery.v1', ...body, deliveryId: workerDeliveryId(body) };
    this.validate(input);
    const prior = this.forTask(input.taskId);
    if (prior) {
      if (prior.deliveryId !== input.deliveryId) throw new Error('Conflicting result for queued task');
      return prior;
    }
    if (this.records.size >= this.capacity) throw new Error('Result queue capacity exceeded');
    if (this.root) {
      const path = resolve(this.root, input.deliveryId + '.json');
      const temporary = resolve(this.root, `${input.deliveryId}.${randomUUID()}.tmp`);
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(input)); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temporary, path);
    }
    this.records.set(input.deliveryId, input);
    return input;
  }
  public pending(): WorkerDeliveryInput[] { return [...this.records.values()]; }
  public forTask(taskId: string): WorkerDeliveryInput | undefined {
    return [...this.records.values()].find(record => record.taskId === taskId);
  }
  public acknowledge(deliveryId: string, caseId: string, taskId: string): boolean {
    const record = this.records.get(deliveryId);
    if (!record || record.caseId !== caseId || record.taskId !== taskId) return false;
    if (this.root) unlinkSync(resolve(this.root, deliveryId + '.json'));
    this.records.delete(deliveryId);
    return true;
  }
  private validate(input: WorkerDeliveryInput): void {
    if (input.schemaVersion !== 'gss.worker-delivery.v1' || input.workerId !== this.workerId ||
      typeof input.caseId !== 'string' || !input.caseId || input.caseId.length > 256 ||
      typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 256 ||
      !input.payload || input.payload.taskId !== input.taskId ||
      Buffer.byteLength(JSON.stringify(input.payload)) > 48_000 ||
      input.deliveryId !== workerDeliveryId({ caseId: input.caseId, taskId: input.taskId,
        workerId: input.workerId, payload: input.payload })) throw new Error('Invalid result queue envelope');
  }
}
