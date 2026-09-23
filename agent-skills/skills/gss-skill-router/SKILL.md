---
name: gss-skill-router
description: Route multi-step GSS architecture, implementation, investigation, approval, model-routing, or verification work to the smallest applicable GSS workflow. Use when a GSS task spans components or its milestone, authority, scope, dependencies, or risk are not already explicit.
---

# GSS Skill Router

## Purpose

Select one primary GSS skill and expose the assumptions, scope, dependencies and risk before implementation starts.

## Trigger / Do not trigger

Use for multi-step or cross-component GSS work. Do not use for an obvious one-file edit or a simple factual question with no workflow decision.

## Required inputs and preconditions

- User objective and latest explicit constraints.
- Relevant repository state and milestone.
- Known external prerequisites.

Read [architecture authority](../../references/architecture-authority.md) when components or documents conflict. Read [security boundaries](../../references/security-boundaries.md) when access, identity, automation or external providers are involved.

## Allowed tools and data boundaries

Use read-only inspection to classify the task. Routing does not authorize deployment, external writes, credential changes or destructive repository operations.

## Ordered process

1. State the objective in one sentence.
2. Resolve authority and identify M0–M8 scope.
3. Surface only assumptions that can change the implementation.
4. Map dependencies and choose one primary skill:
   - repository investigation → `gss-ide-readonly-investigation`;
   - evidence-driven follow-up → `gss-evidence-next-step`;
   - approval durability → `gss-durable-approval`;
   - model policy/evaluation → `gss-model-routing-eval`.
5. Add `gss-verification-gate` as the completion workflow.
6. Record excluded scope and external blockers.

## Stop / BLOCKED conditions

Return `BLOCKED` when authority, target environment or permission is contradictory and the choice would materially change the result. Return `FAILED` when required repository inspection or workflow validation was attempted but errored. Do not guess around missing production/staging access.

## Forbidden actions

- Do not invoke every skill for completeness.
- Do not convert roadmap aspirations into verified status.
- Do not expand read-only work into remediation or deployment.
- Do not treat model choice as runtime authorization.

## Evidence output contract

Output the selected primary skill, milestone, assumptions, dependencies, risk, excluded scope, external blockers and expected verification evidence.

## Verification

Confirm exactly one primary skill is selected, all material dependencies are named and the selected workflow can produce observable evidence.
