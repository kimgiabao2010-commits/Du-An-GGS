import { describe, expect, it } from 'vitest';
import { ModelTieringRouter } from '../src/router/model-router.ts';
import { FinOpsGuardrail } from '../../../packages/guardrails/src/finops/token-bucket.ts';

describe('ModelTieringRouter', () => {
  it('does not silently downgrade critical analysis when quota is constrained', () => {
    const budget = new FinOpsGuardrail(5, 0, 10);
    expect(() => new ModelTieringRouter(budget).routeToModel('CRITICAL')).toThrow(/defer or escalate/);
  });
  it('rejects unknown severity instead of assuming a low-risk alert', () => {
    expect(() => new ModelTieringRouter().routeToModel('MISSING')).toThrow(/human triage/);
  });
  it('blocks when request quota is exhausted and cannot be credited by negative usage', () => {
    const budget = new FinOpsGuardrail(1, 0, 1);
    const router = new ModelTieringRouter(budget);
    expect(budget.consume(-1)).toBe(false);
    router.routeToModel('LOW');
    expect(() => router.routeToModel('LOW')).toThrow(/quota exhausted/);
  });
  it('routes high-volume low-severity triage to Luna', () => {
    expect(new ModelTieringRouter().routeToModel('LOW')).toBe('gpt-5.6-luna');
  });

  it('routes standard investigations to Terra', () => {
    expect(new ModelTieringRouter().routeToModel('MEDIUM')).toBe('gpt-5.6-terra');
  });

  it('routes high-risk investigations to Astra', () => {
    expect(new ModelTieringRouter().routeToModel('CRITICAL')).toBe('gpt-6-astra');
  });
});
