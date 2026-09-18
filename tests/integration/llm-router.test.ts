import { afterEach, describe, expect, it, vi } from 'vitest';
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ OpenAI: class {
  chat = { completions: { create } };
} }));
import { LlmRouter } from '../../services/standalone/src/agent/llm-router.ts';

afterEach(() => { vi.unstubAllEnvs(); create.mockReset(); });
describe('LLM adapter contract (provider mocked, no paid requests)', () => {
  it('does not fabricate success when the provider fails', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'unit-test-only');
    create.mockRejectedValue(new Error('sensitive provider detail'));
    const result = await new LlmRouter().routePrompt('hello');
    expect(result.agent).toBe('system');
    expect(result.instruction).toContain('LLM_UNAVAILABLE');
    expect(result.instruction).not.toContain('sensitive provider detail');
  });
  it('refuses non-string tool instructions', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'unit-test-only');
    create.mockResolvedValue({ choices: [{ message: { tool_calls: [{ function: {
      name: 'delegate_cli', arguments: JSON.stringify({ target_instruction: { command: 'hostname' } })
    } }] } }] });
    expect((await new LlmRouter().routePrompt('hostname')).agent).toBe('system');
  });
  it('parses a valid delegation without executing it', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'unit-test-only');
    create.mockResolvedValue({ choices: [{ message: { tool_calls: [{ function: {
      name: 'delegate_cli', arguments: JSON.stringify({ target_instruction: 'hostname' })
    } }] } }] });
    expect(await new LlmRouter().routePrompt('hostname')).toEqual({ agent: 'cli', instruction: 'hostname' });
  });
});
