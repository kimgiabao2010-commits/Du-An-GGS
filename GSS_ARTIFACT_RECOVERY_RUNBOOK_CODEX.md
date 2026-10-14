# GSS approved artifact recovery - Codex - 2026-10-14

Explicit references only; no recursive backup of a data directory, private/company log discovery or overwrite of the working store. `backupApprovedArtifacts` accepts at most256 approved refs/128MiB total, at most8MB per ordinary artifact and512KB per lab batch. Supported local forms: `artifact://evidence/<case>/<task>-<hash12>.txt` with SHA-256 of bytes, and `artifact://lab/<batch-hash>.json` with validated canonical lab-batch SHA-256. S3/unknown/path traversal, duplicate refs, size/hash mismatch and symlink/reparse/network roots fail closed; no fallback.

Each backup uses a fresh UUID directory, content-addressed raw blobs, private manifest and canonical manifest hash. Raw blob hash differs intentionally from a canonical lab-batch hash. Restore verifies the pinned manifest and each raw/semantic digest, then creates another fresh isolated UUID root, writes only new files and rechecks output. Original files are never removed/overwritten. A failed partial copy is retained privately, unverified, and must not be adopted. This is not encryption, Object Lock or atomic whole-system backup.

Run selected own-device metadata rehearsal:

```powershell
npm.cmd run lab:artifact-recovery -- --case LABCASE-your-authorized-case --own-device --local-authorized
```

Requires loopback local PostgreSQL, an unexpired LAB_LIVE `local-windows` metadata case and its original hash-valid artifact. It performs read-only existing database queries and compares the report with a restored artifact root. It does not restore PostgreSQL or certify every other case/artifact. Backups/restore directories/receipts remain private under ignored `data`; do not publish them. Other sources need separate owner permission and explicit references, not merely the existence of their files.

Actual14/10 rehearsal PASS at13:56:18 Bangkok: one45,813-byte authorized lab artifact, canonical manifest `e1bab24ff5547bc6a8efd1854581ed89bae9bc0f7dabda8391e235798531983a`, restored report digest equals retained report, original unchanged. Receipt `data/verification/lab-artifact-recovery-1791960978092.json`. This complements the separately dated PostgreSQL restore-and-upgrade drill, but is not a combined full-store recovery or separate-host release gate. Fixtures test missing/tampered refs/blobs/manifest, traversal/remote/duplicates, junctions and independent restore roots.

Full system recovery still requires a reviewed inventory of all permitted registered artifacts, matching DB/archive snapshot, integrity/retention policy and an isolated combined restore. Unknown/missing/private unauthorized artifacts cannot be reconstructed from model summaries or silently ignored.
