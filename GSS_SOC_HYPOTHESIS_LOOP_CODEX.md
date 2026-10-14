# GSS SOC hypothesis loop — Codex — 2026-10-10

## 14 October additions

The historical backend-only description below records its original scope. Cross-query timeline/entity API/UI and atomic report now exist; see the current work session for their separately dated verification. Deterministic next-evidence priority is now evidence-driven: unresolved fresh queries before assessed/repeated/stale candidates, then validated same-event co-observation, then stable identifier order. A query containing two values in different events does not establish their relationship. Contradictions remain visible and receive investigation priority, never automatic resolution.

The authority-generated optional `gss.next-evidence-selection.v1` receipt binds selected event index/ID, projection/artifact hash, evidence and task, with partial-context disclosure. It is a collection-priority explanation, not a FACT, confidence score, physical identity or causal claim. Both anchor/selected facts must pass existing gate checks. Receipt/decision/outbox are atomic; canonical plan identity is checked on retrieval. No new model calls, capabilities, migrations or live Chronicle claims. Earlier plans remain compatible without a receipt. Latest verification and blockers are in [14 October work session](GSS_SOC_WORK_SESSION_2026-10-14_CODEX.md).

## Scope and status

Implemented an **opt-in engineering path**, not an operational SOC certification: provider evidence → authority normalization → new Frontier → policy-derived related-entity questions → deterministic gate → atomic hypothesis receipt/decision/outbox. A successful query or matching IOC is not proof of compromise. Legacy runs retain their old policy; the legacy Command Center sequence has not silently become SOC reasoning.

Current frozen verification completed at 21:57:12 local: **342 tests** (146 unit, 169 isolated-PostgreSQL integration, 10 environment, 17 browser); source/build/typecheck/skills/smoke/audits PASS, source unchanged. Eleven new PostgreSQL SOC tests identify fixtures as `CONTRACT_FIXTURE_NOT_CHRONICLE_STAGING`; five additional case-read HTTP ACL tests use local identity fixtures. None certify live Chronicle, staging OIDC/MFA, lab SOC quality or model evaluation. Common case ACL middleware was already correct, verified without runtime edits. Adapter field-array loss and authority-built per-artifact timelines retain provenance/uncertainty across restart/replay; failed SOC results cannot submit timelines. Actual authenticated PostgreSQL metadata-only browser report/Frontier PASS separately at 20:19:02, explicitly without a stored SOC hypothesis; UI unchanged in subsequent backend/ACL-test slices. See dated work session and portable verification metadata for receipts, earlier failed attempts and external gates.

## Behavior

- Opt-in SOC result execution includes authority-built `gss.evidence-timeline.v1`: artifact-bound per-query projection with original timestamps/event lineage, explicit unknown/invalid time and truncation/omission counts. Caller/model timeline is replaced transactionally; replay retains the stored projection. FAILED/BLOCKED/CANCELLED results cannot submit a timeline. Chronicle is explicitly UNATTESTED until external proof exists. Timeline does not create Frontier facts or infer causal links/compromise; cross-query aggregation and UI exposure are not implemented by this backend slice. Only bounded RFC3339 event strings are ordered; unsupported timestamp objects/leap-second forms remain INVALID, recoverable from the raw artifact. Sub-millisecond values retain the original timestamp but are tied at millisecond sorting precision, not an asserted exact order.
- Actual SIEM worker parameters are flat: `indicatorType`, `indicatorValue`, `startTime`, `endTime`, `limit`. Nested adapter-request parameters are rejected by proposal policy.
- Related IP/domain/hash/user/hostname values are extracted only from allowlisted structured event fields. Model prose, task intent and caller-supplied facts do not become SOC evidence.
- IOC set values have scoped keys; two different IPs are not treated as contradictory values of a single scalar fact. Equal IOC values alone do not prove asset identity or causation.
- A typed question binds its supporting fact/evidence IDs. Query window/limit, available capability, policy version, depth/time/cost/query budget and repeated-action guards are checked. One action maximum.
- Successful zero results become `NO_MATCHES` within that query/window, not `BENIGN`. Truncation and unverifiable matches remain explicit uncertainty. No automatic benign/confirmed SOC verdict, remediation or writeback.
- Adapter field-array caps are also disclosed: optional `fieldTruncated=true` implies overall `truncated=true`, even without provider pagination. After DNS/security-result allowlisting, authority normalization retains `PROVIDER_FIELD_LIMIT` with evidence provenance and hash-bound partial coverage. Old evidence without this optional flag remains compatible; this does not retroactively attest complete coverage of historical payloads.
- Deterministic verdict v2 treats provider HIGH/CRITICAL as a triage signal (`SUSPICIOUS`), not confirmed compromise; all other/zero/ALLOW/LOW telemetry remains `INSUFFICIENT_EVIDENCE` until independently reviewed case rules exist. Duplicate findings/event counts alone never yield `CONFIRMED`; truncation remains explicit. For this opt-in SOC path the authority recomputes verdict from the validated evidence, not caller/model text, while keeping submitted-envelope replay identity unchanged. Historical rows are not rewritten. Legacy non-SOC receipt path is not retroactively authority-normalized by this change; newly built worker uses v2.
- Authority and worker share the same allowlisted UDM template/hash implementation; malformed IPs, raw query parameters, window/limit or template-hash mismatches fail closed.
- The Control Plane verifies the evidence JSON hash against immutable artifact registration, stored task/case/parameters and evidence identity. It reconstructs the ObservationPack rather than persisting caller/model facts; deterministic observation IDs prevent cross-task caller-ID reuse.
- Migration 017 adds immutable `hypothesis_plans`, unique per run/Frontier. Plan receipt, Frontier, decision, outbox, run transition and result receipt share the result transaction. Failed receipt persistence rolls back them all. Restart returns stored receipts; outbox recovery checks the plan reference and decision consistency.
- `GET /control/v1/cases/:id/frontier` includes the persisted hypothesis plan for this policy, through existing authorization. No separate UI/model/worker lifecycle writer is added.

