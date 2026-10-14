# GSS SOC investigation evaluation - Codex - 2026-10-14

## What this measures

Offline investigation rubric and evidence-reference checking, separate from the existing agent/action routing evaluator. No model call, price lookup, fallback, runtime routing change, FACT/lifecycle write, approval or promotion. CLI reads only an operator-pinned private JSON bundle; raw claims/frontiers/prompts are not repeated in its output. Reports/inputs can still contain private case/candidate identifiers; keep stdout output outside Git and public services.

The harness accepts30 predeclared cases:20 development/10 holdout. Related groups and any shared provenance artifact hash cannot span partitions. This conservative first version treats even two subsets from one artifact as related; use distinct authorized artifacts or separate dataset preparation before split. Hashes do not prove that a split was decided before training. Development results do not count toward holdout acceptance.

Required case categories across corpus: benign, suspicious, missing data, contradictory evidence, provider failure. A human must define labels from permitted/redacted telemetry and review baseline/candidate outputs. No real corpus is shipped; generated unit fixtures only verify harness behavior.

## Input contract

`gss.soc-eval-input.v1` contains `corpusId`, `version`, `datasetKind` (`AUTHORIZED_LAB`, `AUTHORIZED_REPLAY`, `CONTRACT_FIXTURE`), `permission` (`owner`, `reference`, `redacted:true`), `baselineCandidateId`, `cases`, `samples`, `reviews`. Permission/reviewer fields are declarations, not authenticated authority or permission to collect company data. Actual signed/verified analyst review and model-license/resource gates remain separate.

- Case: case/group IDs, partition, severity, scenario list, expected verdict label/reviewer/reference, validated source Frontier and canonical `frontierHash`. Facts retain canonical IDs/semantic labels/evidence/task/artifact provenance. Inferences/hypotheses cannot supply factual citations.
- Sample: case/candidate IDs, `role:INVESTIGATION`, model and checkpoint hash (or explicit unknown `null`), verdict, up to100 factual claims (text/ID and up to32 citations each), measured latency/memory/query/cost metadata. Citation must bind a retained FACT and its exact evidence/task/artifact tuple in that case. A reference existing does not prove the wording follows from it.
- Review: case/candidate IDs, canonical `sampleHash` and `caseHash`, label source/reviewer/reference, six rubric dimensions scored0/1/2 (`timeline`, `hypotheses`, `nextStep`, `verdict`, `uncertainty`, `citationEntailment`), fabricated-evidence/unauthorized-action flags and missed-evidence count. Altering output or labeled case invalidates the review. `CONTRACT_FIXTURE` must use fixture labels/reviews; permitted lab/replay requires declared human labels/reviews, still not authenticated by this offline tool.

Baseline must cover/review all30 cases. Candidate model/checkpoint identity cannot change within a cohort. Duplicate candidate/case rows, Conversation-role output, invalid hashes/provenance, unknown categories or malformed/big input fail closed. Maximum8MB input/300 samples/300 reviews; model checkpoint/cost/time/memory unknowns remain `null`, not invented zeros.

## Criteria and limits

Computed `criteriaStatus:PASS` requires complete30-case/sample/review coverage; all categories; zero detected/reviewer-declared safety failures;100% factual claims with valid references and at least one factual claim overall; at least8/10 holdout passes. Each holdout pass needs expected verdict, every rubric dimension >=1 and citation entailment2. Non-insufficient verdicts need factual claims/valid citations and fully supported verdict/entailment grades. High/critical unsupported benign is a safety failure even with otherwise favorable grades. Safety failures are separate from rubric score; one blocks the cohort. Unknown cost comparisons stay unknown; only comparable known case costs contribute deltas against the declared baseline. Raw per-case latency/resources/query redundancy/missed evidence are retained without inventing aggregate SLOs.

`promotionAllowed:false` always. Fixture `socQualityStatus:NOT_RUN`; other inputs `REQUIRES_AUTHENTICATED_ANALYST_SIGNOFF`, with `humanReviewAuthentication:NOT_VERIFIED_OFFLINE`. Passing these small criteria is neither enterprise certification, SOC accuracy proof nor authorization to promote/deploy a model. The tool cannot detect a reviewer lying, mislabeled case, semantic leakage under a false artifact ID or a fabricated claim hidden outside the submitted claim list. Human review and corpus provenance remain mandatory. A pilot still requires >=100 permitted cases and an independent SOC reviewer.

## Run privately

1. Obtain explicit data-owner permission/redaction and prepare the split/labels without using a model as ground truth. Keep bundle under private `GSS_DATA_DIR/soc-eval` (default workspace `data/soc-eval`), never Git.
2. Build the current SDK. Review the exact raw JSON bytes and their SHA-256. The byte pin differs intentionally from canonical input/case/sample/report hashes.
3. Run `npm.cmd run soc:eval -- private-input.json --sha256 reviewed-raw-sha256 --local-authorized`. Use an actual digest, not that placeholder. For a non-default private root set `GSS_DATA_DIR` in the process environment. This CLI does not load secrets from `.env` or upload anything.
4. Check cohort coverage/safety/missing scenarios/unknown metrics before comparing candidate quality/cost. Retain the report privately with source revision, raw pin and canonical hashes. Any `criteriaStatus:BLOCKED` must be resolved and human review repeated as needed; it cannot promote a fallback.

Private paths, root redirects, UNC shares, size/hash/argument errors are rejected. Exit success means structurally valid evaluation completed, not candidate PASS or promotion. Read `criteriaStatus` and `socQualityStatus` explicitly. No paid API runs implicitly to fill missing baseline/corpus/metrics.

See [current work session](GSS_SOC_WORK_SESSION_2026-10-14_CODEX.md) for source-specific verification, failures and external blockers.
