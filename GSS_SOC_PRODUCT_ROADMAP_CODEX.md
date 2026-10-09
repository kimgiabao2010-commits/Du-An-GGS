# GSS SOC product roadmap — Codex — 2026-10-09

## Product charter

One-organization, evidence-first L1/L2 SOC investigation copilot. You are product/release owner; AI assists engineering and review, never an independent approver. L3 claims require per-use-case analyst evaluation. Budget: no new paid dependencies without approval; free AI availability is not a runtime SLA.

Keep TypeScript/Next.js/PostgreSQL, Control Plane sole state writer, durable decisions/outbox/queue. Do not add Kubernetes/Kafka/Temporal/vector DB/multi-region to this MVP. Windows development/own-device telemetry; Linux rootless execution when available. No remediation/writeback/auto-merge/auto-deploy.

## Milestones and gates

| Milestone | Deliverable | Required gate / current state |
|---|---|---|
| A: baseline and lab | Resource inventory, source authorization, lab/replay profiles, strict metadata import, receipts, Frontier/timeline/report and read-only desk | Implemented vertical slice; actual own-device metadata tested in isolated PostgreSQL. Final engineering manifest governs PASS; clean runtime launch/schema still separate. |
| B: SOC loop | Typed entities/IOCs, contradictions, HypothesisPlanner selecting next-best evidence, deterministic authority gate | NOT RUN. Three evidence-driven steps; new evidence changes hypothesis/action; restart/replay and bounds pass. Metadata-only report is not this gate. |
| C: local reasoning/eval | CONVERSATION/INVESTIGATION logical role split, loopback llama.cpp provider, labeled corpus/resource benchmark | NOT RUN. Profile machine/license first; 30 human-checked cases split 20 dev/10 holdout; >=8/10 rubric pass, no fabricated evidence/unauthorized action. No silent paid fallback. |
| D: sandbox | Linux rootless Docker, gVisor if supported, read-only repo/no network/limits/ephemeral workspace | BLOCKED: Docker absent, usable Linux runtime not verified. No host fallback. Adversarial traversal/symlink/egress/fork/resource/output tests required. |
| E: lab packaging | Reproducible clean install, browser flow, backup/restore, release manifest and rollback runbooks | NOT RUN. Clean checkout/recovery evidence required; single host is not HA. |
| F: organization pilot | Chronicle read-only live, authorized/redacted dataset, IdP/MFA, artifact retention, OTLP, load/recovery | BLOCKED prerequisites. Shadow mode with analyst review, >=100 permitted labeled cases and independent SOC reviewer. No automatic incident closure. |

Work on one primary milestone at a time. Estimates from planning are effort ranges (A 1–2, B 3–5, C 2–4, D 2–3, E 2–3 weeks; F 6–8 after prerequisites), not a promised calendar or a readiness percentage.

## Subsequent capability order

Timeline preserving event/collection/query times and uncertainty → entity/IOC correlation separating verified links from equal values → hypotheses/contradictions → versioned ATT&CK rules using official MITRE data → offline licensed/dated threat intel with expiry → evidence-backed verdict/report. A technique or threat-intel match is not itself proof of compromise.

Hypothesis output must link facts/evidence and identify missing evidence; no fabricated/calibrated confidence claims. Model proposals cannot dispatch/write facts/authorize. Existing deterministic planner checks state/capability/risk/action fingerprint/repetition/depth/deadline/cost/query budgets before durable decision/outbox.

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
