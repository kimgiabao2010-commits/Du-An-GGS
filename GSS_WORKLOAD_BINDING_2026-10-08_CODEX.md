# GSS — Workload Identity Binding & Roadmap Checkpoint — Codex

Ngày: 2026-10-08. Mốc bàn giao người dùng yêu cầu: **11:30:00 Asia/Bangkok (UTC+7)**.

Checkpoint bàn giao: đã lưu code, lockfile, verification logs/manifest và báo cáo; dừng mở thêm scope tại mốc 11:30. Working tree chưa commit/push, không có phiên build/test của lượt này còn chạy.

## Kết quả của lượt này

Tiếp tục phần security/identity boundary còn thiếu trong roadmap: bind chứng chỉ mTLS với workload identity, thay vì chỉ tin rằng chứng chỉ đã được CA ký. Đây là local engineering hardening; **không phải chứng minh staging/production hoàn tất**.

Skill `gss-verification-gate` dẫn hướng kiểm tra failure path, PostgreSQL schema cô lập, fingerprint source và phân biệt PASS/BLOCKED/NOT RUN. Không dùng dashboard, output model hoặc fixture để chứng minh SIEM thật.

### Đã triển khai

- Contract `gss.workload-policy.v1`: fixed workload ID, exact DNS SAN, SHA-256 leaf DER pin và explicit revoked fingerprints. Một workload tối đa hai pin cho overlap rotation; không chia sẻ pin/DNS giữa workload.
- Xác minh thời hạn leaf certificate, non-CA, clientAuth EKU, không fallback Common Name, không wildcard SAN. Chứng chỉ chứa nhiều SAN của các workload đã cấu hình bị từ chối.
- Staging Control Plane và Command Center bắt buộc có policy; local opt-in qua `GSS_TLS_WORKLOAD_POLICY_FILE`. Không downgrade về transport không ràng buộc nếu policy lỗi.
- Certificate cho process vừa làm server vừa làm client cần EKU phù hợp cả hai chiều (serverAuth cho listener và clientAuth cho outbound), cùng SAN hostname mà client thực sự kết nối; identity DNS SAN không thay hostname verification của TLS.
- WebSocket bind signed worker token với certificate workload/role. CLI không thể giả IDE/SIEM/admin bằng token khác. UI gateway chỉ có đường admin-session đã xác thực, không tự được cấp quyền từ chứng chỉ.
- Control Plane bind internal service bearer với chứng chỉ command-center; operator path cần ui-gateway certificate và vẫn phải qua session/OIDC/RBAC/ACL. Worker không được gọi authority bằng bearer bị đánh cắp.
- Đọc lại operator-owned policy ở mỗi API request, WS frame và outbound dispatch; idle WS kiểm tra lại mỗi hai giây, subject to event-loop scheduling. Withdrawal/corruption chặn dispatch ngay lúc kiểm tra và đóng socket với code 1008.
- Launcher chỉ cấp đường dẫn pin policy cho hai server; không đưa vào worker/Web UI. `.env.example` và runbook đã cập nhật; `.env` thật giữ nguyên.
- Verification manifest thêm hard gate `workload-identity-staging` ở trạng thái NOT RUN, tránh suy diễn local PKI fixture thành staging proof.

