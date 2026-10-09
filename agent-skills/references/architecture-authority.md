# GSS Architecture Authority

Read this reference when a task spans multiple GSS components, when a document conflicts with code, or when a milestone status is being claimed.

## Source precedence

1. Latest explicit project-owner decision.
2. `GSS_Architecture_Conversation_Notes_Updated.docx`.
3. Verified repository code and tests.
4. Recent Codex implementation/security reports.
5. Legacy roadmap, phase and assessment documents.

## Current non-negotiable decisions

- PostgreSQL is the durable source of truth. There is no SQLite runtime fallback.
- TypeScript source is authoritative; generated `.js` and `.d.ts` files are not the implementation source of truth.
- Standalone is the primary human SOC surface and security decision layer.
- Control plane owns orchestration, governance and execution state.
- CLI, IDE and SIEM are workers with explicit capabilities and identities.
- Chronicle access is read-only and belongs to the SIEM worker.
- IDE investigation is repository/config analysis; it does not own SIEM credentials.
- LLM output is not evidence, authorization, approval or proof of execution.
- Remediation, SIEM writeback, merge and deployment remain disabled unless separately authorized and implemented behind durable approval.

## Milestone interpretation

| Milestone | Meaning | Current planning status |
|---|---|---|
| M0 | Real conversation path | Implemented locally; regression only |
| M1 | Typed task/result contracts | Implemented locally; preserve compatibility |
| M2 | One bounded executor | CLI read-only slice implemented |
| M3 | Real SIEM read path | Adapter implemented; staging E2E externally blocked until configured |
| M4 | Context/evidence persistence | ObservationPack, artifact and PostgreSQL foundations implemented |
| M5 | IDE read-only investigation | Local WebSocket/artifact/ObservationPack slice verified; IDE-specific live PostgreSQL E2E not independently established |
| M6 | Automatic evidence-driven next step | Local four-step HTTP/WebSocket/PostgreSQL loop and outbox restart verified with labeled worker fixtures; not Chronicle staging |
| M7 | Durable approval in runtime | PostgreSQL-backed API and local Approval Desk implemented; staging browser OIDC and proposal execution remain blocked |
| M8 | Model routing and cost evaluation | Provider-only nullable accounting and offline comparison harness implemented; live provider reconciliation and labeled SOC corpus remain unverified |

Status update: 2026-10-03. See `GSS_REMAINING_TASKS_ADVANCEMENT_2026-10-03_CODEX.md` for current work and verification evidence. Durable intake, pg-boss-backed acquisition, persisted halt and task-acceptance ACK are implemented locally. Task watchdog recovers uncertain execution as failure, not fabricated evidence or automatic re-execution. RESULT_ACK is distinct from acceptance ACK. Exactly-once physical execution and distributed fleet recovery are not claimed. Ed25519 verify-only task authorization, OIDC/MFA API policy, mTLS transport, S3 retention and OTLP adapters have local/fixture coverage, not staging certification. Source authority and the sole Control Plane writer remain enforced. External prerequisites and unfinished implementation are listed explicitly in the current report.

## Claim discipline

- `PASS`: the required command or runtime path ran successfully and its output is available.
- `FAILED`: the attempted verification ran and failed.
- `BLOCKED`: an external prerequisite or permission prevents execution.
- `NOT RUN`: verification was not attempted.

Never translate `BLOCKED` or `NOT RUN` into `PASS`. Dashboard output, mock provider output and model prose cannot establish a production or staging claim.
