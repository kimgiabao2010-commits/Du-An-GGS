import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASQClient } from '../src/asq-client.js';

// Mock ws
vi.mock('ws', () => {
  return {
    WebSocket: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1 // OPEN
    }))
  };
});

describe('ASQClient Core SDK', () => {
  let client: ASQClient;

  beforeEach(() => {
    client = new ASQClient({
      wsUrl: 'ws://mock-server',
      token: 'fake-jwt-token'
    });
    client.connect();
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

  it('should submit patch via gRPC mock fallback', async () => {
    const result = await client.grpc.submitPatch('rule-1', 'test.js', Buffer.from('diff'));
    // Vì gRPC đang chạy ở mode không có server thật, client sẽ fallback về object mock success
    expect(result.success).toBe(true);
    expect(result.patch_hash).toBeDefined();
  });
});
