# GSS SOC lab advancement — Codex — 2026-10-09

Checkpoint requested by the user: **11:25 AM Asia/Bangkok (UTC+7), 09/10/2026**, replacing 11:20. Existing heartbeat updated in place, not duplicated. Publishing requires review plus Git/network permission and remote SHA confirmation.

## Implemented

- Explicit lab/replay/staging profile with staging-downgrade rejection; legacy Chronicle v1 accepted, lab provenance versioned separately. External model calls disabled in lab/replay even if a provider key exists; Chronicle worker/query not selected in those profiles.
- Strict own-device metadata batch (no message/XML/user SID/command-line payload), source authorization from server configuration, canonical normalized-export checksum, bounded import/query.
- Migration 016: immutable batches/import/query receipts, payload hashes, task/case/run linkage. Import serializes quota/idempotency acquisition; actor/body conflict denied.
- Control Plane service-only import/query APIs; persisted observation → Frontier → deterministic BLOCKED decision → outbox → lab query/report receipt in one transaction. Explicit CONTROL_INLINE_READONLY execution, not worker execution.
- Query/report artifacts verified; no facts on failed import/query. Metadata-only verdict remains INSUFFICIENT_EVIDENCE, never benign/confirmed.
- Local CLI inventory/collect/run, read-only Standalone lab desk behind session/case ACL, no import or lifecycle write exposed to browser. Runbook and full macro-roadmap saved in Markdown.

## Real local evidence and limits

- Inventory: Windows x64, 33,940,815,872 RAM bytes (~31.6 GiB), 8 logical CPUs. GPU/VRAM NOT RUN. Docker missing; WSL probe unavailable/denied, not proof Linux is usable or absent.
- Initial sandboxed collection failed; approved retry collected **200 real own-device System metadata events**. LAB_LIVE is operator-asserted, not attestation. No company data/remote collection or external upload.
- Focused contracts: 11 PASS. Focused PostgreSQL: 9 PASS including actual telemetry via HTTP, Control Plane restart/replay, report read, immutable/truncate denial, checksum/profile/owner validation and transactional audit failure rollback. Actual live test only runs when a private authorized batch is explicitly supplied; fixture coverage is not live evidence.
- Runtime database was not migrated. Real verification used an isolated test schema and then removed exactly that schema; private exported events/report retained under ignored `data/lab`. Schema removal removes test receipts, so this does not demonstrate already-persisted runtime UI data.
- Raw export here means allowlisted normalized metadata, NOT original EVTX. Canonical JSON checksum, host pseudonym, event IDs and query hash retained. No model/SOC analyst correctness measured.
- 30-day query eligibility and bounded quota implemented; automatic archival/deletion/recovery workflow NOT implemented. Bounded filesystem orphan may remain after DB rollback; no orphan becomes evidence without a committed receipt. No Object Lock/superuser protection/physical cancellation claims.

## Verification and publication

Full final-source verification **PASS** at **11:17:39 Asia/Bangkok**: source authority, skills audit, clean 6/6 workspace build, root/UI typecheck, 102 unit + 153 isolated-PostgreSQL integration + 7 environment + 14 browser = **276 tests**, smoke and production/all-dependency npm audits (zero findings). Source was unchanged during this verification. Fingerprint: `f2034c6d7ae74b6df027300d29d70fc0e95531c8b97fa40675b1882ad24c0bd8`. Portable command/log-hash metadata: [verification summary](GSS_SOC_LAB_VERIFICATION_2026-10-09_CODEX.json).

Earlier attempts are not completion proof: one browser assertion matched Next.js's route announcer as well as the form error; fixed by scoped selector. Sandbox runs stalled during browser-process teardown and were stopped. Final authorized outside-sandbox verification completed with every command exit 0; malformed scalar/provenance checks and UI contract handling are included in the frozen source. The 254 prior tests are not reused as proof for this source. These local audits do not replace OSV/Trivy or staging gates.

Actual telemetry verification completed at 11:16:52: Control Plane HTTP import/query, PostgreSQL transaction, Frontier/report, Control Plane restart and idempotent replay/readback PASS. Browser responsive/auth/failure tests are local; rendered report fixture is explicitly REPLAY, not live UI runtime evidence. Raw telemetry/logs remain private ignored data. Remote CI NOT RUN.

Publication **PUSHED**, remote confirmed **11:26:18 AM Asia/Bangkok**: implementation `467eac3d788b5785638d24e83a68563c8dcd05dd` on main. Confirmation finished about one minute after the requested 11:25 checkpoint while Git/network authorization completed; no scope expansion. Non-force push; remote SHA matched local HEAD. This publication receipt is a separate documentation-only commit; Git records its actual SHA.

## Remaining roadmap

A packaging/runtime-launch checks still need final evidence; B hypothesis/next-best-evidence three-step loop, C local provider/human-labeled SOC eval, D Linux sandbox, E recovery/clean install and F Chronicle/identity/retention/OTLP/load pilot are not complete. No claim of L3 analyst replacement or production readiness.

Skills: verification gate enforced isolated DB/failure paths and truthful statuses. UI/UX guidance influenced the small lab desk: existing Apple-like tokens, visible labels/focus/error states, evidence coverage text, bounded timeline and mobile/reduced-motion browser checks. No broad cosmetic redesign.

Read [lab runbook](GSS_SOC_LAB_RUNBOOK_CODEX.md) and [product roadmap](GSS_SOC_PRODUCT_ROADMAP_CODEX.md).
