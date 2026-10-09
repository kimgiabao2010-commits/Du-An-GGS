# GSS — Control Plane P0 Progress

Updated: 2026-10-02

Current closure evidence: [GSS_DAILY_CLOSURE_2026-10-02_CODEX.md](GSS_DAILY_CLOSURE_2026-10-02_CODEX.md). Earlier test counts below are historical, not the current final gate totals.

## Scope

P0 establishes the first durable Control Plane boundary for GSS. The service is loopback-only, PostgreSQL-backed, read-only by policy, and does not enable remediation, SIEM writeback, auto-merge, or auto-deploy.

## PASS

- Added `@asq/control-plane` as a separate workspace service.
- Added loopback HTTP authority on `127.0.0.1:4100`.
- Added `/livez` and `/readyz`.
- Added v1 task, result, frontier, approval, audit, and worker endpoints.
- Added action/target allowlist validation and read-only risk enforcement.
- Added idempotency payload fingerprinting; same request replays, different payload returns `409`.
- Exposed durable investigation run/frontier reads from persistence.
- Added Control Plane to the Ctrl+Shift+B launcher before Command Center and worker processes.
- Full-stack Command Center now uses the Control Plane HTTP client for task creation and result persistence; direct persistence remains only for standalone compatibility when `CONTROL_PLANE_URL` is absent.
- Full-stack Command Center now routes case creation, investigation-run creation, messages, and case-state transitions through the same authority.
- Full-stack Command Center now routes task status, outbox claim, publish, and release through the same authority.
- Updated the workspace lockfile.
- `tsc --project services/control-plane/tsconfig.json`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd run dev:check`: PASS.
- Control Plane HTTP client contract test: PASS.
- Integration suite: 50 tests PASS.
- PostgreSQL durable-loop test added; it runs when `DATABASE_URL` is present and is intentionally skipped only in local environments without PostgreSQL.
- Model usage ledger is now wired for real LLM calls, including success/failure, token counts, latency, route reason, retry count and configurable cost estimate.
- `.env.example` now documents `CONTROL_PLANE_URL`, `CONTROL_PLANE_PORT`, and configurable model cost rates.
- Added `npm run readiness` to report hard prerequisites without printing secrets or claiming live external verification.
- PostgreSQL live connectivity and durable-loop integration now PASS locally after correcting the partial-index conflict target.
- Mock sandbox success has been removed; sandbox execution is now fail-closed unless explicit Docker staging mode is enabled.
- Sandbox boundary tests pass for default blocking and command allowlist enforcement; Docker execution remains an external hard gate.
- Root integration runner now loads `.env`; `npm run test:integration` executes the PostgreSQL test when configured instead of silently skipping it. Current local result: 45/45 PASS.
- CI now includes a production dependency security audit that fails on High/Critical findings.
- SDK provides Ed25519 artifact signing/verification with case/task/hash/time binding.
- Control Plane now owns the signing endpoint, validates task/case provenance before signing, and rejects signing when no private key is configured.
- `Ctrl+Shift+B` strips the private signing key from Command Center, CLI, IDE, SIEM and UI child processes; only Control Plane receives it.
- Local mode marks unsigned artifacts explicitly. Staging can set `GSS_REQUIRE_ARTIFACT_SIGNATURE=true` to fail startup when key configuration is missing and reject evidence when signing fails.
- Readiness reporting now distinguishes optional local unsigned mode from the staging signature hard gate.
- All `/control/v1/*` routes now require a constant-time-checked bearer token. `Ctrl+Shift+B` generates it ephemerally and exposes it only to Control Plane and Command Center.
- UI trust boundaries now use canonical `/standalone/*` and `/control/*` routes with server-side HMAC session verification and role enforcement before rendering.
- Local login issues the roadmap-aligned `SECURITY_ADMIN` role; WebSocket command authorization accepts it while retaining the legacy role only for compatibility tests.
- Production preview HTTP verification PASS: anonymous Control Plane access redirects to login, login issues an HttpOnly cookie, authenticated `/standalone` and `/control/executions` return `200`, and legacy routes redirect to canonical workspace URLs.
- PostgreSQL now stores immutable content-addressed artifact metadata (`case → task → SHA-256 → storage ref`) and rejects conflicting replay metadata.
- Control Plane signs only artifacts already registered against a real case/task; Command Center rejects evidence when durable metadata registration fails.
- PostgreSQL load/recovery gate now drives concurrent cases, opens a fresh store instance, replays every result, and asserts exactly one frontier and decision per logical transition.
- CI security gates now include pinned OSV-Scanner v2.6.0 reusable workflows and Trivy v0.36.0 filesystem scans for vulnerabilities, misconfiguration and secrets; Trivy JSON evidence is retained for 30 days and High/Critical findings fail the build.
- GitHub security gates exposed Critical/High advisories in Next.js 14/PostCSS; the UI runtime was migrated to patched Next.js 16.3.7 while retaining monorepo-compatible React 18.3.1, and the deprecated middleware convention was migrated to `proxy.ts`.
- Local full dependency audit: PASS with 0 vulnerabilities after the Next.js 16.3.7 and Vitest 5.0.2 migrations; the Vitest major upgrade was verified against the complete unit/integration/smoke suite.
- GitHub Actions now has a PostgreSQL service job that runs migrations before integration tests.
- `git diff --check`: PASS.

## BLOCKED

- Chronicle staging credentials, dataset, and external UDM Search verification are not configured.
- Docker/gVisor sandbox hard gate cannot run because Docker is unavailable in this environment.
- Artifact signing is implemented but remains `NOT RUN` against a real staging key until a protected Ed25519 key is provisioned.
- Production identity, incident ACL, revocation and a verify-only worker authentication design remain outside the local demo boundary.

## Next implementation slice

1. Local HTTP semantics, immutable result replay and concurrency tests are implemented; enforce the same contracts in staging with real identities.
2. Provision a protected staging signing key and distribute only its public verification key to workers.
3. Run Chronicle staging and Docker sandbox hard gates when their external prerequisites are available.
4. Add the OIDC provider, S3-compatible artifact backend and OTel collector required for staging.
