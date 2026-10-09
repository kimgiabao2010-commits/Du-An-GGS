# Workload identity binding — v1

This is a server-side transport trust boundary, not user authorization. Staging Control Plane and Command Center require `GSS_TLS_WORKLOAD_POLICY_FILE`, in addition to their service-specific TLS certificate/key and CA paths. PostgreSQL migration 015 adds a permanent certificate deny floor. Local loopback remains compatible without mTLS opt-in; staging never falls back to file-only trust. Local mTLS may enforce the same requirement with `GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION=true`.

## Policy

Operator-owned JSON, maximum 64 KiB. The example below is documentation only: replace the placeholder with the actual lowercase SHA-256 hash of the **DER leaf certificate**, not the PEM text or public key. Keep policy files outside the browser bundle and restrict writes to the certificate operator. Never place private keys in this file.

```json
{
  "schemaVersion": "gss.workload-policy.v1",
  "workloads": [
    {
      "workloadId": "cli-worker-agent",
      "dnsName": "cli.gss.internal",
      "pins": ["REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"]
    }
  ],
  "revokedFingerprints": []
}
```

Use separate non-CA leaf certificates with exact DNS SAN and clientAuth EKU for each process:

Server listeners additionally need serverAuth EKU and the DNS/IP SAN used by the client's connection URL. Workload identity SAN does not replace normal TLS hostname verification.

| Workload | Derived transport role | Accepted destination |
| --- | --- | --- |
| `command-center` | `STANDALONE` | Control Plane service bearer |
| `ui-gateway` | `UI_GATEWAY` | Control Plane operator credential; Command Center signed admin session |
| `cli-worker-agent` | `CLI_DAEMON` | Command Center, matching worker token only |
| `ide-worker-agent` | `IDE_AGENT` | Command Center, matching worker token only |
| `siem-worker-agent` | `SIEM` | Command Center, matching worker token only |

CA verification and proof of private-key possession occur in TLS 1.3. The application separately checks leaf validity, non-CA status, clientAuth EKU, exact DNS SAN, leaf pin, and role/token binding. Common-name fallback and wildcard matching are disabled using [Node X509Certificate.checkHost](https://nodejs.org/api/crypto.html#x509checkhostname-options). A certificate with multiple configured workload SANs is denied. Pins and names cannot be shared across workloads.

Control Plane applies the transport policy before health endpoints as well: monitoring needs an authorized command-center or gateway certificate. Existing OIDC/MFA, RBAC and case ACL checks still apply after transport validation; a gateway certificate alone does not grant user permissions. Direct worker calls with a stolen Control Plane bearer are denied. Browser SSO staging remains a separate hard gate.

## Rotation and withdrawal

1. Issue a new leaf with the same exact workload SAN, distinct key and valid clientAuth EKU.
2. Atomically replace the JSON file with both old/new leaf pins (maximum two per workload).
3. Move that workload to its new certificate/key and reconnect. Verify identity and evidence provenance independently.
4. Remove the old pin, or add it to `revokedFingerprints` (maximum 128). Persist the denylist through future policy replacements.
5. Verify old certificate connections are denied and the new leaf still works. A fresh server reads the same file at startup.

Every incoming API request, accepted WS frame and outbound WS dispatch rereads the policy. Authority-integrated WS additionally queries Control Plane's PostgreSQL deny floor on handshake, frame and authorized dispatch. Idle WS connections are revalidated every two seconds; this is subject to event-loop scheduling, not a hard distributed revocation SLA. Existing sockets are closed with policy code 1008 on denial or authority unavailability. Missing, malformed or oversized policy fails closed; no cached-success fallback. Use atomic file replacement to avoid temporary parse failures during rollout.

## Permanent PostgreSQL revocation

- `POST /control/v1/workload-certificates/revocations`: authenticated SECURITY_ADMIN only, never internal service bearer or a caller-supplied actor/role. In staging this remains behind OIDC/MFA and UI gateway mTLS. It is an emergency **deny-only** action, not enrollment or proposal approval.
- Body: `schemaVersion: gss.workload-revocation.v1`, exact lowercase `fingerprint` (64 hex), `workloadId` (one fixed ID), `idempotencyKey` (1–256 characters), `reasonHash` (64 hex). Keep a sensitive explanation outside public transport/report payloads; submit only its digest.
- Same key/body/trusted actor returns 200 with the original receipt; first commit returns 201. Conflicting body/actor/key or already-revoked leaf under another key returns 409. Revoke does not authorize execution or undo prior withdrawal.
- Tombstone, monotonically increasing revision and audit commit in one transaction. SQL update/delete/truncate of tombstones and revision rollback are denied. No un-revoke endpoint exists: issue a new certificate/key to regain access. Pin allowlist rollback or workload reassignment does not overcome a fingerprint tombstone.
- `GET /control/v1/workload-certificates/revocations`: bounded most-recent 100 records for SECURITY_ADMIN/AUDITOR or service authority. `POST .../check` is service-only and returns `{allowed:true,revision}` only if authority is available and fingerprint is not revoked; revoked = 403, storage failure = 503.
- Command Center uses the native mTLS service client and asynchronous send APIs; synchronous SDK send helpers return false when a durable authorizer is active, preventing bypass. Authorization calls are bounded at two seconds for CP HTTP / three seconds at WS; maximum eight queued frames per socket, 64 pending authenticated upgrades and 200 TLS connections.
- The floor is checked at discrete authorization points. An action authorized before a revoke commits may already be in flight; this is not physical cancellation or a zero-latency distributed revocation guarantee.

## Explicit limits

- Local integration tests generate disposable PKI and contact real local mTLS endpoints and isolated PostgreSQL. They are not staging/production PKI evidence.
- No automatic CA issuance, CRL/OCSP lookup, HSM, certificate inventory service or distributed revocation acknowledgement is provided.
- File-only local SDK usage without a durable authorizer can still reauthorize a withdrawn pin after file rollback. Staging forbids this mode. The full enrollment/grant policy is still operator-owned JSON: dual-control publication, signed policy distribution and durable versioned enrollment are not implemented by the deny-only floor.
- PostgreSQL superuser/DDL compromise or rollback of the entire database snapshot is outside this floor's protection; require backup anti-rollback/retention and privilege isolation. Database triggers are application safeguards, not an HSM or external transparency log.
- CA-trusted/pinned credentials can still be stolen; retain key isolation, short validity, user authorization, least privilege and audit.
- No remediation, SIEM writeback, merge or deployment permission is added.

## Verification

`npm.cmd run test:integration -- workload-binding.test.ts workload-revocation.test.ts` tests exact SAN/role binding, CA-trusted unknown peers, token swap/admin impersonation, Control Plane service/gateway separation, two-pin rotation, outbound deny after withdrawal, idle revocation, malformed/missing policy, immutable tombstones, transaction/audit rollback, idempotency, pin-file rollback and PostgreSQL/authority restart behavior. The runner migrates only its disposable PostgreSQL schema, never the runtime schema.

Live staging acceptance still needs operator-issued distinct certificates, complete five-workload policy, real OIDC/MFA sessions, rotation/revocation rehearsal and audit/trace evidence. Do not mark that gate PASS from these local fixtures.
