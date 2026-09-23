# GSS Task and Result Contracts

Read this reference when changing worker dispatch, task persistence, result handling, ObservationPacks or capability routing.

Authoritative code:

- `packages/sdk/src/runtime/contracts.ts`
- `packages/sdk/src/investigation/types.ts`
- `packages/persistence/src/runtime-store.ts`
- `packages/persistence/src/artifact-store.ts`

## Task contract

The runtime task schema is `gss.task.v1`. A valid task binds:

- `taskId`, `caseId` and a durable `idempotencyKey`;
- source `standalone` and one target: `cli`, `ide` or `siem`;
- one allowlisted capability action;
- structured parameters, risk level, context references and bounded timeout;
- creation timestamp.

Current runtime validation accepts read-only tasks. Expanding risk levels or capabilities requires explicit policy, persistence and test changes; changing a string alone is insufficient.

## Result contract

The runtime result schema is `gss.result.v1`. A result must bind:

- the original `taskId` and `caseId`;
- the authenticated executor identity;
- terminal status `COMPLETED`, `BLOCKED`, `FAILED` or `CANCELLED`;
- structured result data, evidence references, errors and duration/output metrics;
- completion timestamp.

Accept a result only when task, case, target/capability and worker identity agree. A worker message is not authoritative until validation and persistence succeed.

## ObservationPack

An ObservationPack is bounded model-facing context, not raw evidence. It contains stable identifiers, a concise summary, structured facts, evidence references, byte counts and creation time.

Store raw output once, hash it, and reference it. Preserve truncation and redaction metadata. Never reconstruct a missing raw artifact from an LLM summary.

## Persistence invariants

- `runtime_tasks.idempotency_key` is unique.
- A runtime execution is unique per task.
- Result, ObservationPack, relevant SIEM evidence/verdict and audit update belong in a transaction.
- Replayed task/result messages must not duplicate durable records.
- Missing `DATABASE_URL` means persistence-degraded or blocked behavior; it must not activate another database.
