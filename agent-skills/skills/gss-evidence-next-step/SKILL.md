---
name: gss-evidence-next-step
description: Implement, review, or verify GSS M6 deterministic planning of one bounded follow-up task from validated evidence or worker results. Use for next-action policy, idempotency, depth/budget limits, loop prevention, capability validation, and automatic task scheduling; not for free-form autonomous remediation.
---

# GSS Evidence Next Step

## Purpose

Schedule a useful second investigation task from real evidence while preventing loops, duplicate work and policy bypass.

## Trigger / Do not trigger

Use after a validated result/evidence record needs a follow-up investigation. Do not use when evidence is absent, for conversational suggestions only, or for write/remediation actions.

## Required inputs and preconditions

- Persisted case state and terminal task result.
- Evidence or result hash with provenance.
- Capability registry, policy version and remaining task/depth budget.

Read [task/result contracts](../../references/task-result-contracts.md), [evidence policy](../../references/evidence-policy.md) and [security boundaries](../../references/security-boundaries.md).

## Allowed tools and data boundaries

Deterministic rules select from existing read-only capabilities. An LLM may propose an intent but cannot dispatch, extend capabilities or assert execution.

## Ordered process

1. Validate result identity, status, evidence references and case state.
2. Evaluate deterministic policy before any model suggestion.
3. Reject repeated action/indicator/query hashes and completed branches.
4. Enforce automatic-task and depth budgets.
5. Select at most one read-only follow-up capability.
6. Derive idempotency from case, evidence/result hash, capability and policy version.
7. Persist the task before dispatch and audit the policy reason.

## Stop / BLOCKED conditions

Missing evidence/provenance, ambiguous target, exhausted budget, detected loop or unsupported capability must stop without dispatch. Write/high-risk actions move to `WAITING_APPROVAL` or `BLOCKED`. A persistence or authorized dispatch attempt that errors returns `FAILED` and must not be treated as a created task.

## Forbidden actions

- No unlimited recursive planning or multiple speculative tasks.
- No capability invented by a model.
- No evidence synthesized to justify a follow-up.
- No remediation, SIEM writeback, merge or deployment.

## Evidence output contract

Record input evidence/result reference, selected capability, policy version/reason code, depth/budget before and after, idempotency key, created/not-created outcome and dispatch status.

## Verification

Test one valid follow-up, replay, duplicate idempotency, loop, missing evidence, unsupported/high-risk action, exhausted depth/budget, concurrent results and restart recovery. Finish with `gss-verification-gate`.
