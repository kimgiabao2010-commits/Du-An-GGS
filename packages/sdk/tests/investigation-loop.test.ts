import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_FRONTIER_SCHEMA_VERSION,
  INVESTIGATION_RUN_SCHEMA_VERSION,
  actionFingerprint,
  canonicalJson,
  createControlOutboxEvent,
  planNextStep,
  reduceEvidenceFrontier,
  type InvestigationRun,
  type ObservationPack,
} from '../src/index.js';

const now = '2026-09-27T00:00:00.000Z';

function observation(overrides: Partial<ObservationPack> = {}): ObservationPack {
  return {
    observationId: 'obs-1',
    caseId: 'case-1',
    taskId: 'task-1',
    summary: 'verified observation',
    facts: [{ key: 'hostname', value: 'host-a' }],
    evidenceRefs: ['EVD-1'],
    originalBytes: 100,
    packedBytes: 20,
    createdAt: now,
    ...overrides,
  };
}

function run(overrides: Partial<InvestigationRun> = {}): InvestigationRun {
  return {
    schemaVersion: INVESTIGATION_RUN_SCHEMA_VERSION,
    runId: 'run-1',
    caseId: 'case-1',
    state: 'ACTIVE',
    frontierVersion: 0,
    depth: 0,
    budget: { maxDepth: 5, deadlineAt: '2026-09-28T00:00:00.000Z', maxExternalQueries: 10, maxCostMicros: 1_000_000 },
    usage: { externalQueries: 0, costMicros: 0 },
    policyVersion: 'gss.planner.v1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('M6 investigation loop contracts', () => {
  it('canonicalizes equivalent objects and fingerprints actions deterministically', () => {
    expect(canonicalJson({ b: 2, a: { y: true, x: 1 } })).toBe('{"a":{"x":1,"y":true},"b":2}');
    const left = actionFingerprint({ target: 'ide', action: 'search_code', riskLevel: 'read_only', parameters: { query: 'ioc', path: 'src' } });
    const right = actionFingerprint({ target: 'ide', action: 'search_code', riskLevel: 'read_only', parameters: { path: 'src', query: 'ioc' } });
    expect(left).toBe(right);
  });

  it('deduplicates equivalent facts while preserving independent provenance', () => {
    const first = reduceEvidenceFrontier({ runId: 'run-1', caseId: 'case-1', observation: observation(), source: 'ide', now });
    const second = reduceEvidenceFrontier({
      runId: 'run-1', caseId: 'case-1', current: first,
      observation: observation({ observationId: 'obs-2', taskId: 'task-2', evidenceRefs: ['EVD-2'] }),
      source: 'siem', now: '2026-09-27T00:01:00.000Z',
    });
    expect(first.schemaVersion).toBe(EVIDENCE_FRONTIER_SCHEMA_VERSION);
    expect(second.facts).toHaveLength(1);
    expect(second.facts[0]?.provenance).toHaveLength(2);
    expect(second.evidenceRefs).toEqual(['EVD-1', 'EVD-2']);
    expect(second.sourceObservationIds).toEqual(['obs-1', 'obs-2']);
  });

  it('preserves contradictory facts instead of overwriting them', () => {
    const first = reduceEvidenceFrontier({ runId: 'run-1', caseId: 'case-1', observation: observation(), source: 'ide', now });
    const second = reduceEvidenceFrontier({
      runId: 'run-1', caseId: 'case-1', current: first,
      observation: observation({ observationId: 'obs-2', taskId: 'task-2', facts: [{ key: 'hostname', value: 'host-b' }], evidenceRefs: ['EVD-2'] }),
      source: 'siem', now,
    });
    expect(second.facts).toHaveLength(2);
    expect(second.contradictions).toHaveLength(1);
    expect(second.contradictions[0]?.factIds).toHaveLength(2);
  });

  it('blocks finalization while evidence is contradictory', () => {
    const first = reduceEvidenceFrontier({ runId: 'run-1', caseId: 'case-1', observation: observation(), source: 'ide', now });
    const frontier = reduceEvidenceFrontier({
      runId: 'run-1', caseId: 'case-1', current: first,
      observation: observation({ observationId: 'obs-2', taskId: 'task-2', facts: [{ key: 'hostname', value: 'host-b' }], evidenceRefs: ['EVD-2'] }),
      source: 'siem', now,
    });
    const decision = planNextStep({ run: run(), frontier, proposal: { kind: 'FINALIZE', reasonCode: 'ENOUGH', rationale: 'done' }, now });
    expect(decision.kind).toBe('BLOCKED');
    expect(decision.reasonCode).toBe('CONTRADICTORY_EVIDENCE');
  });

  it('blocks repeated actions and emits a deterministic outbox event', () => {
    const frontier = reduceEvidenceFrontier({ runId: 'run-1', caseId: 'case-1', observation: observation(), source: 'ide', now });
    const action = { target: 'siem' as const, action: 'search_siem' as const, riskLevel: 'read_only' as const, parameters: { indicator: 'host-a' } };
    const repeated = planNextStep({
      run: run(), frontier, previousActionFingerprints: [actionFingerprint(action)], now,
      proposal: { kind: 'DISPATCH', reasonCode: 'CORRELATE', rationale: 'correlate in SIEM', action },
    });
    expect(repeated.kind).toBe('BLOCKED');
    expect(repeated.reasonCode).toBe('REPEATED_ACTION');

    const decision = planNextStep({
      run: run(), frontier, now,
      proposal: { kind: 'DISPATCH', reasonCode: 'CORRELATE', rationale: 'correlate in SIEM', action },
    });
    const event = createControlOutboxEvent(decision);
    expect(event.eventType).toBe('TASK_DISPATCH_REQUESTED');
    expect(event.eventHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createControlOutboxEvent(decision)).toEqual(event);
  });

  it('fails closed when a bounded budget is exhausted', () => {
    const frontier = reduceEvidenceFrontier({ runId: 'run-1', caseId: 'case-1', observation: observation(), source: 'ide', now });
    const decision = planNextStep({
      run: run({ depth: 5 }), frontier, now,
      proposal: { kind: 'FINALIZE', reasonCode: 'DONE', rationale: 'done' },
    });
    expect(decision.kind).toBe('BLOCKED');
    expect(decision.reasonCode).toBe('DEPTH_EXHAUSTED');
  });
});
