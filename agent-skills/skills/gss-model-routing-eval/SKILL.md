---
name: gss-model-routing-eval
description: Implement or evaluate GSS M8 risk-aware model routing, token/latency/cost accounting, retry policy, budget enforcement, and no-silent-downgrade behavior. Use when changing model tiers, router decisions, provider handling or routing evals; not to grant models evidence or approval authority.
---

# GSS Model Routing Evaluation

## Purpose

Make model selection measurable and policy-driven while preserving evidence, permission and security boundaries.

## Trigger / Do not trigger

Use for router implementation, policy changes, cost/token ledger or model evals. Do not use merely because a task happens to call a model when routing policy is unchanged.

## Required inputs and preconditions

- Task class, risk, complexity/volume signals and budget.
- Candidate models/providers and supported parameters.
- PostgreSQL ledger schema or explicit design task.

Read [security boundaries](../../references/security-boundaries.md), [evidence policy](../../references/evidence-policy.md) and [definition of done](../../references/definition-of-done.md).

## Allowed tools and data boundaries

Use provider fixtures/mocks for CI. Paid/external calls require explicit scope and valid credentials. Persist metadata and usage; do not persist secrets or unrestricted prompts.

## Ordered process

1. Classify task type, risk and volume deterministically.
2. Select model/tier with a reason code and policy version.
3. Refuse silent downgrade for security/high-risk work.
4. Apply bounded timeout and retry only transient failures.
5. Record provider result, model, tokens, latency, retry count and cost status.
6. Keep unknown price/cost as `NULL`/`UNKNOWN`.
7. Compare routing behavior against baseline eval cases and report safety failures separately.

## Stop / BLOCKED conditions

Unknown risk, unsupported model/parameter, missing high-risk tier or exceeded hard budget stops the call as `BLOCKED`. Authentication, permission, invalid request and exhausted bounded retries return `FAILED`; they do not activate a silent fallback.

## Forbidden actions

- No invented token counts or prices.
- No silent provider/model fallback for high-risk work.
- No model-created evidence, approvals, permissions or execution claims.
- No production credential exposure in eval fixtures or reports.

## Evidence output contract

Record task/case, policy version, classification, selected model/tier, reason code, provider status, input/output tokens, latency, retries, cost value/status and eval assertion results.

## Verification

Test all routing classes, boundaries, quota/timeout/transient/auth failures, unknown cost, budget exhaustion, adversarial prompts and high-risk downgrade attempts. Compare with baseline and finish with `gss-verification-gate`.
