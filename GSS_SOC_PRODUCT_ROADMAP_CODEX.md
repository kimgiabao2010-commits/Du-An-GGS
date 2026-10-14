# GSS SOC product roadmap — Codex — 2026-10-09

## Product charter

One-organization, evidence-first L1/L2 SOC investigation copilot. You are product/release owner; AI assists engineering and review, never an independent approver. L3 claims require per-use-case analyst evaluation. Budget: no new paid dependencies without approval; free AI availability is not a runtime SLA.

Keep TypeScript/Next.js/PostgreSQL, Control Plane sole state writer, durable decisions/outbox/queue. Do not add Kubernetes/Kafka/Temporal/vector DB/multi-region to this MVP. Windows development/own-device telemetry; Linux rootless execution when available. No remediation/writeback/auto-merge/auto-deploy.

## Milestones and gates

| Milestone | Deliverable | Required gate / current state |
|---|---|---|
| A: baseline and lab | Resource inventory, source authorization, lab/replay profiles, strict metadata import, receipts, Frontier/timeline/report and read-only desk | 14/10: actual local migration018 after backup preserving counts; actual metadata browser report/Frontier and atomic case-report download PASS. Full real launcher in isolated PostgreSQL schema/login/CLI+IDE presence PASS. Prior CLI restart/replay/recovery receipts retained. Metadata remains insufficient for SOC conclusions. |
| B: SOC loop | Typed entities/IOCs, contradictions, HypothesisPlanner selecting next-best evidence, deterministic authority gate | Opt-in SOC normalization/planner and immutable receipts/outbox PASS on three-step isolated-PG provider fixtures. Added event-level entity roles/lineage, exact-value-only comparison, authority projection/API/UI/report and replay/tamper/failure tests; atomic Frontier reads and report integrity verified. Actual SOC telemetry loop/analyst quality remains BLOCKED; legacy default fixed flow unchanged. Metadata-only report is not this gate. |
| C: local reasoning/eval | CONVERSATION/INVESTIGATION logical role split, loopback llama.cpp provider, labeled corpus/resource benchmark | Experimental CONVERSATION transport/role boundary/ledger implemented and local HTTP failure tests PASS; disabled by default. Actual checkpoint/license/resource benchmark and 30 human-labeled cases NOT RUN. Investigation remains deterministic. No silent paid fallback. See local-model runbook. |
| D: sandbox | Linux rootless Docker, gVisor if supported, read-only repo/no network/limits/ephemeral workspace | BLOCKED: Docker absent, usable Linux runtime not verified. No host fallback. Adversarial traversal/symlink/egress/fork/resource/output tests required. |
| E: lab packaging | Reproducible clean install, browser flow, backup/restore, release manifest and rollback runbooks | Actual full launcher/login/workers, metadata browser/export, source-only locked install/build and fresh DB restore-and-upgrade PASS. Release runbook added; separate-host/artifact-store recovery and published release bundle still pending. Single host is not HA. |
| F: organization pilot | Chronicle read-only live, authorized/redacted dataset, IdP/MFA, artifact retention, OTLP, load/recovery | BLOCKED prerequisites. Shadow mode with analyst review, >=100 permitted labeled cases and independent SOC reviewer. No automatic incident closure. |

Work on one primary milestone at a time. Estimates from planning are effort ranges (A 1–2, B 3–5, C 2–4, D 2–3, E 2–3 weeks; F 6–8 after prerequisites), not a promised calendar or a readiness percentage.

## Subsequent capability order

Timeline preserving event/collection/query times and uncertainty → entity/IOC correlation separating verified links from equal values → hypotheses/contradictions → versioned ATT&CK rules using official MITRE data → offline licensed/dated threat intel with expiry → evidence-backed verdict/report. A technique or threat-intel match is not itself proof of compromise.

Hypothesis output must link facts/evidence and identify missing evidence; no fabricated/calibrated confidence claims. Model proposals cannot dispatch/write facts/authorize. Existing deterministic planner checks state/capability/risk/action fingerprint/repetition/depth/deadline/cost/query budgets before durable decision/outbox.

