# GSS offline threat-intel annotations - Codex - 2026-10-14

## Scope and trust

Exact typed IP/domain/hash comparison against an operator-approved offline catalog. No URL fetch, external IOC transmission, model call, FACT creation, verdict change or dispatch authority. Matching is case-sensitive and exact; no inferred hostname/asset identity or domain/hash normalization. No match does not mean benign. Contradictory classifications remain separate feed records. Source/record/license URLs are references only, never opened by this feature.

Source authenticity, data permission and license suitability require a human review. A raw SHA-256 pin detects changed bytes; it does not authenticate a feed or prove its license. `APPROVED_FOR_OFFLINE_LOCAL_USE` records the operator declaration, not an independent approver. No feed ships with GSS and no company/private IOC export is newly authorized.

## Operator setup (disabled by default)

1. Obtain permission and review source/license/update/retention for the particular feed. Do not upload catalog/IOCs to GitHub, a model provider or public service.
2. Convert only approved IP/domain/hash entries to `gss.offline-intel-catalog.v1`. Keep the JSON under the private `GSS_DATA_DIR/offline-intel` directory, outside Git. Unknown fields are rejected, including unrestricted text/instructions/secrets. Limit512,000 UTF-8 bytes/1,000 records. URLs must be HTTPS with no credentials, query or fragment.
3. Review the exact raw bytes and record their SHA-256. Set private `GSS_OFFLINE_INTEL_CATALOG_FILE` to an absolute `.json` path and `GSS_OFFLINE_INTEL_CATALOG_SHA256` to that digest. Both settings must be present together; missing/invalid/pin/schema/path/size failures stop configured startup, never silently fall back. UNC paths and redirecting catalog roots are denied. Launcher passes these settings only to Control Plane, never browser/workers.
4. Restart through the existing launcher after checking pending-task safety. Catalog is loaded once before the listener starts; changing a file does not silently replace the running source. Both raw pin and canonical catalog hash are distinct and intentional.
5. Read authenticated incident-ACL `GET /control/v1/cases/:id/report` or use the investigation page's report JSON download. `offlineIntel` is additive; no new visual panel or route is claimed. It binds the atomic entity snapshot hash, evaluation time and catalog metadata/hash, then each match's provider event/index, field, source value key, evidence/task/projection/artifact.

Catalog shape (placeholders are not an approved live feed):

```json
{
  "schemaVersion": "gss.offline-intel-catalog.v1",
  "catalogId": "operator-approved-source-id",
  "version": "reviewed-source-version",
  "sourceUrl": "https://source.example/source",
  "license": {"identifier": "reviewed-license-id", "url": "https://source.example/license"},
  "review": {
    "owner": "real-reviewer-id",
    "reviewedAt": "2026-10-14T05:00:00Z",
    "authorization": "APPROVED_FOR_OFFLINE_LOCAL_USE"
  },
  "updatedAt": "2026-10-14T04:00:00Z",
  "expiresAt": "2026-10-15T04:00:00Z",
  "entries": []
}
```

Each entry must contain only `recordId`, `type` (`IP`, `DOMAIN`, `HASH`), `value`, `classification` (`REPORTED_MALICIOUS`, `REPORTED_BENIGN`, `UNKNOWN`) and `referenceUrl`. Record IDs are unique; different records for the same value are retained, not resolved into ground truth. Update <= review < expiry; validity window is bounded to366 days. Before review: `NOT_YET_VALID`; at/after expiry: `EXPIRED`. Both produce no active matches. Unconfigured: `NOT_CONFIGURED`, never an implicit clean result.

## Bounds, provenance and verification

Only the retained authority entity snapshot is compared: at most32 source projections,200 events and500 mentions. Match output is limited to200 annotations; total/omitted matches and partial evidence remain explicit. Catalog metadata is included but the entire feed is not copied into reports. JSON report size remains bounded2MB and existing no-store/incident ACL still apply. An annotation is evaluated at report time, not an immutable historical decision; save its hash-bound report if retention is required. No database migration or lifecycle write occurs.

Unit fixtures prove exact matching, provenance/determinism, zero/expired/unconfigured/future-review semantics, conflicting feed labels, bounds and invalid metadata/permissions. Private loader fixtures cover reviewed pin, path/UNC/size denial and no fallback. Real isolated-PostgreSQL report tests prove snapshot binding and unchanged Frontier/decision. These are labeled fixtures, not real feed/license/SOC quality evidence. Actual permitted feed remains NOT CONFIGURED; whole staging/pilot gates remain separate.

See [current work session](GSS_SOC_WORK_SESSION_2026-10-14_CODEX.md) for fresh verification receipt and blockers.
