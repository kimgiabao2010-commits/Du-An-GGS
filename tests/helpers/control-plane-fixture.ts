import { randomUUID } from 'node:crypto';
import type { RuntimeStore, ClaimedDispatch, InitialTaskDispatch } from '../../packages/persistence/src/runtime-store.ts';
import { initialTaskDispatchEvent } from '../../packages/sdk/src/runtime/investigation-loop.ts';
import type { ControlPlaneTaskClient } from '../../services/standalone/src/control-plane-client.ts';

// Explicit test-only authority. Production never accepts RuntimeStore.
export function controlPlaneFixture(store?: RuntimeStore): ControlPlaneTaskClient {
  const queued: ClaimedDispatch[] = [];
  const initial: InitialTaskDispatch[] = [];
  return {
    ready: async () => { await store?.ready(); },
    ensureCase: async (...args) => { await store?.ensureCase(...args); },
    ensureInvestigationRun: async (caseId, actor) => {
      if (store?.ensureInvestigationRun) return store.ensureInvestigationRun(caseId, actor);
      const now = new Date().toISOString();
      return { schemaVersion: 'gss.investigation-run.v1', runId: randomUUID(), caseId, state: 'ACTIVE',
        frontierVersion: 0, depth: 0, policyVersion: 'test-only', createdAt: now, updatedAt: now,
        budget: { maxDepth: 5, deadlineAt: new Date(Date.now() + 60_000).toISOString(),
          maxExternalQueries: 5, maxCostMicros: 1_000_000 }, usage: { externalQueries: 0, costMicros: 0 } };
    },
    appendMessage: async (...args) => await store?.appendMessage(...args) ?? randomUUID(),
    transitionCase: async (...args) => { await store?.transitionCase(...args); },
    updateTask: async (...args) => { await store?.updateTask(...args); },
    createTask: async (...args) => {
      const result = await store?.createTask(...args) ?? { created: true };
      if (result.created && !args[2]?.parentTaskId && !store?.claimInitialDispatches) {
        initial.push({ claimOwner: 'fixture', task: args[0], runId: args[2]?.runId,
          eventId: initialTaskDispatchEvent(args[0], args[2]?.runId).eventId });
      }
      return result;
    },
    claimInitialDispatches: async (owner, limit) => store?.claimInitialDispatches ?
      store.claimInitialDispatches(owner, limit) : initial.splice(0, limit ?? 25).map(item => ({ ...item, claimOwner: owner })),
    recordResult: async (...args) => {
      const loop = await store?.recordResult(args[0], args[1], args[2]);
      // Memory fixtures emulate authority-owned lifecycle; production uses the result transaction.
      await store?.transitionCase(args[0].caseId, args[0].status !== 'COMPLETED' || loop && loop.decision.kind === 'BLOCKED'
        ? 'INVESTIGATING' : loop && loop.decision.kind === 'DISPATCH' ? 'COLLECTING_EVIDENCE' : 'ANALYZING');
      if (loop && loop.decision.kind === 'DISPATCH' && !store?.claimPendingDispatches) {
        queued.push({ claimOwner: 'fixture', parentTaskId: args[0].taskId, loop });
      }
      return { replay: false, loop };
    },
    claimPendingDispatches: async (owner, limit) => {
      if (store?.claimPendingDispatches) return store.claimPendingDispatches(owner, limit);
      return queued.splice(0, limit ?? 25).map(item => ({ ...item, claimOwner: owner }));
    },
    markOutboxPublished: async (...args) => await store?.markOutboxPublished?.(...args) ?? true,
    releaseOutbox: async (...args) => await store?.releaseOutbox?.(...args) ?? true,
    recordModelUsage: async record => await store?.recordModelUsage?.(record) ?? { created: true },
    registerArtifact: async () => ({ artifactId: randomUUID(), created: true }),
    signArtifact: async () => { throw new Error('Test fixture has no signing key'); },
  };
}
