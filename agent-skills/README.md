# GSS Agent Skills

This directory is the portable, repository-owned workflow layer for GSS. It stores narrowly scoped skills; it is not a copy of a third-party skill catalog and it does not grant runtime permissions.

## Operating model

1. Use `gss-skill-router` to select one primary workflow.
2. Load only the references named by that workflow.
3. Keep raw logs and artifacts outside model context; use bounded ObservationPacks and references.
4. Use `gss-verification-gate` before claiming a change or milestone is complete.
5. Treat missing credentials, unavailable infrastructure and failed tools as `BLOCKED` or `FAILED`, never as evidence.

## Skill registry

| Skill | Milestone | Purpose |
|---|---|---|
| `gss-skill-router` | All | Select the smallest applicable workflow and expose assumptions, scope and risk. |
| `gss-ide-readonly-investigation` | M5 | Implement or verify bounded, read-only repository investigation. |
| `gss-evidence-next-step` | M6 | Implement or verify deterministic, bounded follow-up task planning. |
| `gss-durable-approval` | M7 | Implement or verify PostgreSQL-backed, artifact-bound dual approval. |
| `gss-model-routing-eval` | M8 | Implement or evaluate risk-aware model selection and usage accounting. |
| `gss-verification-gate` | All | Produce evidence-backed PASS/FAIL/BLOCKED completion reports. |

## Validation

Run:

```powershell
npm.cmd run skills:audit
```

The audit checks skill frontmatter, required safety sections, line budgets, reference links and eval JSON. It validates structure, not behavioral quality; the eval cases under `evals/` are the behavioral contract.

## Authority

The latest explicit owner decision wins, followed by the architecture conversation document, verified code/tests, recent Codex reports and then legacy phase documents. PostgreSQL is the only durable runtime database for the current implementation.
