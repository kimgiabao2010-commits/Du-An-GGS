# GSS UI/UX Redesign — Codex

## Outcome

The standalone frontend is now a light-first AI agent operations workspace. The visual system is intentionally neutral, precise, low-noise and content-led, with restrained blue and semantic status colors.

The redesign preserves the existing authentication and WebSocket command contracts. It does not add fake backend APIs. Data that is not available from the control plane is isolated in an explicit `demoOperationsData` adapter and labelled **Demo adapter** in the interface.

## Design system

- System font stack: `-apple-system`, BlinkMacSystemFont, SF Pro fallback, Helvetica Neue, Arial.
- Background: soft neutral; surfaces: white; text: near-black with neutral gray hierarchy.
- Blue is reserved for navigation, active state and informational action.
- Green, amber and red only communicate success, warning and failure.
- Spacing and typography establish hierarchy before borders, cards or shadows.
- Motion is short and purposeful and honors `prefers-reduced-motion`.
- Focus states, skip navigation, semantic tables, accessible labels and non-color status labels are included.

## Information architecture

1. Overview
2. Tasks
3. Executions
4. Execution Detail
5. Agents
6. Evidence
7. Cost & Context
8. Logs
9. Command Center
10. SIEM

Execution Detail is the signature workflow. Its trace distinguishes task, decision, Action Fusion, tool call, ObservationPack, evidence reduction, context compaction and result. Details expand progressively instead of showing raw payloads by default.

## Data boundary

`apps/standalone/lib/operations-data.ts` defines the frontend data contract and local fixture implementation. Replace `demoOperationsData` with a live implementation only after durable task, execution, agent, evidence, context-cost and log query APIs exist.

The live Command Center continues to use:

- `POST /api/auth`
- WebSocket at `ws://localhost:4000`
- existing `COMMAND` and `STATUS` messages

SIEM screens remain clearly blocked/demo until a read-only Chronicle adapter is configured.

## Run locally

Press `Ctrl+Shift+B` and select the default task **GSS: Run local stack**. It first creates a stable local production build, then starts Command Center, CLI worker, IDE agent and the Web UI together. This avoids Windows file-locking failures in the Next.js development manifest.

The terminal prints the local URL and the credential generated for that run. If ports `3000` or `4000` are already occupied, stop the previous process with `Ctrl+C` and run the shortcut again.

## Validation

- Monorepo production build: passed.
- Next.js compile, lint/type validation and static generation: passed.
- Unit tests: passed.
- Integration tests: 28 passed.
- Runtime smoke test: passed.
- Production route checks: all redesigned routes returned HTTP 200.
- Desktop visual render: reviewed at 1440 px.

The smoke test does not prove live SIEM, production sandbox, deployment or durable audit integration.
