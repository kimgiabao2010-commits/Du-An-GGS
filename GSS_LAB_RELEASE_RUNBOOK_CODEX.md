# GSS lab installation and recovery — Codex — 2026-10-14

## Verified snapshot

Current portable verification: [401-test artifact-recovery receipt](GSS_SOC_VERIFICATION_2026-10-14_RECOVERY_CODEX.json). Source fingerprint `5ce6528034c6b623797b9861411881d48850cacb4038a209aba9a094b994663c`. The receipt identifies uncommitted working source above base305b1db; use the later checkpoint commit recorded in GITLOG when retrieving it from GitHub. Do not label base305b1db as containing this work.

Windows/Node24/PostgreSQL18 installation was tested from the earlier367-test source snapshot (`956904f7a19526529d6f508e6fc67f9c0750e6a75700e5be84ab7f81344f44d0`) with no copied `node_modules`, package `dist`, Next build or private environment. Locked dependency installation (`npm.cmd ci --ignore-scripts --no-fund`), all six workspace builds and root/UI typecheck PASS. The latest report-integrity patch changed no dependencies and passed a fresh forced build/typecheck/full regression on its own fingerprint. A separate-machine Linux install remains untested.

## Install and run

1. Retrieve the published checkpoint revision from GITLOG. Install a supported Node runtime and PostgreSQL. Keep the database and GSS listener local for a lab.
2. At the repository root, run `npm.cmd ci --ignore-scripts --no-fund`, then `npm.cmd run build` and `npm.cmd run typecheck`. On Windows use `npm.cmd`, including editor tasks, to avoid PowerShell's `npm.ps1` constrained-language error.
3. Copy `.env.example` to your private `.env` and configure the local PostgreSQL connection. Review lab/data authorization flags. Do not copy another operator's secrets, raw telemetry or signing keys from Git.
4. Back up any existing local database with `npm.cmd run db:backup -- --local-authorized`. Apply migrations using `npm.cmd run db:migrate -- --local-only`. A brand-new schema needs all migrations001–018; never edit an already applied migration to make a checksum check pass.
5. For lab operation choose `GSS_RUNTIME_ENV=local`, `GSS_SOC_PROFILE=lab`. Use the [lab runbook](GSS_SOC_LAB_RUNBOOK_CODEX.md) for explicit own-device import/replay. Local conversation can stay disabled; its [separate runbook](GSS_LOCAL_MODEL_RUNBOOK_CODEX.md) covers checkpoint/license and evaluation requirements.
6. Ctrl+Shift+B selects **GSS: Run local stack**. It checks ports, requires PostgreSQL, applies immutable migrations, builds packages/UI, then starts Control Plane, Command Center and configured workers/UI. Local demo login is BaoNVG / 1 and is restricted by the launcher's loopback demo configuration. Required ports are3000/4000/4100. A conflicting existing server must be stopped by its owner before starting another stack.
7. Open `/standalone/lab` for imported metadata and `/standalone/investigation` for retained Frontier/hypotheses/timeline/report. Worker connection alone does not certify sandbox execution. SIEM is unavailable in lab/replay; Chronicle staging requires its own access and live verification.

`npm.cmd run dev:verify -- --local-authorized` checks the actual launcher in an isolated empty schema with no task/model invocation. It is suitable for checking startup without consuming or replaying existing runtime tasks. Stop the actual runtime through its terminal when finished.

## Backup and recovery

Keep both PostgreSQL and the matching private artifact directory under the operator's backup/retention policy. A database archive alone does not restore missing evidence files or certify Object Lock. Backup credentials must not appear in command arguments, logs or Git.

The 14 October database archive was restored to a disposable, uniquely named local database, all17 recorded checksums verified, then upgraded to migration018. Counts remained245 cases/295 tasks/3 usage rows. Original runtime was untouched; the owned restored test database was removed after validation and the archive retained. This is a verified database restore-and-upgrade drill. Complete artifact-store restoration is a separate pending gate.

Selected own-device artifact backup/isolated restore/report comparison PASS separately on14 October; use the [artifact recovery runbook](GSS_ARTIFACT_RECOVERY_RUNBOOK_CODEX.md). This proves one permitted lab case, not all other artifacts or a combined database+artifact/separate-host recovery. Native CPU candidate inference has a separate sanitized receipt; it does not enable or promote product reasoning automatically.

For a real recovery: stop new work, preserve the current database/artifacts, restore into a new isolated target, validate migration checksums/counts/provenance/artifact hashes and readiness, then let the release owner explicitly select that target. Record target, archive hash, source revision and validation results. Do not overwrite the working runtime during a rehearsal.

## Rollback decision

Each release must include its source revision, migration compatibility, verification fingerprint, blockers and backup receipts. If startup, evidence integrity or state transitions regress, halt new work and preserve evidence. Source rollback must use a revision compatible with the retained schema; do not drop new tables or alter immutable receipts as an automatic downgrade. An incompatible database rollback requires a reviewed restore into another target. Resetting a Git worktree or wiping local data is not a rollback procedure.

Current release remains a lab checkpoint. SOC quality, real model benchmark, Chronicle, rootless sandbox, organization identity/retention/observability/load/freeze still need their acceptance evidence.
