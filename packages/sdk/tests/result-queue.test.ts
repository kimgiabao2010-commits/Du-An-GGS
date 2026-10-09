import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReliableResultQueue } from '../src/transport/result-queue.js';
const roots: string[] = [];
function directory() { const root = mkdtempSync(join(tmpdir(), 'gss-result-queue-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) {
  if (!root.startsWith(join(tmpdir(), 'gss-result-queue-'))) throw new Error('Unsafe test cleanup');
  rmSync(root, { recursive: true, force: true });
} });
describe('bounded result transport journal', () => {
  it('persists an unacked result across queue recreation and removes it only for a matching ACK', () => {
    const root = directory();
    const first = new ReliableResultQueue('cli-worker-agent', root);
    const record = first.enqueue('case-1', { taskId: 'task-1', status: 'SUCCESS', output: 'fixture-host' });
    const second = new ReliableResultQueue('cli-worker-agent', root);
    expect(second.pending()).toEqual([record]);
    expect(second.acknowledge(record.deliveryId, 'wrong-case', 'task-1')).toBe(false);
    expect(second.acknowledge(record.deliveryId, 'case-1', 'wrong-task')).toBe(false);
    expect(second.acknowledge(record.deliveryId, 'case-1', 'task-1')).toBe(true);
    expect(new ReliableResultQueue('cli-worker-agent', root).pending()).toEqual([]);
  });
  it('is idempotent and refuses conflicting output for the same queued task', () => {
    const queue = new ReliableResultQueue('ide-worker-agent');
    const input = { taskId: 'task-1', status: 'FAILED', output: 'fixture-failure' };
    expect(queue.enqueue('case-1', input)).toEqual(queue.enqueue('case-1', { ...input }));
    expect(() => queue.enqueue('case-1', { ...input, output: 'mutated' })).toThrow('Conflicting');
    expect(queue.pending()).toHaveLength(1);
  });
  it('rejects oversized output before any journal record exists', () => {
    const root = directory(), queue = new ReliableResultQueue('siem-worker-agent', root);
    expect(() => queue.enqueue('case-1', { taskId: 'task-1', output: 'x'.repeat(48_000) })).toThrow('Invalid');
    expect(readdirSync(root)).toEqual([]);
  });
  it('bounds entry count without evicting unacked results', () => {
    const queue = new ReliableResultQueue('cli-worker-agent', undefined, 1);
    queue.enqueue('case-1', { taskId: 'task-1' });
    expect(() => queue.enqueue('case-1', { taskId: 'task-2' })).toThrow('capacity');
    expect(queue.pending()[0].taskId).toBe('task-1');
  });
  it('fails closed on journal hash tampering', () => {
    const root = directory(), queue = new ReliableResultQueue('cli-worker-agent', root);
    const result = queue.enqueue('case-1', { taskId: 'task-1', output: 'original' });
    const file = join(root, result.deliveryId + '.json');
    const saved = JSON.parse(readFileSync(file, 'utf8')); saved.payload.output = 'tampered';
    writeFileSync(file, JSON.stringify(saved));
    expect(() => new ReliableResultQueue('cli-worker-agent', root)).toThrow('Invalid');
  });
  it('fails closed when another worker tries to load this journal', () => {
    const root = directory(); new ReliableResultQueue('cli-worker-agent', root).enqueue('case-1', { taskId: 'task-1' });
    expect(() => new ReliableResultQueue('ide-worker-agent', root)).toThrow('Invalid');
  });
  it('never treats an interrupted temporary write as a completed result', () => {
    const root = directory(); writeFileSync(join(root, 'interrupted.tmp'), '{partial');
    expect(new ReliableResultQueue('cli-worker-agent', root).pending()).toEqual([]);
  });
  it('does not expose journal contents in a malformed JSON error', () => {
    const root = directory(); writeFileSync(join(root, 'a'.repeat(64) + '.json'), 'PRIVATE_SENTINEL invalid JSON');
    expect(() => new ReliableResultQueue('cli-worker-agent', root)).toThrow('Invalid result spool JSON');
  });
});