14/10 next-evidence priority: fresh unresolved/contradictory queries precede assessed/stale/repeated candidates before bounded selection; same-event co-observation with the queried IOC can break a tie, but shared query membership cannot. Additive durable selection receipts bind event/projection/artifact/evidence/task lineage and uncertainty. This is deterministic engineering behavior tested with contract fixtures, not evaluated SOC accuracy or model reasoning; the actual telemetry/reviewer gate remains BLOCKED.

14/10 offline threat-intel: optional operator-reviewed/pinned private catalog supplies exact-value IP/domain/hash annotations in atomic case-report JSON. Source/license/version/reviewer/expiry and event/artifact provenance remain explicit; expired/unconfigured/future-review catalogs supply no active matches, no-match is not benign, contradictory feed labels persist. No network IOC disclosure, model call, FACT/verdict/dispatch change or automatic feed download. Actual permitted/licensed feed remains NOT CONFIGURED; ATT&CK mapping is separate unfinished work. See [offline-intel runbook](GSS_OFFLINE_INTEL_RUNBOOK_CODEX.md).

14/10 SOC evaluation plumbing: private pinned offline CLI measures case rubric/reference/safety/holdout criteria separately from routing.30-case20/10 split and shared group/artifact leakage checks, hash-bound human-review declarations, high-risk benign and invalid FACT citation rejection, explicit unknown usage and baseline cost pairs. No auto-promotion; fixture quality NOT_RUN and real labels require authenticated analyst signoff. Actual human corpus/model quality/pilot remain unfinished. See [SOC evaluation runbook](GSS_SOC_EVAL_RUNBOOK_CODEX.md).

## Data and model policy

- Company data remains outside authorized scope. Need owner-approved export/redaction/location/retention; no GitHub/free-AI/personal-device upload without permission.
- Profiles `lab`, `replay`, `staging` are distinct. Existing default stays Chronicle-first for compatibility; choosing lab does not pass staging gates.
- CPU-light, one investigation at a time is the target; A inline lab queries are serialized. Existing general orchestrator global-concurrency changes remain B work, not claimed already implemented.
- Observed machine: ~31.6 GiB RAM, 8 logical CPUs. GPU/VRAM not measured; no model checkpoint chosen. Linux/WSL viability requires separate validation.
- No train-from-scratch. Fine-tuning only after lawful corpus, reproducible eval and a useful baseline. If local model fails quality/resource gates, explicit deterministic/manual mode; no paid fallback.
- No independent second human means dual-approval actions remain unavailable. AI cannot count as the second approver.

## Release discipline

Every gate has code/migration, contract/integration/failure-path test, source fingerprint/command/log hashes, review, owner and evidence classified PASS/FAILED/BLOCKED/NOT RUN. Lab/replay results cannot certify Chronicle, sandbox, production identity or SOC accuracy.

Pilot targets (not current guarantees): API p95 <300 ms excluding provider, enqueue p95 <500 ms, queue lag p95 <2 s, availability 99.5%/28 days only after continuous operation. Logical-transition loss/duplication is always a blocker. Separate internal/provider/policy-denial metrics and end-to-end experience. Error-budget breach/security boundary/data loss stops feature rollout and triggers a postmortem.

Release bundle: commit SHA, migration compatibility, manifest, SOC eval/resource results, blockers and rollback procedure; staged/shadow cohorts before wider rollout, operator deployment decision required. Expand budget first into authorized telemetry/reviewer/backup/compute, not a large orchestration cluster.

References: [Google SRE error budgets](https://sre.google/workbook/error-budget-policy/), [canary releases](https://sre.google/workbook/canarying-releases/), [MITRE ATT&CK data](https://attack.mitre.org/resources/attack-data-and-tools/), [llama.cpp](https://github.com/ggml-org/llama.cpp). These are guidance, not certification of this repo.
