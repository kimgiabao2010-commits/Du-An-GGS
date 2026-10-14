# GSS SOC lab — Codex

## Boundaries

One organization, own-device lab only. Do not export company/remote logs without data-owner approval. `LAB_LIVE` is operator-asserted, not attestation; `REPLAY` is historical input. Neither is Chronicle staging evidence. Existing staging hard gates stay mandatory. No paid-model fallback, remediation, deploy or fabricated verdict.

## Start

Use `npm.cmd` on Windows. PostgreSQL is required; `.env` stays private.

1. `npm.cmd run lab:inventory` — saves private RAM/CPU/runtime inventory in `data/lab/inventory.json`; GPU selection remains NOT RUN.
2. `npm.cmd run lab:collect -- --own-device` — explicitly authorizes up to 200 System log metadata events on this device. No event message, XML payload, user SID, command line or remote host. Requires Windows Event Log permission. No fixture on failure.
3. Before modifying an existing local database, `npm.cmd run db:backup -- --local-authorized` creates a private native custom archive and checks it can be listed (not a restore drill). Installed PostgreSQL 18 tools are the Windows default; explicit `GSS_PG_DUMP_PATH`/`GSS_PG_RESTORE_PATH` can select installed alternatives. Then `npm.cmd run db:migrate -- --local-only` applies pending migrations to the verified local target. Remote/staging targets are denied by this flag. Verification still uses isolated test schemas; it does not migrate runtime for you. On 10/10, the development runtime was backed up and migrated through 016; details in the work-session report.
4. `npm.cmd run lab:run -- --batch data/lab/windows-<timestamp>.json --profile lab --own-device` — starts a temporary loopback Control Plane; imports via its authenticated HTTP API, creates a lab case, executes an inline read-only query, commits Frontier/decision/outbox/query receipt transactionally and writes a private report. Does not launch or pretend to be an IDE/SIEM worker. Query is at most seven days/100 results; collection/query truncation is retained.
5. Repeat the same run: import/query replay must not create another logical transition. Restarting the CLI recreates the Control Plane and uses existing PostgreSQL receipts.
6. To view the retained report: configure `GSS_SOC_PROFILE=lab`, `GSS_LAB_OWN_DEVICE_AUTHORIZED=true`, `GSS_LAB_ALLOWED_SOURCES=local-windows`; Ctrl+Shift+B starts the existing local stack. Sign in and open `/standalone/lab`, paste the CLI case ID. Local admin can inspect it; other roles need case ACL. Browser staging SSO remains BLOCKED until implemented.

To replay an authorized historical batch, use `sourceKind=REPLAY`, `--profile replay --replay-authorized`; never rename it LAB_LIVE. Changing source kind changes the artifact checksum. No company ingestion supported by this CLI.

After build, `npm.cmd run lab:check -- --case LABCASE-<receipt-id> --own-device` verifies the retained actual lab report and read-only `/standalone/investigation` Frontier through temporary local Control Plane/UI and a headless browser. It uses a dedicated local demo identity, not staging SSO, checks report provenance/counts/mobile fit and closes only its own processes. The lab case must explicitly have no stored SOC hypothesis; the check does not infer one. Screenshots/receipt remain private. No import or data collection is performed by this check. Control Plane startup may perform its normal authority recovery/lease housekeeping.

For a retained SOC-policy case, open `/standalone/investigation` and load its authority case ID. This displays stored plans only; it cannot start an investigation. Load the case timeline to inspect retained query event times/uncertainty and task provenance. Download case report reads the latest frontier, hypotheses and bounded timeline in one database snapshot; review it as an analyst before using its conclusions. Older caller-provided timelines are not backfilled as authority evidence. See `GSS_SOC_HYPOTHESIS_LOOP_CODEX.md` for opt-in policy prerequisites. Do not enable Chronicle authorization merely to populate the page.

`npm.cmd run dev:verify -- --local-authorized` verifies the real Ctrl+Shift+B launcher, all migrations, login and CLI/IDE worker heartbeats using an isolated empty local PostgreSQL schema. It checks zero task/model invocations and removes only its owned test schema/processes. Ports 3000/4000/4100 must be free; existing user servers are left untouched. This does not certify sandbox execution or Chronicle.

Experimental local conversation is disabled by default. A reviewed llama.cpp model can be configured separately following [the local model runbook](GSS_LOCAL_MODEL_RUNBOOK_CODEX.md). Model quality and labeled evaluation remain required before promotion.

The investigation desk also exposes **Load entity evidence** for retained SOC query projections. It keeps structured principal/target/src/DNS mentions together only within their original event, with query/task/evidence/artifact/time lineage. Equal typed values are not proof of the same asset, and co-observation is not causation. Event/mention/field limits and omitted projections remain visible. JSON export and atomic case report retain these annotations. Older/caller-authored results stay unprojected; own-device metadata alone produces no entity associations.

## Contracts and persistence

- Existing Chronicle v1 evidence remains accepted. Lab uses `gss.evidence-provenance.v2`, `lab-windows-events` and explicit source kind, collection/query/event timestamps, artifact/query hashes and event lineage.
- Import: `POST /control/v1/lab/batches` with batch/checksum/idempotencyKey. Query: `POST /control/v1/cases/:id/lab-investigations`. These are service-only; local importer is Control Plane, not direct PostgreSQL UI/worker access.
- Read: `GET /control/v1/cases/:id/lab-report`, under existing role/session/case ACL. Browser proxy allowlists only this read path, never the import/query writes.
- Batch limit 1,000 events/512,000 bytes; strict metadata schema, unexpected fields rejected. Import/quota acquisition serialized. Maximum 256 artifacts/128 MiB; query receipts retain artifact/task/case/run provenance.
- Canonical JSON SHA-256 is the normalized-export checksum, not a hash of original EVTX. Files are private content-addressed allowlisted exports; host hash is pseudonymous, not guaranteed anonymous.
- Retention is 30-day query eligibility; expired data is denied, not automatically deleted. Quota includes retained/expired records. Manual archival/secure deletion workflow is NOT implemented; hitting quota fails closed. SQL triggers are not Object Lock, protection against superusers, or cross-process filesystem anti-TOCTOU protection.
- DB rollback after a file write can leave a bounded orphan artifact. It is not evidence unless its transaction committed. No automatic destructive cleanup of user data.

## What the first report means

Timeline items link event IDs → evidence ID → artifact hash → lab query receipt → Frontier task provenance. Metadata alone always returns `INSUFFICIENT_EVIDENCE` and a deterministic `BLOCKED/LAB_METADATA_ONLY` next step. This is the A vertical slice, not the B three-step SOC reasoning loop.

Hypothesis planner, meaningful entity/IOC extraction, local model selection/eval, ATT&CK/intel, rootless Linux sandbox, restore/release packaging and Chronicle pilot remain subsequent milestones. A local API/browser test never counts as a staging release gate.
