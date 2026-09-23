---
name: gss-verification-gate
description: Verify GSS changes or milestone claims before completion, handoff, commit, PR, or release. Use after implementation, refactoring, contract or security changes to run the relevant skill audit, typecheck, tests, build, runtime checks, diff review and evidence-based PASS/FAILED/BLOCKED report.
---

# GSS Verification Gate

## Purpose

Prevent unverified completion claims and produce a compact report tied to commands and runtime evidence.

## Trigger / Do not trigger

Use before claiming implementation/milestone completion or publishing changes. For an early design discussion with no implementation claim, use the Definition of Done only to shape acceptance criteria.

## Required inputs and preconditions

- Defined scope and acceptance criteria.
- Changed-file inventory.
- Required environments and known external prerequisites.

Read [definition of done](../../references/definition-of-done.md). Also read [evidence policy](../../references/evidence-policy.md) for evidence-producing paths and [security boundaries](../../references/security-boundaries.md) for capability/identity changes.

## Allowed tools and data boundaries

Run non-destructive validation commands and scoped runtime checks. Do not deploy, migrate live data, call paid providers or rewrite user changes merely to obtain a green report.

## Ordered process

1. Map each acceptance criterion to an observable check.
2. Run `npm.cmd run skills:audit` when skills/references/evals changed.
3. Run focused tests, then typecheck, relevant full tests and build.
4. Run runtime/staging checks only where configured and authorized.
5. Review changed files and diff for scope, secrets and boundary regressions.
6. Classify every gate as `PASS`, `FAILED`, `BLOCKED` or `NOT RUN`.
7. Report exact blockers and avoid broader claims than the evidence supports.

## Stop / BLOCKED conditions

Required external configuration, credentials, service or permission missing → `BLOCKED`. A command that ran and failed → `FAILED`. Do not relabel either as success.

## Forbidden actions

- No deletion/reset of unrelated user changes.
- No mock/demo/model output presented as staging or production evidence.
- No skipped gate hidden from the report.
- No “overall ready” when a mandatory gate failed.

## Evidence output contract

For every gate include status, command/check, environment, exit/result summary and artifact/log reference when available. End with an overall status and remaining blockers.

## Verification

Check that all acceptance criteria map to evidence, all mandatory gates appear in the report and the overall status follows the worst mandatory gate.
