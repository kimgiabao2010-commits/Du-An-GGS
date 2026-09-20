# GSS implementation report — Codex / GPT-6 Astra

Date: 2026-09-20

Architecture authority: `GSS_Architecture_Conversation_Notes_Updated.docx`

Decision owner for this implementation: Codex / GPT-6 Astra (high)

## Executive outcome

GSS now has a working evidence-first vertical slice instead of a dashboard-only flow:

`Standalone SOC -> structured task -> bounded worker -> artifact/evidence -> deterministic verdict -> PostgreSQL state/audit`

PostgreSQL is the only durable runtime database. SQLite is not used. If `DATABASE_URL` is absent, the local runtime reports persistence-degraded status explicitly; it never silently switches databases.

The main UI is now the Standalone SOC investigation workspace. Control-plane pages are secondary operational views. The browser receives case/task state and evidence references, not invented success messages.

## Implemented architecture

### Stable task and result contracts

- Added versioned `gss.task.v1` and `gss.result.v1` contracts.
- Added case state machine, target, risk, capability and observation-pack types.
- Added idempotency keys and case/task correlation.
- Worker identity must match the pending task before a result is accepted.
- CLI capability and resolved command must match exactly.

### PostgreSQL runtime persistence

- Added durable cases, messages, tasks, executions, observation packs, Chronicle query runs, investigation evidence and verdicts.
- Result, evidence, verdict, task state and audit event are committed transactionally.
- Existing durable two-person approval store remains artifact-hash-bound with expiry and requester separation.
- Added an ordered migration runner and `002_runtime_vertical_slice.sql`.

### Evidence and context boundary

- Raw worker output is stored as a write-once filesystem artifact with a SHA-256 digest.
- The model-facing observation pack is bounded and summarized.
- Evidence references are returned only for completed work.
- Provider failures, timeouts, authorization failures and invalid queries cannot become evidence.
- The existing context budgeter continues to quarantine prompt injection, redact secrets and prune oversized input.

### Google Chronicle read-only adapter

- Added a dedicated SIEM worker instead of placing SIEM access inside the IDE agent.
- Uses UDM Search v1 with predefined templates for IP, domain, hash, user and hostname.
- Uses Google Application Default Credentials / Workload Identity; no browser credential and no API key path.
- Enforces HTTPS Google Chronicle endpoints, a seven-day maximum window, bounded result count and timeout.
- Retries rate limiting once with a bounded delay.
- Normalizes event IDs, query hash, source instance, time range, result count, truncation and redaction state.
- Persists only explicit allowlisted UDM fields.

### Correlation and verdict v1

- Verdicts are deterministic and policy-versioned.
- Empty results produce `INSUFFICIENT_EVIDENCE`.
- Two distinct high/critical matching events are required for `CONFIRMED`.
- Explicit low/informational allowed findings can be `BENIGN`; other matching events remain `SUSPICIOUS`.
- Every verdict links to an evidence ID. The LLM does not create evidence or approve actions.

### Local runtime and UI

- `Ctrl+Shift+B` remains the default VS Code build task and starts Command Center, CLI worker, IDE agent, SIEM worker and the production-built Next.js UI.
- Uses `npm.cmd`, avoiding the constrained-language `npm.ps1` failure on Windows.
- Local production login is permitted only on loopback when `ASQ_LOCAL_RUNTIME=true`.
- The launcher prints generated local credentials when no strong configured password exists.
- Grafana moved to port 3002 to avoid the UI port collision.

## Validation completed

- TypeScript typecheck: passed.
- Next.js production build: passed; 16 static/dynamic routes generated.
- Unit tests: 32 passed, including 9 Chronicle adapter tests.
- Integration tests: 31 passed, including real WebSocket authorization and structured task/result flow.
- Component smoke test: passed.
- `git diff --check`: passed.

The tests cover Chronicle success, allowlist redaction, malformed indicators, range/limit bounds, timeout, 400, 401, 403, 429 and 5xx fail-closed behavior. They do not make paid provider calls.

## How to run

1. Create the PostgreSQL database/user and set `DATABASE_URL` in `.env`.
2. Run `npm.cmd run db:migrate` once.
3. Set the four `GSS_CHRONICLE_*` values and configure Google ADC for a viewer-only identity when Chronicle staging is available.
4. Stop any old process holding ports 3000 or 4000.
5. In VS Code press `Ctrl+Shift+B` and open `http://localhost:3000`.

Useful checks:

```powershell
npm.cmd run dev:check
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Configuration still required outside the repository

- PostgreSQL credentials: PostgreSQL 18 is running locally, but no non-interactive password is available to Codex. No credential was guessed or overwritten.
- Chronicle staging project, location, instance, endpoint and viewer-only ADC identity.
- A permitted staging dataset and agreed retention/timezone.

## Honest remaining production gaps

This is not yet a production closed loop. The following work remains deliberately closed or blocked:

- The IDE worker still needs a real read-only repository investigation implementation.
- The current host CLI executor is suitable only for the narrow read-only allowlist; Docker/Linux sandbox enforcement for patch/build/test is not complete.
- GitOps PR creation, deployment canary metrics and rollback adapters are not connected.
- IdP/MFA, session revocation, TLS/mTLS and incident ACL are not complete.
- A real Chronicle staging E2E cannot be claimed until credentials and a permitted dataset exist.
- Docker is not installed on this workstation, so container sandbox adversarial tests were not run.
- `npm audit` currently reports 10 dependency findings: 6 moderate, 2 high and 2 critical. No breaking `--force` upgrade was applied automatically.

No remediation, SIEM writeback, merge or deployment was enabled by this change.

## Model routing recommendation

- `gpt-5.6-luna`, medium: high-volume classification, log triage and repetitive preprocessing.
- `gpt-5.6-terra`, medium: routine implementation, tests, refactoring and ordinary investigations.
- `gpt-6-astra`, high: architecture, security boundary review, orchestration design and high-impact changes.

The model is a reasoning dependency, not an authority source: it cannot create evidence, grant permission, approve an artifact or bypass policy.
