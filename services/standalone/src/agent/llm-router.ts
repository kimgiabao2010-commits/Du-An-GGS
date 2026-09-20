import { OpenAI } from 'openai';
import { ContextBudgeter } from '@asq/guardrails';
import type { CapabilityAction, TaskTarget } from '@asq/sdk';

export interface RouterDecision {
  agent: 'chat' | 'system' | TaskTarget;
  instruction: string;
  action?: CapabilityAction;
  parameters?: Record<string, unknown>;
}

const deterministicIntents: Array<{ patterns: RegExp[]; action: CapabilityAction; instruction: string }> = [
  { patterns: [/\bhostname\b/i, /t[eê]n m[aá]y/i], action: 'inspect_hostname', instruction: 'hostname' },
  { patterns: [/\bsysteminfo\b/i, /th[oô]ng tin h[eệ] th[oố]ng/i], action: 'inspect_system', instruction: 'systeminfo' },
  { patterns: [/\bipconfig\b/i, /c[aấ]u h[iì]nh m[aạ]ng/i], action: 'inspect_network_config', instruction: 'ipconfig /all' },
  { patterns: [/\bnetstat\b/i, /k[eế]t n[oố]i m[aạ]ng/i], action: 'inspect_network_connections', instruction: 'netstat -ano' },
];

function deterministicSiemIntent(prompt: string): RouterDecision | null {
  if (!/\b(?:chronicle|siem|investigat(?:e|ion)|điều tra|truy vấn)\b/i.test(prompt)) return null;
  const ip = prompt.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
  const hash = prompt.match(/\b(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40}|[a-fA-F0-9]{32})\b/)?.[0];
  const domain = prompt.match(/\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}\b/)?.[0];
  const indicatorValue = ip ?? hash ?? domain;
  const indicatorType = ip ? 'IP' : hash ? 'HASH' : domain ? 'DOMAIN' : null;
  if (!indicatorValue || !indicatorType) return null;
  const end = new Date();
  const start = new Date(end.valueOf() - 24 * 60 * 60 * 1000);
  return { agent: 'siem', action: 'search_siem', instruction: `Search Chronicle for ${indicatorType}`,
    parameters: { indicatorType, indicatorValue, startTime: start.toISOString(), endTime: end.toISOString(), limit: 100 } };
}

export class LlmRouter {
  private openai: OpenAI | null;
  private contextBudgeter = new ContextBudgeter({ maxTokens: Number(process.env.ASQ_CONTEXT_MAX_TOKENS ?? 4096) });
  private modelName = process.env.ASQ_ROUTER_MODEL || (process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-5.6-luna');

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
    this.openai = apiKey ? new OpenAI({
      apiKey,
      ...(process.env.OPENAI_API_KEY ? {} : { baseURL: 'https://api.groq.com/openai/v1' }),
      timeout: 20_000,
      maxRetries: 0,
    }) : null;
  }

  public async routePrompt(prompt: string): Promise<RouterDecision> {
    const deterministic = deterministicIntents.find(intent => intent.patterns.some(pattern => pattern.test(prompt)));
    if (deterministic) return { agent: 'cli', action: deterministic.action, instruction: deterministic.instruction, parameters: {} };
    const siemIntent = deterministicSiemIntent(prompt);
    if (siemIntent) return siemIntent;

    if (!this.openai) return {
      agent: 'system',
      instruction: 'LLM_UNAVAILABLE: Configure OPENAI_API_KEY or GROQ_API_KEY. No worker task was dispatched.',
    };

    try {
      const context = this.contextBudgeter.prepare(prompt);
      console.info(`[LlmRouter] Context ${context.inputTokenEstimate} -> ${context.outputTokenEstimate} tokens; ` +
        `pruned=${context.omittedCharacters} quarantined=${context.quarantinedFragments} redacted=${context.redactedSecrets}`);

      const response = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content: `You are the conversation and intent-routing layer for GSS Standalone, an evidence-first SOC cockpit.
Talk naturally when no execution is required. When evidence must be collected, request one intent-level tool action.
Never invent observations, evidence, worker success, permissions, approval, SIEM results, or remediation.
CLI actions are read-only. IDE actions are analysis-only. High-risk actions are not available in this interface.`,
          },
          { role: 'user', content: context.modelInput },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'delegate_cli',
              description: 'Collect read-only host evidence using an approved capability.',
              parameters: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['inspect_hostname', 'inspect_system', 'inspect_network_config', 'inspect_network_connections'] },
                },
                required: ['action'],
                additionalProperties: false,
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'delegate_siem',
              description: 'Search Google Chronicle read-only for one validated indicator and bounded time range.',
              parameters: {
                type: 'object',
                properties: {
                  indicatorType: { type: 'string', enum: ['IP', 'DOMAIN', 'HASH', 'USER', 'HOSTNAME'] },
                  indicatorValue: { type: 'string', maxLength: 256 },
                  startTime: { type: 'string', description: 'ISO-8601 timestamp' },
                  endTime: { type: 'string', description: 'ISO-8601 timestamp' },
                  limit: { type: 'integer', minimum: 1, maximum: 1000 },
                },
                required: ['indicatorType', 'indicatorValue', 'startTime', 'endTime'],
                additionalProperties: false,
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'delegate_ide',
              description: 'Perform read-only repository or configuration analysis.',
              parameters: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['analyze_code', 'search_code'] },
                  question: { type: 'string', maxLength: 4000 },
                },
                required: ['action', 'question'],
                additionalProperties: false,
              },
            },
          },
        ],
        reasoning_effort: 'medium',
        temperature: 0.2,
        max_tokens: 1200,
      });

      const message = response.choices[0]?.message;
      const toolCall = message?.tool_calls?.[0];
      if (toolCall?.type === 'function') {
        const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        const action = args.action as CapabilityAction;
        if (toolCall.function.name === 'delegate_cli') {
          const intent = deterministicIntents.find(item => item.action === action);
          if (!intent) throw new Error('Unsupported CLI capability');
          return { agent: 'cli', action, instruction: intent.instruction, parameters: {} };
        }
        if (toolCall.function.name === 'delegate_ide' && ['analyze_code', 'search_code'].includes(action)) {
          const question = typeof args.question === 'string' ? args.question.trim() : '';
          if (!question) throw new Error('Missing IDE analysis question');
          return { agent: 'ide', action, instruction: question, parameters: { question } };
        }
        if (toolCall.function.name === 'delegate_siem') {
          return { agent: 'siem', action: 'search_siem', instruction: 'Search Chronicle for a validated indicator',
            parameters: { indicatorType: args.indicatorType, indicatorValue: args.indicatorValue,
              startTime: args.startTime, endTime: args.endTime, limit: args.limit ?? 100 } };
        }
      }
      return { agent: 'chat', instruction: message?.content?.trim() || 'I need more context before I can continue safely.' };
    } catch {
      return { agent: 'system', instruction: 'LLM_UNAVAILABLE: Routing failed safely. No worker task was dispatched.' };
    }
  }
}
