import { describe, expect, it, vi } from 'vitest';
import type { GssTaskContract } from '../../../packages/sdk/src/runtime/contracts.ts';
import { IdeInvestigatorDaemon } from '../src/engine.ts';
import type { ReadonlyRepoInvestigator } from '../src/readonly-investigator.ts';

function task(): GssTaskContract {
  return {
    schemaVersion: 'gss.task.v1', taskId: 'TASK-REPLAY', caseId: 'CASE-REPLAY', idempotencyKey: 'IDEM-REPLAY',
    source: 'standalone', target: 'ide', action: 'search_code', parameters: { query: 'marker' }, riskLevel: 'read_only',
    contextRefs: [], timeoutMs: 5000, createdAt: new Date().toISOString(),
  };
}

describe('IdeInvestigatorDaemon boundaries', () => {
  it('executes a task once and reports a replay without running the investigator again', async () => {
    const execute = vi.fn(async (value: GssTaskContract) => ({
      taskId: value.taskId, status: 'SUCCESS' as const, output: '{}', durationMs: 1,
    }));
    const daemon = new IdeInvestigatorDaemon('ws://127.0.0.1:1', 'test-token', { execute } as unknown as ReadonlyRepoInvestigator);
    const publish = vi.fn();
    (daemon as any).publish = publish;
    const message = { type: 'TASK', source: 'STANDALONE', incident_id: 'CASE-REPLAY', payload: task() };
    await (daemon as any).handle(message);
    await (daemon as any).handle(message);
    expect(execute).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenNthCalledWith(1, 'CASE-REPLAY', expect.objectContaining({ status: 'SUCCESS' }));
    expect(publish).toHaveBeenNthCalledWith(2, 'CASE-REPLAY', expect.objectContaining({
      status: 'BLOCKED', failure: expect.objectContaining({ code: 'REPLAYED_TASK' }),
    }));
    daemon.stop();
  });
});
