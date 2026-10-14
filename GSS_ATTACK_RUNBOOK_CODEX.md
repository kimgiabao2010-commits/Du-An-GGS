# ATT&CK v1 literal-provider-label annotations - Codex

Scope is narrow: a validated hash-bound Chronicle-contract event may contain an exact `security_result[index].threat_name` technique ID such as `T1110`. Rule `gss.attack.provider-label.v1` resolves that ID against an operator-pinned Enterprise knowledge catalog. A USER/IP/hostname, arbitrary threat prose or a technique substring NEVER creates a match. This does not implement behavioral ATT&CK detection, prove compromise, generate facts, choose a verdict or grant dispatch authority. Lab metadata has no approved ATT&CK semantic fields; it stays unprojected.

## Source and license

Primary source: [MITRE data/tools](https://attack.mitre.org/resources/attack-data-and-tools/), [official STIX2.1 repository](https://github.com/mitre-attack/attack-stix-data), [license at the pinned revision](https://github.com/mitre-attack/attack-stix-data/blob/20664a889568dce884a1dac0ec7b12ae3a199f51/LICENSE.txt). The data/schema is public knowledge, not organizational telemetry. Retain the complete source notice with derived catalogs; operator review is required, not legal certification or independent SOC review.

Prepared public Enterprise v20.0 at commit `20664a889568dce884a1dac0ec7b12ae3a199f51`:

- STIX55,271,014 bytes / SHA256 `81113ba98afa2928f3dcff62022539f7ce30c315c32e14422f11ff95ce534352`, Git blob `b39ce73c609d0f028841546e042ec16ffd7fe63f`.
- License1,354 bytes / SHA256 `738144f7fb054722a4ef9d3367c51710341dc12fc574c6ac3a41daaaecd8bf5e`, Git blob `7d8dc97542672cc9ec78de1b643b5b39ca7e2fba`.
- Preparation verified exact sizes/Git blob against the official pinned tree and computed SHA256.26690 objects/867 technique objects/706 active before normalized import. Full source/license/private preparation receipt stay under `data/knowledge`, not Git. No IOC/company data transmitted, runtime activation or paid calls.

## Explicit private import

Build workspace outputs before using the CLI. Importer opens only local files under `GSS_DATA_DIR/knowledge`, not UNC/root redirects/path escapes; exact raw-byte pins,64MB bundle/16KB notice limit,50000 objects and4096 normalized active techniques. Reject invalid/duplicate IDs, technique URLs and metadata; exclude revoked/deprecated/non-enterprise objects, drop descriptions/instructions, keep versioned IDs/name/tactics/source links. Normalized catalog<=1MB; canonical hash and raw file hash are distinct. Review/expiry use explicit UTC ISO strings and no more than366 days. Full pinned notice is retained with the derivative.

```powershell
npm.cmd run attack:import -- <private-bundle-path> <bundle-sha256> <private-license-path> <license-sha256> 20.0 <commit-sha> <review-owner> 2027-01-01T00:00:00Z --local-authorized
```

CLI creates a fresh UUID private catalog directory and returns metadata/pins only; it NEVER modifies `.env`, activates runtime, queries providers, sends telemetry or asserts independent review. JSON review fields are declarations (`OPERATOR_PIN_NOT_SIGNATURE`), not authenticated legal/source/analyst endorsement. Malformed private input is omitted from errors. The fixture importer tests are not source/license/quality attestation.

## Optional Control Plane configuration

Defaults disabled. After actual source/license review, configure `GSS_ATTACK_CATALOG_FILE` with the normalized local absolute JSON path and `GSS_ATTACK_CATALOG_SHA256` with its exact raw-byte pin. Control Plane-only: not UI/workers/Conversation/model context. Read once before listen; invalid configured input fails startup, no silent fallback. Stale or future-reviewed knowledge produces no matches. No automatic feed download/refresh and no IOC egress.

For SOC-policy results, authority derives an additive projection from the verified evidence bytes and overwrites caller/model ATT&CK fields. Failed results cannot supply it. Projections keep timeline, event ID/index, security result index, query hash, artifact hash, task/evidence references and rule version; old/legacy/unprojected queries are explicitly counted.32 projections/200 output matches; omission/truncation remain visible. Atomic repeatable-read case report adds `attack`; existing ACL/no-store/download integrity remain unchanged. Frontier/decision/outbox do not gain ATT&CK-generated facts or authority. No UI aesthetic redesign; annotations appear in authorized report JSON.

## Verification and remaining limitations

Test raw pin/path/schema/unknown fields, invalid/revoked/deprecated/duplicate technique identities, exact ID versus malicious prose, USER/IP-only no-match, hash/case/event tampering, replay, caller overwrite, expiry/absence, bounded omissions and no Frontier change. Eight unit cases and authority integration included in [final427-test source verification](GSS_SOC_VERIFICATION_2026-10-14_MODEL_PRODUCT_CODEX.json), not the earlier411-test scheduler proof. Actual normalized public v20.0 import706 techniques/full notice hash PASS: [import receipt](GSS_ATTACK_IMPORT_2026-10-14_CODEX.json). First missing-trailing-slash incompatibility retained/corrected with exact host/path/ID compatibility; no generalized URL trust.

Public import/rule engineering is not actual SOC accuracy. Behavioral rules, permitted semantically rich lab/Chronicle cases, independent analyst labels/holdout and pilot still required. Do not label no-match BENIGN or literal technique label CONFIRMED. Optional knowledge remains disabled in the user's runtime unless explicitly reviewed/configured; no production claim.