Chi tiết certificate matching dựa trên [Node X509Certificate.checkHost](https://nodejs.org/api/crypto.html#x509checkhostname-options); tắt CN fallback/wildcard và yêu cầu DNS SAN chính xác. Runbook: `infra/identity/WORKLOAD_IDENTITY_CODEX.md`.

## Phạm vi code

- `packages/sdk/src/security/workload-policy.ts` (mới), SDK public export.
- `packages/sdk/src/transport/ws-server.ts`.
- `services/control-plane/src/server.ts`.
- `scripts/service-environment.mjs`, `scripts/verify-local.mjs`, `.env.example`.
- `tests/integration/workload-binding.test.ts` (mới), `tests/runtime-env.test.mjs`.
- `infra/identity/WORKLOAD_IDENTITY_CODEX.md` (mới).
- `apps/standalone/package.json` và root lockfile: targeted dependency security patches, được ghi kết quả riêng dưới đây.

## Xác minh

Focused verification: **PASS** — 7/7 workload binding tests trên TLS/WebSocket thật và PostgreSQL local trong schema disposable; 7/7 environment tests; typecheck PASS. CA/private keys của fixture chỉ được tạo trong thư mục tạm và dọn sau test, không lưu trong repository. Không gọi model trả phí hoặc provider Chronicle.

Full verification bản cuối: **local engineering PASS; release/security BLOCKED**. Runner exit 0, hoàn tất lúc **11:28:56.675 Asia/Bangkok**, trước cutoff 11:30. Không sửa source/lockfile sau snapshot xác minh cuối.

Manifest: [verification evidence](<D:/du an GGS/data/verification/2026-10-08T04-25-38-840Z-0d313ce9-3f4e-4187-b27b-ed95e0771f0b/manifest.json>).

- Revision HEAD: `7bbd8adf87bd58778a9af8c82851646211ed41ae`; bản được verify là working tree, không chỉ HEAD.
- Source fingerprint: `df2f7bddb846f1cc7cb52ad0fa449e58305bea7fc28bcb0faa49224c07ffc534`.
- Lockfile SHA-256: `1c89fe8f56a9117ed076643524eea336c9c881b5a23df530ac7d245fe18c2ef0`.
- `sourceUnchangedDuringVerification: true`; root Markdown report nằm ngoài fingerprint. Log/SHA-256 từng gate nằm cạnh manifest.

| Gate | Kết quả cuối | Phạm vi |
| --- | --- | --- |
| Source authority / skills | PASS | 6 skills, 3 eval files |
| Build / typecheck | PASS | 6/6 workspace, 29 Next pages, root + UI types |
| Unit | PASS | 91 tests / 18 files |
| Integration | PASS | 134 tests / 22 files; PostgreSQL thật trong schema cô lập |
| Environment | PASS | 7 tests |
| Browser | PASS | 12 Chromium tests |
| Component smoke | PASS | Không chứng minh staging closed loop |
| Production dependency audit | PASS | 0 vulnerabilities tại thời điểm kiểm tra |
| Full dependency audit including dev | FAILED | 1 Critical proxy-addr chưa được patch |
| Staging/release gates | BLOCKED / NOT RUN | Không thay bằng local fixtures |

Tổng **244 tests PASS** (91 + 134 + 7 + 12), không skip trong full run có PostgreSQL. Một focused run không DB riêng có 6 PASS/1 SKIPPED, không tính thêm vào tổng này.

Lần full đầu: tất cả code/build/typecheck/smoke và **244 tests PASS** (91 unit + 134 integration + 7 environment + 12 browser), nhưng tổng **FAILED** do production dependency audit phát hiện 2 dependency High (Next.js 16.3.7 và source-map-js 1.2.1). Manifest được giữ nguyên: `data/verification/2026-10-08T04-20-11-743Z-9f0a9f4b-7663-4568-b6ce-fc6eaa6139f5/manifest.json`.

Đã cập nhật bản vá nhỏ có advisory xác nhận: Next.js **16.3.8** ([cache poisoning advisory](https://github.com/advisories/GHSA-4jqv-mc3x-m676), [draft cache advisory](https://github.com/advisories/GHSA-3w37-wq28-93x7)); source-map-js **1.2.2** ([event-loop DoS advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)). `npm audit --omit=dev --json` và audit trong full runner sau update: PASS, 0 vulnerabilities. Full rebuild/test đã xác minh phiên bản mới.

**Security finding còn mở:** `npm audit --json` toàn dependency trả FAILED với **1 Critical ở proxy-addr**, thuộc development dependency tree (production-only audit không chứa finding này). [Maintainer advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) nêu bản vá 2.0.8 cho IPv4-mapped IPv6 trusted-subnet spoofing. Chưa patch/reverify finding này trong timebox; không có exception được duyệt, không hạ severity vì là dev dependency. Đây vẫn là blocker release/security. Handoff ưu tiên đầu tiên: targeted update proxy-addr → 2.0.8, rà parent dependency/lockfile, full audit và xác minh lại fingerprint trước release.

`npm explain proxy-addr` xác nhận đường dẫn `@asq/auth (dev express ^4.19.2) → express 4.22.3 → proxy-addr 2.0.7 (~2.0.7)`. Source auth có import Express types; chưa thực hiện exploitability audit nên không tuyên bố miễn nhiễm. Đề xuất lượt tiếp theo `npm.cmd update proxy-addr --no-audit --no-fund`, sau đó audit **bao gồm dev**, rebuild/typecheck/test đầy đủ; không dùng override khác major hoặc exception để che finding.

Rà CI bổ sung: test HTTP/Control Plane mới chỉ chạy nếu có DATABASE_URL; không có thì ghi SKIPPED/NOT RUN cho riêng case PostgreSQL, các case mTLS không phụ thuộc DB vẫn chạy. Khi có DB, fixture bắt buộc search_path schema `gss_suite_...` để không vô tình chạy vào runtime schema.

Đã chạy focused không có DATABASE_URL: exit 0, **6 PASS + 1 SKIPPED**, PostgreSQL được runner ghi NOT RUN đúng nghĩa. Không gộp skipped case vào số integration PASS của môi trường có DB.

`npm.cmd run dev:check`: **PASS dry-run**; các cổng 3000/4000/4100 khả dụng, PostgreSQL được cấu hình, launcher sẽ migrate trước startup. Chronicle worker vẫn disabled đến khi có đủ bốn tọa độ; dry-run không start toàn stack và không gọi provider. `git diff --check` PASS cho tracked source trong phạm vi slice; chỉ có warning LF/CRLF, không sửa các generated/dist hoặc thay đổi cũ của người dùng.

Một lần chạy focused đầu có 6/7 PASS và 1 assertion lỗi vì truyền `undefined` kích hoạt default env của constructor; đã sửa test để dùng chuỗi rỗng cho trường hợp thiếu policy. Không thay logic bảo mật để làm test xanh. Rerun 7/7 PASS. Test SAN còn pin chính chứng chỉ không hợp lệ vào fixture policy để bảo đảm rejection thực sự do SAN/EKU, không chỉ vì pin thiếu.

## Điều kiện bên ngoài và giới hạn

- **BLOCKED:** Chronicle project/location/instance/endpoint thật và ADC/WIF viewer-only còn thiếu; không có staging E2E.
- **BLOCKED:** Docker daemon/rootless sandbox chưa khả dụng; không fallback host executor.
- **NOT RUN:** staging certificate provisioning/rotation/revocation, OIDC/MFA browser, Object Lock, OTLP collector, labeled model eval, OSV/Trivy/remote CI, staging load/SLO và 72-hour freeze.
- Pin withdrawal persistence hiện là operator-owned file. **Chưa có PostgreSQL durable certificate revocation ledger/anti-rollback**, CRL/OCSP, HSM, automatic PKI issuance hay distributed revocation acknowledgement. Operator rollback policy có thể tái cho phép pin cũ; runbook yêu cầu kiểm soát quyền ghi/rollback.
- Presence READY vẫn là worker self-report, không phải sandbox attestation. Pin/CA identity không chứng minh correctness của evidence hoặc execution.
- Không mở remediation, SIEM writeback, auto-merge hoặc auto-deploy. Không sửa schema runtime, không commit/push GitHub và không đụng thay đổi không thuộc slice này.

## Chạy và tiếp tục

Ctrl+Shift+B vẫn gọi task mặc định `GSS: Run local stack` → `npm.cmd run dev`. Không cần thêm tổ hợp phím. Local loopback mặc định không cần policy mới; staging cần certificate/key riêng theo service và policy đầy đủ. Preflight không thay bằng chứng toàn stack đã chạy.

Ưu tiên tiếp theo: provisioning Chronicle read-only và rootless Docker để chạy hard gate thật; hoàn thiện browser OIDC/MFA và staging workload enrollment/rotation. Sau đó durable versioned revocation authority/anti-rollback, Object Lock/OTLP và release/load/freeze gates. Không công bố phần trăm readiness nếu thiếu bằng chứng này.

### Backlog để tiếp tục sau checkpoint

1. Chronicle: cấp project/location/instance/endpoint, ADC/WIF với read-only IAM, dataset đã được phép/redacted, retention/timezone và known IOC. Chạy success/zero-result/invalid query/401/403/429/timeout/truncation; attach query hash, event IDs và evidence provenance. Không có credential thì giữ BLOCKED, không mock thành PASS.
2. Sandbox: chuẩn bị Linux staging worker với rootless Docker (gVisor nếu hỗ trợ); chạy traversal/symlink/network/PID/memory/timeout/output-limit và host immutability. Không dùng host executor thay thế.
3. Identity: provision CA/leaf riêng, đủ policy workload, issuer/audience/JWKS/MFA claim; staging browser login và user revoke/incident ACL, certificate/token substitution, rotation/withdrawal rehearsal. Nếu cần ingress TLS termination, phải thiết kế trusted gateway boundary riêng; code hiện không tin các forwarded-certificate headers.
4. Durable certificate policy: versioned policy + append-only revocation records qua Control Plane/PostgreSQL duy nhất, expected-version/CAS, dual-control publication, không cho rollback resurrect fingerprint, journal audit và distributed revocation acknowledgement. Chưa tự thêm migration thiếu integration proof trong timebox này.
5. Retention/observability: S3 Object Lock/retention thật và OTLP collector; kiểm tra hash, retention mismatch và causal trace xuyên case/task/queue/worker/result bằng evidence external.
6. Release: CI OSV/Trivy evidence trên revision được push, labeled model eval, staging recovery/load SLO và freeze 72 giờ. Giữ engineering local PASS tách khỏi release BLOCKED.
