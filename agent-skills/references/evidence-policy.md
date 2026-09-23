# GSS Evidence Policy

Read this reference whenever a workflow creates, transforms, correlates or cites operational evidence.

## Evidence requirements

Operational evidence must have a real source and stable provenance. As applicable, record case/task identifiers, source adapter/tool and version, query or artifact hash, source instance or repository root, collection time, event IDs or file/line coordinates, result/output counts, truncation, redaction and verification status.

## Separation of data classes

- **Raw artifact:** immutable source output stored once with a SHA-256 digest.
- **Evidence record:** normalized, allowlisted facts with provenance.
- **ObservationPack:** bounded context derived from evidence for model reasoning.
- **Verdict:** deterministic/policy-versioned conclusion linked to evidence IDs.
- **Model summary:** explanatory text; never evidence by itself.

## Failure semantics

- Authentication or permission denial: `BLOCKED`/`FAILED`, no evidence.
- Invalid query or invalid target: `FAILED`, no evidence.
- Timeout or upstream failure: `FAILED`, no evidence.
- Rate limiting after bounded retry: `BLOCKED`/`FAILED`, no evidence.
- Zero valid results may support `INSUFFICIENT_EVIDENCE`; do not invent events.
- Truncated results must carry `truncated=true`; do not treat the set as complete.

## Forbidden transformations

- Do not create event IDs, file matches, hashes or timestamps from model text.
- Do not silently remove provenance to reduce context size.
- Do not convert demo/dashboard data into operational evidence.
- Do not let a summary overwrite the raw artifact.
- Do not mark remediation verified without authorized build/test/runtime evidence.

## Context reduction

Store raw data once, normalize allowlisted facts, build a bounded ObservationPack, pass IDs/hashes/minimal excerpts to the model, and retrieve raw data only when verification requires it.