## Configuration — not a readiness claim

Control Plane-only flags for **new** investigation runs:

```dotenv
GSS_INVESTIGATION_POLICY=gss.soc-evidence.v1
GSS_SOC_SIEM_READ_ONLY_AUTHORIZED=true
```

Migration 017 is required. Do not turn the authorization flag on just to make a test/dashboard green. Real Chronicle tenant/viewer permissions, authorized dataset and actual worker connectivity remain required. Default example configuration remains the legacy policy with SIEM authorization false; the private runtime `.env` was not changed. Lab metadata-only imports remain on their separate insufficient-evidence policy; this feature does not masquerade a lab query as Chronicle.

Local runtime migration 017 was applied after loopback/ledger checks and a private native backup; 245 existing cases/295 tasks/3 usage rows preserved. Actual isolated recovery drill PASS at 19:56 local: native restore of the pre-017 archive, ledger checksum verification, transactional upgrade of the restored copy to 017 and count preservation. The exact owned copy database was removed; archive retained privately. An initial SQL-escaping failure rolled back and is not hidden. Original runtime data was not deleted. This is local recovery proof, not HA, filesystem encryption/ACL or staging recovery certification. No paid provider, new company log collection, cloud installation or GitHub publication.

## Current limits / follow-up

- This v1 hypothesis tests a narrow telemetry-observation claim, not attack intent, root cause or compromise. L1/L2 analyst rubric and an independently reviewed corpus remain necessary.
- Candidate evaluation is bounded to 16 valid typed indicators and extraction to 128 values per observation/20 values per field array. Partial extraction is now a provenance-linked processing observation; optional versioned coverage metadata records assessed/omitted indicator counts and partial evidence references, hash-bound to the durable plan. The UI discloses these limits. No overflow recorded does not prove full tenant/host telemetry coverage.
- Exact typed-value matching is conservative; no claim of canonical alias/entity resolution, calibrated probability or independent corroboration.
- Shared query-template hash binding is implemented/tested. Artifact hashing does not independently attest that the external API call happened.
- No evidence-driven lab worker path yet; metadata-only own-device report is insufficient for this SOC gate. Chronicle live and lawful richer telemetry remain external prerequisites.
- Model/Hypothesis Reasoner, richer hypothesis testing/timeline/ATT&CK/intel/reporting, rootless sandbox and model eval are separate unfinished gates.
- `/standalone/investigation` now displays retained run state, budgets, hypothesis status/gaps, selected-question reason/references, contradictions and fact provenance. GET-only through the existing case ACL; no dispatch/approval buttons. Metadata-only/legacy cases explicitly disclose that no stored hypothesis plan exists. Client display contracts reject malformed or cross-case data; large payloads are bounded and fact rendering paginated. Browser fixture checks are separate from actual runtime checks. Full launcher boot, clean install and production/pilot gates remain separate.

Owner: user is product/release owner; Codex is engineering/review support, never an independent approver. Do not claim roadmap completion from the three-step fixture transaction test.
