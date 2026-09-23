---
name: gss-durable-approval
description: Implement, review, or verify GSS M7 PostgreSQL-backed dual approval bound to an incident, action, artifact hash, expiry, requester and policy version. Use for approval request/decision runtime integration and abuse tests; not as permission to execute remediation or deployment.
---

# GSS Durable Approval

## Purpose

Connect the existing durable approval store to runtime contracts without turning approval into automatic execution authority.

## Trigger / Do not trigger

Use for approval creation, decisions, state transitions and audit. Do not use for ordinary read-only tasks or to bypass missing deployment/remediation adapters.

## Required inputs and preconditions

- PostgreSQL connection and migrated approval tables.
- Incident, allowlisted action, artifact SHA-256, requester, expiry and policy version.
- Authenticated approver identities.

Read [security boundaries](../../references/security-boundaries.md) and [definition of done](../../references/definition-of-done.md). Inspect `packages/persistence/src/investigation-store.ts` before changing semantics.

## Allowed tools and data boundaries

Approval operations may mutate approval/audit state in PostgreSQL. They do not authorize Git, deployment, SIEM writeback or remediation side effects.

## Ordered process

1. Validate incident, action, hash format, expiry and requester.
2. Create one durable pending request and audit it.
3. Lock the request while recording a decision.
4. Reject requester self-approval, expired request and artifact mismatch.
5. Count distinct approvers; duplicate decisions are idempotent.
6. Mark approved only after two distinct eligible approvers.
7. Expose approval state to runtime while keeping execution as a separate policy step.

## Stop / BLOCKED conditions

Missing PostgreSQL, invalid identity, unknown action or missing artifact provenance → `BLOCKED`. Database errors → `FAILED`; do not fall back to memory.

## Forbidden actions

- No requester self-approval or duplicate-count inflation.
- No approval reuse after artifact/action/policy changes or expiry.
- No auto-merge, deploy, rollback or remediation on approval alone.
- No alternative in-memory or SQLite source of truth.

## Evidence output contract

Record approval ID, incident/action, artifact hash, policy version, requester, expiry, status, distinct approval count and audit event references. Do not expose secret credentials.

## Verification

Test one approver, two distinct approvers, duplicate approver, requester, expiry, artifact mutation, unknown request, restart durability, concurrent decisions and transaction failure. Finish with `gss-verification-gate`.
