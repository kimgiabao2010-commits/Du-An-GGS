# GSS — Control Plane P0 Progress

Updated: 2026-09-29

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
- Integration suite: 42 tests PASS.
- PostgreSQL durable-loop test added; it runs when `DATABASE_URL` is present and is intentionally skipped only in local environments without PostgreSQL.
- Model usage ledger is now wired for real LLM calls, including success/failure, token counts, latency, route reason, retry count and configurable cost estimate.
- `.env.example` now documents `CONTROL_PLANE_URL`, `CONTROL_PLANE_PORT`, and configurable model cost rates.
- Added `npm run readiness` to report hard prerequisites without printing secrets or claiming live external verification.
- PostgreSQL live connectivity and durable-loop integration now PASS locally after correcting the partial-index conflict target.
- Mock sandbox success has been removed; sandbox execution is now fail-closed unless explicit Docker staging mode is enabled.
- Sandbox boundary tests pass for default blocking and command allowlist enforcement; Docker execution remains an external hard gate.
- Root integration runner now loads `.env`; `npm run test:integration` executes the PostgreSQL test when configured instead of silently skipping it. Current local result: 45/45 PASS.
- CI now includes a production dependency security audit that fails on High/Critical findings.
- SDK now provides Ed25519 detached artifact signing/verification with case/task/hash binding; private-key ownership remains a Control Plane responsibility.
- Local `npm audit` could not reach the npm advisory endpoint; security result remains NOT RUN locally and is delegated to CI.
- GitHub Actions now has a PostgreSQL service job that runs migrations before integration tests.
- `git diff --check`: PASS.

## BLOCKED

- Live PostgreSQL transaction and restart proof has not run in this environment.
- Chronicle staging credentials, dataset, and external UDM Search verification are not configured.
- Docker/gVisor sandbox hard gate is not part of this P0 slice.
- Standalone WebSocket intake still contains compatibility logic and must be migrated to call the Control Plane exclusively in the next slice.
- The direct persistence compatibility path remains only for standalone mode without `CONTROL_PLANE_URL`; the Ctrl+Shift+B stack uses the authority path.

## Next implementation slice

1. Move Command Center task creation/result writes behind an internal Control Plane client.
2. Add contract tests for `200/201/403/404/409/422/503` semantics.
3. Add PostgreSQL service-backed integration tests for idempotency, CAS, outbox, restart, and replay.
4. Add server-side route authorization for `/standalone` and `/control`.
