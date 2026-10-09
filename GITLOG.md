# GSS Gitlog — Codex

## 2026-10-09 — Roadmap publication requested immediately

Scope prepared for publication: previously uncommitted durable Control Plane roadmap work plus this checkpoint's permanent workload-certificate revocation floor and dependency security closure.

- Control Plane is the PostgreSQL writer; durable intake/outbox/result receipts, replay/restart controls, worker fleet/presence and model-cost reservation work are included with migrations 006–015.
- Identity: exact SAN/DER leaf pin, token/certificate role binding, permanent PostgreSQL tombstones, Security Admin-only revoke, atomic audit, bounded async WS authorizer and no sync dispatch bypass.
- Security dependency update: proxy-addr 2.0.8; production and development npm audit gates in local verification and GitHub Actions.
- State/readiness/local-run docs updated without turning local fixture results into staging claims.
- Final commands, test counts, source/lock fingerprints and blockers: [checkpoint report](GSS_ROADMAP_CHECKPOINT_2026-10-09_CODEX.md).
- Local verification completed at 09:36:23 Asia/Bangkok: build/typecheck/source/skills/smoke PASS; 254 tests PASS (91 unit, 144 real-PostgreSQL integration, 7 environment, 12 browser); both production and all-dependency audit gates PASS with zero findings. Source was unchanged during verification. Release remains BLOCKED; external staging gates are NOT RUN. Portable metadata: [verification summary](GSS_VERIFICATION_2026-10-09_CODEX.json); raw logs remain local, not published evidence.

The user subsequently requested **push now**, ahead of the 11:20 checkpoint. Publication is **PREPARED**, not claimed successful before remote SHA verification. Source fingerprint, all 357 allowlisted file hashes and original verification-log hashes match the verified snapshot. Secret heuristic review found only the explicit fake-key redaction test; this is not a replacement for Trivy. No force-push, merge, deployment or remediation is requested. Private .env/runtime data, source documents supplied by the user, generated dist/build/cache changes are excluded. The scheduled checkpoint can report the existing publication without creating a duplicate commit.

Baseline before publication: `7bbd8adf87bd58778a9af8c82851646211ed41ae` on `main`; read-only remote check matched this SHA. The commit history (`git log`) is the authoritative source of actual commit IDs; this file does not predict its own future commit hash.
