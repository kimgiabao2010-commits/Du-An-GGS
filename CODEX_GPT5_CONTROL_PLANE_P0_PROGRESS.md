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
- Updated the workspace lockfile.
- `tsc --project services/control-plane/tsconfig.json`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd run dev:check`: PASS.
- `git diff --check`: PASS.

## BLOCKED

- Live PostgreSQL transaction and restart proof has not run in this environment.
- Chronicle staging credentials, dataset, and external UDM Search verification are not configured.
- Docker/gVisor sandbox hard gate is not part of this P0 slice.
- Standalone WebSocket intake still contains compatibility logic and must be migrated to call the Control Plane exclusively in the next slice.

## Next implementation slice

1. Move Command Center task creation/result writes behind an internal Control Plane client.
2. Add contract tests for `200/201/403/404/409/422/503` semantics.
3. Add PostgreSQL service-backed integration tests for idempotency, CAS, outbox, restart, and replay.
4. Add server-side route authorization for `/standalone` and `/control`.
