---
name: gss-ide-readonly-investigation
description: Implement, review, or verify GSS M5 read-only repository and configuration investigation through the IDE worker. Use for search_code/analyze_code capabilities, repository-root confinement, bounded source collection, artifact creation, ObservationPacks, and IDE result persistence; not for patching or SIEM queries.
---

# GSS IDE Read-only Investigation

## Purpose

Deliver a real M5 vertical slice from Standalone task to bounded repository analysis, immutable artifact, ObservationPack, validated result and PostgreSQL state.

## Trigger / Do not trigger

Use when implementing or testing IDE `search_code`/`analyze_code`. Do not use for Chronicle searches, source modification, patch application or deployment.

## Required inputs and preconditions

- A `gss.task.v1` task targeting `ide` with a read-only capability.
- Configured canonical repository roots.
- Authenticated IDE worker identity and bounded limits.

Read [task/result contracts](../../references/task-result-contracts.md), [evidence policy](../../references/evidence-policy.md) and [security boundaries](../../references/security-boundaries.md) before changing runtime behavior.

## Allowed tools and data boundaries

The runtime capability may read allowlisted text files and invoke fixed read-only search commands through `execFile` without a shell. Development edits needed to implement the capability remain normal repository work; they do not expand the runtime capability.

## Ordered process

1. Validate schema, target, action, risk, worker identity and timeout.
2. Canonicalize the requested root/path and enforce root containment.
3. Deny secret, VCS, dependency/cache, binary and oversized targets.
4. Execute bounded search/analysis with fixed arguments.
5. Store raw output once with SHA-256.
6. Create a redacted, bounded ObservationPack with file/line facts and truncation metadata.
7. Return `gss.result.v1` and persist result/observation/audit transactionally.

## Stop / BLOCKED conditions

- Unsafe or escaped path → `BLOCKED`.
- Missing repository root or worker identity → `BLOCKED`.
- Timeout, process error or output limit failure → `FAILED`.
- No matches may complete with an empty factual result; do not invent findings.

## Forbidden actions

- No file writes, patching, shell interpolation, network access or host fallback.
- No `.env`, private key, credential, `.git`, dependency/cache or binary reads.
- No model-generated matches, hashes or line numbers.
- No SIEM credentials or Chronicle calls.

## Evidence output contract

Return task/case IDs, repository root identity, query/action, matched relative paths and line coordinates, artifact ref/hash, original/packed bytes, truncation/redaction state, duration and errors.

## Verification

Test success, no-match, traversal, symlink escape, secret path, binary/large file, timeout, output bound, replay/idempotency, wrong worker identity and PostgreSQL failure behavior. Finish with `gss-verification-gate`.
