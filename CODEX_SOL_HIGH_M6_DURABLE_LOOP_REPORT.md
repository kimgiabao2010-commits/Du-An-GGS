# GSS M6 Durable Investigation Loop — Codex Sol High

Date: 2026-09-27

## Outcome

The first executable M6 vertical slice is implemented. GSS now has versioned investigation-run, evidence-frontier, next-step, model-usage, and control-outbox contracts; deterministic evidence reduction and planning; PostgreSQL schema and transaction support; and a bounded read-only multi-step runtime loop.

This is an engineering-MVP increment, not a production-readiness claim.

The authoritative requirement matrix and additional hard gates are maintained in
`CODEX_SOL_HIGH_GOAL_CONDITIONS.md`.

## Implemented

- Added versioned contracts:
  - `gss.investigation-run.v1`
  - `gss.evidence-frontier.v1`
  - `gss.next-step.v1`
  - `gss.model-usage.v1`
  - `gss.control-outbox.v1`
- Added canonical JSON hashing and stable action fingerprints.
- Added an evidence reducer that:
  - deduplicates equivalent facts;
  - preserves independent provenance;
  - retains contradictory facts;
  - refuses observations without a verified evidence reference.
- Added a deterministic planner that enforces:
  - read-only auto-dispatch;
  - repeated-action protection;
  - depth, deadline, external-query, and cost budgets;
  - contradiction blocking before finalization.
- Added PostgreSQL migration `003_investigation_loop.sql` for:
  - `investigation_runs`;
  - `evidence_frontiers`;
  - `next_step_decisions`;
  - `control_outbox`;
  - `model_usage`;
  - task-to-run and parent-task linkage.
- Made result, observation, frontier, decision, outbox, and audit persistence atomic in one PostgreSQL transaction.
- Added replay handling keyed by `(run_id, observation_id)` and one decision per frontier version.
- Added outbox lease, retry, release, and publish primitives.
- Added startup outbox recovery: unpublished dispatch events are leased, rebuilt against the exact frontier version,
  redelivered idempotently, and published only after a connected worker accepts the task.
- Hardened the next durable-approval increment:
  - request identity is deterministic and idempotent;
  - approval binds case, action, canonical parameters, artifact hash, policy version, requester, and expiry;
  - requester self-approval and artifact mutation fail closed;
  - two distinct approvers only produce `APPROVED_FOR_PROPOSAL`, never merge or deployment authority.
- Added a bounded host-triage chain:
  - `inspect_hostname`;
  - `inspect_system`;
  - `inspect_network_config`;
  - `inspect_network_connections`;
  - deterministic finalization.
- Added SIEM evidence/verdict validators. A malformed or uncorrelated SIEM `SUCCESS` is converted to `INVALID_RESULT` and cannot enter the frontier.
- Added migration checksums. Editing an already-applied migration now fails closed.
- Made PostgreSQL mandatory for Ctrl+Shift+B runtime. The launcher runs migrations and builds every runtime package
  plus the production UI before starting services, so a clean clone does not depend on stale local `dist` files.
- Added persistence tests to the root unit-test gate.

## Verification evidence

- Root typecheck: `PASS`.
- Full workspace build, including Next.js production build: `PASS`.
- Unit tests: `PASS` across seven packages.
- SDK: 14 tests passed.
- Persistence transaction and approval tests: 7 tests passed.
- Integration: 41 tests passed, including a four-step WebSocket closed loop and restart recovery of an unpublished dispatch.
- Smoke test: `PASS` for local components.
- Launcher dry-run with a supplied database URL: `PASS`.

## Explicitly blocked or not run

- Live PostgreSQL migration: `BLOCKED` because `.env` has no `DATABASE_URL` and the local PostgreSQL server requires a password. No password was read, guessed, or written.
- Chronicle staging E2E: `BLOCKED` because the required `GSS_CHRONICLE_*` coordinates and viewer identity are absent.
- Docker/rootless sandbox and adversarial container tests: `NOT RUN`; Docker is not installed on this host.
- Production identity, mTLS, object-lock artifact storage, GitOps, canary, and rollback remain outside this completed increment.

## Next executable step

Add a valid PostgreSQL connection URL to `.env`, press Ctrl+Shift+B, and let the launcher apply migrations automatically. The next engineering block should run the restart/replay suite against live PostgreSQL, then add a durable queue adapter before Chronicle staging is enabled.
