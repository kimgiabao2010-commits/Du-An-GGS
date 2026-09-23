# GSS Definition of Done

Read this reference when planning acceptance criteria or deciding whether work is ready to hand off, commit or publish.

## Required engineering gates

Run from the repository root with `npm.cmd` on Windows:

```powershell
npm.cmd run skills:audit
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

Use focused tests during implementation, but the final gate requires the relevant full suites. `npm.cmd run test` includes unit, integration and smoke flows in the current package scripts.

## Required review gates

- Acceptance criteria are checked against behavior, not wording.
- Changed files are reviewed for accidental scope expansion.
- Security boundaries remain intact.
- Evidence/provenance and idempotency behavior are covered by tests.
- No secret, credential or private evidence is added to source control or reports.
- Documentation reflects verified behavior and names external blockers.
- Git diff checks clean for changed text/source files.

## Completion report

Report each gate as `PASS`, `FAILED`, `BLOCKED` or `NOT RUN` with the command or observable evidence. Include skill audit, typecheck, tests, build, runtime/staging and security/diff review.

## Stop conditions

Do not claim completion when a required gate failed, an environment was not exercised, evidence came only from mock/demo/model output, an external operation was assumed, or unrelated user changes would need to be overwritten.
