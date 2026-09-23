# GSS Block 2 Report — Codex / GPT-5.6 Sol High

**Date:** 2026-09-23

**Scope:** M5 IDE read-only investigation vertical slice

## Outcome

M5 is implemented and verified as a local evidence-producing vertical slice:

`Standalone → gss.task.v1 → authenticated IDE worker → bounded repository collection → immutable SHA-256 artifact → ObservationPack → validated gss.result.v1 → RuntimeStore`

The implementation is deliberately read-only. It does not patch files, invoke a shell, access Chronicle, use network tools or fall back to an unrestricted host executor.

## Implementation

### Read-only investigator

`services/ide-reasoning/src/readonly-investigator.ts` now:

- accepts only `search_code` and `analyze_code` with `riskLevel=read_only`;
- requires configured repository roots;
- canonicalizes the requested path and rejects absolute paths, traversal and direct symlinks;
- skips symlinks encountered during traversal;
- excludes `.git`, `node_modules`, build/cache outputs, `.env`, credential/private-key files and non-allowlisted file types;
- rejects credential-like search values;
- reads files through Node filesystem APIs without shell execution;
- bounds directories, files, per-file bytes, total bytes, matches, excerpts, output and timeout;
- skips binary/invalid UTF-8 input;
- redacts common secret patterns and quarantines instruction-like text inside source data;
- returns only relative file coordinates and a hash-derived repository identity;
- completes a no-match search with zero facts instead of inventing findings.

### Worker boundary

`IdeInvestigatorDaemon` now:

- handles only typed IDE tasks from Standalone;
- enforces a two-task concurrency ceiling;
- rejects replayed task IDs;
- aborts in-flight work on kill-switch/stop;
- reports `BLOCKED`, `FAILED` or `CANCELLED` without reinterpreting failures as success.

### Control-plane validation

The SDK defines `gss.ide-investigation.v1` and validates:

- task/case/action binding;
- repository-root identifier format;
- relative safe paths;
- bounded query terms, match count and excerpts;
- non-negative collection metrics;
- explicit redaction and truncation state.

Command Center downgrades a worker `SUCCESS` to `INVALID_RESULT` unless this record exists and matches the pending task, case and action. Invalid results receive no evidence references.

### Runtime integration

- The IDE result is retained in the structured `gss.result.v1` payload.
- Command Center stores the bounded worker output once through `FilesystemArtifactStore` with SHA-256.
- An ObservationPack references the artifact and resulting evidence ID.
- `RuntimeStore.recordResult()` remains the durable PostgreSQL transaction boundary when `DATABASE_URL` is configured.
- `Ctrl+Shift+B` configures the current repository as the default IDE allowlisted root.
- `.env.example` documents explicit root and resource limits.

## Verification evidence

| Gate | Status | Evidence |
|---|---|---|
| IDE focused tests | PASS | 13 investigator tests plus daemon replay test |
| SDK contract test | PASS | Valid record accepted; count mismatch and traversal path rejected |
| Real WebSocket M5 path | PASS | Standalone dispatch, IDE result, artifact, ObservationPack and correlated RuntimeStore result |
| Invalid worker success | PASS | Missing investigation record becomes `INVALID_RESULT`, `FAILED`, zero evidence refs |
| Restart idempotency | PASS | Replayed request after orchestrator restart creates no second task |
| Typecheck | PASS | Root and Next.js TypeScript checks exit 0 |
| Full unit suite | PASS | 49 tests across SDK, auth, CLI, guardrails, SIEM and IDE |
| Full integration suite | PASS | 34 tests, including 3 real WebSocket IDE-worker cases |
| Component smoke | PASS | Runtime smoke completed without claiming SIEM, deployment or sandbox coverage |
| Production build | PASS | Turbo completed 5/5 package builds; Next.js generated 16/16 pages |
| Skill audit | PASS | 6 skills and 3 eval files validated; skill bodies total about 4,180 tokens |
| Live PostgreSQL persistence | BLOCKED | `DATABASE_URL` is not configured in the current environment |
| Live browser/Ctrl+Shift+B walkthrough | BLOCKED | Ports 3000 and 4000 are occupied by an existing local stack |

## Security cases covered

- path traversal;
- absolute/non-allowlisted root selection;
- direct symlink escape and traversal symlink skipping;
- `.env`, credential/private-key and dependency/cache paths;
- binary and oversized files;
- bounded match/output truncation;
- prompt-injection-like source text;
- common inline secret patterns;
- credential-like search terms;
- cancellation and timeout semantics;
- malformed/mismatched worker result;
- worker task replay and orchestrator restart replay.

## Honest limitations

- `analyze_code` currently produces deterministic source matches and collection metadata. It does not claim semantic security reasoning beyond collected evidence.
- The live PostgreSQL write path was not exercised because the required connection is absent. The RuntimeStore contract path is exercised with an in-memory test store.
- The existing local stack on ports 3000/4000 may still be running the pre-M5 code until it is stopped and restarted.
- This is not a sandbox and does not authorize patching, remediation, SIEM writeback, merge or deployment.

## Next block

Block 3 can build M6 deterministic evidence-next-step planning on top of the validated M5 result. It must preserve the same task/evidence identity, idempotency and fail-closed rules.
