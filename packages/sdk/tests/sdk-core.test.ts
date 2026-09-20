import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASQClient } from '../src/asq-client.js';
import { ASQgRPCClient } from '../src/transport/grpc-client.ts';
import { isGssTaskContract, TASK_SCHEMA_VERSION } from '../src/runtime/contracts.ts';
import { correlateEvidence } from '../src/investigation/correlation.ts';

// Mock ws
vi.mock('ws', () => {
  const WebSocket = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1 // OPEN
  }));
  Object.assign(WebSocket, { OPEN: 1 });

  return {
    WebSocket
  };
});

describe('ASQClient Core SDK', () => {
  let client: ASQClient;

  beforeEach(() => {
    client = new ASQClient({
      wsUrl: 'ws://mock-server',
      token: 'fake-jwt-token',
      grpcMode: 'mock'
    });
    client.ws.connect();
  });

  it('should initialize all ASQ modules', () => {
    expect(client.ws).toBeDefined();
    expect(client.grpc).toBeDefined();
    expect(client.security).toBeDefined();
    expect(client.rule).toBeDefined();
    expect(client.autonomy).toBeDefined();
    expect(client.blast).toBeDefined();
  });

  it('should trigger kill-switch via security module', () => {
    const publishSpy = vi.spyOn(client.ws, 'publish');
    client.security.triggerKillSwitch('PRODUCTION', '123456');
    
    expect(publishSpy).toHaveBeenCalledWith('security:kill-switch', {
      environment: 'PRODUCTION',
      otp: '123456'
    });
  });

  it('should set autonomy level properly', () => {
    const publishSpy = vi.spyOn(client.ws, 'publish');
    client.autonomy.setLevel('L4', ['admin-1', 'admin-2']);
    
    expect(publishSpy).toHaveBeenCalledWith('autonomy:set', {
      level: 'L4',
      approvers: ['admin-1', 'admin-2']
    });
  });

  it('should submit a patch only when an explicit mock client is selected', async () => {
    const grpc = new ASQgRPCClient('mock://asq', 'mock');
    grpc.connect();
    const result = await grpc.submitPatch('rule-1', 'test.js', Buffer.from('diff'));
    expect(result.success).toBe(true);
    expect(result.patch_hash).toBeDefined();
  });

  it('validates the stable task contract envelope', () => {
    const task = {
      schemaVersion: TASK_SCHEMA_VERSION,
      taskId: 'task-1', caseId: 'case-1', idempotencyKey: 'request-1', source: 'standalone',
      target: 'cli', action: 'inspect_hostname', parameters: {}, riskLevel: 'read_only',
      contextRefs: [], timeoutMs: 15000, createdAt: new Date().toISOString(),
    };
    expect(isGssTaskContract(task)).toBe(true);
    expect(isGssTaskContract({ ...task, riskLevel: 'approval_required' })).toBe(false);
  });

  it('never confirms an empty evidence set', () => {
    const verdict = correlateEvidence({ evidenceId: 'E-1', incidentId: 'C-1', taskId: 'T-1', eventIds: [], events: [],
      provenance: { adapter: 'google-chronicle', adapterVersion: 'v1', queryHash: 'hash', sourceInstance: 'instance',
        queriedAt: new Date().toISOString(), timeRange: { start: new Date(0).toISOString(), end: new Date(1).toISOString() },
        resultCount: 0, truncated: false, redaction: 'ALLOWLISTED_FIELDS_ONLY' } });
    expect(verdict.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(verdict.evidenceIds).toEqual(['E-1']);
  });
});
