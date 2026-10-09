# GSS — Remaining Tasks Advancement — Codex

Ngày: 2026-10-03 · Mục tiêu: engineering MVP evidence-first, không production certification.

## Kết luận

Đợt này triển khai các khoảng trống lớn của Control Plane, bổ sung boundary và kiểm thử local. **Chưa hoàn tất toàn bộ roadmap và chưa được phép công bố ~85% readiness.** Một số việc cần staging thật; một số luồng triển khai vẫn chưa hoàn thiện, được liệt kê riêng bên dưới.

Các file Word/PDF của chủ dự án và thay đổi có sẵn được giữ nguyên. Không commit, push, tạo PR, deploy, merge hoặc chạy model trả phí trong đợt này.

## Đã triển khai

| Khối | Thay đổi thực tế | Giới hạn của kết luận |
|---|---|---|
| Durable intake | PostgreSQL lưu command, body hash, actor, case, lease, deadline, frozen decision và retry | Crash sau provider response nhưng trước lưu decision vẫn có thể gọi model lại; không claim exactly-once billing |
| Queue/outbox | pg-boss acquisition trên cùng PostgreSQL; outbox vẫn là authority; concurrent claim/restart được test | Queue acquisition không đồng nghĩa worker đã thực thi; physical execution không exactly-once |
| Task acceptance | Worker chờ ACK sau transaction; acceptance bind task/case/worker/execution session | Session mới sau crash bị từ chối và watchdog ghi failure, không tự chạy lại tác vụ không xác định |
| Result commit | Result, observation/frontier, decision, case transition, worker message và commit receipt cùng transaction | Failure không trở thành evidence; giữ journal đến commit ACK |
| Halt/watchdog | Halt/generation durable; chặn dispatch, hủy pending; restart không tự resume; execution timeout không có result → failure/audit | Chưa diễn tập một fleet phân tán nhiều node |
| Approval | Runtime API + Approval Desk; hai người khác nhau; requester bị cấm; kiểm tra expiry/hash; binding và metadata artifact immutable ở PostgreSQL | Chỉ proposal approval; chưa có approved patch verification/PR adapter thật |
| Identity | OIDC JWT issuer/audience/JWKS/algorithms, MFA policy, RBAC, subject revocation, incident ACL; admin mutations và security audit cùng transaction, concurrent grant idempotent | JWT/JWKS fixture có chữ ký thật; chưa live IdP. OTP/hardware key đơn lẻ không được coi là MFA |
| Task signing | Ed25519 private key chỉ Control Plane; worker verify-only public key; hash bind task | Local WebSocket bearer vẫn thuộc trust domain HMAC; không gọi đây là Zero Trust hoàn chỉnh |
| Transport | HTTPS/WSS TLS 1.3, CA/hostname verification, client certificates, bounded HTTP response; staging từ chối plaintext/missing TLS | Handshake local bằng PKI tạm; chưa staging PKI rotation/revocation hoặc certificate-to-workload identity mapping |
| Sandbox | Linux rootless prerequisite, optional gVisor, image digest pin, no network, non-root/read-only/no-new-privileges, resource/output/time caps, source snapshot allowlist | Không có Docker daemon trong môi trường này; chưa adversarial Docker/gVisor pass |
| IDE | Staging chọn sandbox investigator, không host fallback; halt truyền abort vào Docker execution; executor rejection không tạo evidence | Snapshot và worker contract test không chứng minh container escape protection |
| Chronicle | Deadline bao phủ token acquisition/request/body/retry; body/result size bounded; malformed/oversized response fail-closed; halt abort request | Chưa project/location/instance/ADC staging; mọi success fixture vẫn được gọi đúng là fixture |
| Artifact | S3 full-SHA key, conditional put, checksum, COMPLIANCE retention; replay kiểm tra hash/retention; deadline toàn thao tác gồm stream body và abort transport; không filesystem fallback staging | Chưa bucket Object Lock thật; IAM/retention/delete denial chưa live test |
| Observability | Metadata-only OTel spans + OTLP exporter; wire export đến receiver local fixture | Chưa trace collector staging xuyên toàn chuỗi |
| Model ledger | Baseline default `gpt-5.6-sol medium`; chỉ provider counts; thiếu usage/rates → NULL/UNKNOWN; usage replay conflict 409; known cost cộng durable; strict mode chặn unknown cost | Model env override local vẫn được giữ; chưa invoice reconciliation, reservation trước call hoặc labeled SOC quality eval |
| Model eval | Offline labeled-corpus comparison harness, paired known-cost comparison, safety failures riêng; không tự promote Luna/Terra | Test fixture chỉ kiểm contract report, không phải corpus SOC chuyên gia |
| Secret scope | Mỗi worker chỉ có bearer riêng; không private signing/DB/model/S3 credential; Google credential chỉ SIEM | Manual service startup vẫn cần cấu hình secret store riêng đúng boundary |
| Build/verification | Compiler emit atomically vào dist với retry giới hạn; build workspace tuần tự; unit chạy source trực tiếp; log+SHA manifest; Ctrl+Shift+B dùng build ổn định này | Không vô hiệu antivirus/ACL, không reset source; mỗi gate thất bại vẫn ghi FAILED |
| CI | OSV lockfile workflow và Trivy action pin SHA; không bỏ qua unfixed High/Critical mặc định | Cấu hình được thêm nhưng remote CI chưa chạy/xác minh trong đợt này |

### Các prototype nguy hiểm đã khóa

- Parser AST không còn luôn trả một defect cố định.
- Patch generator không còn sinh diff/YARA mẫu độc lập với source.
- GitOps dispatcher không còn trả URL PR giả hoặc nói đã build/test thành công.
- SAST/network scanner chưa cấu hình trả BLOCKED, không bịa findings/ports/CVE.
- User log intake không tự gán nguồn Chronicle, IP attacker hay verdict verified.
- Filename blast-radius heuristic không bao giờ cấp auto-deploy; threshold canary chỉ là advisory, không claim rollback đã diễn ra.

Đây là **loại bỏ fake success**, không phải đánh dấu các tính năng đó đã hoàn thiện.

## Verification

Lượt cuối `npm.cmd run verify:local` kết thúc **22:19:01, ngày 2026-10-03 (Asia/Bangkok), exit 0**. Tất cả 10 local gate PASS; scoped source fingerprint không đổi trong lượt kiểm chứng. Không dùng các lượt FAILED trước đó để chứng nhận.

| Gate | Kết quả thực tế |
|---|---|
| Source authority / skill audit | PASS; 6 skills và 3 eval files |
| Build | PASS 6/6 workspace; Next.js 29 pages |
| Typecheck | PASS backend và UI |
| Unit | 90 tests PASS, 17 files |
| Integration | 104 tests PASS, 19 files; PostgreSQL thật, schema cô lập |
| Environment isolation | 5 tests PASS |
| Component smoke | PASS; không phải closed-loop staging certification |
| Chromium browser | 8 tests PASS; login/RBAC/session/route/approval failure-state |
| Production dependency audit | PASS; `npm audit --omit=dev --audit-level=high` báo 0 vulnerabilities |

Tổng **207 tests PASS**, cộng component smoke và các gate build/static/audit. Integration bao gồm transaction rollback, replay/concurrent acquisition, approval binding, JWT signature, local mTLS handshake và ledger conflict. Fixture Chronicle/S3/JWKS/OTLP không được tính là live staging. Browser chưa chứng minh luồng hai approver staging hoàn chỉnh.

Manifest: [verification manifest](<D:/du an GGS/data/verification/2026-10-03T15-16-16-794Z-da4273f8-a5f6-4cf5-afa8-006d4549c102/manifest.json>).

Scoped source fingerprint SHA-256: `b66d02e33440cc97075bdca3ea5d2001f7eade1048245afc3fa796035765e106`.

Revision ghi trong manifest là HEAD `7bbd8adf87bd58778a9af8c82851646211ed41ae`, **không phải một commit chứa toàn bộ thay đổi mới**. Working tree chưa commit; fingerprint gắn test với nội dung đã kiểm chứng. Root report Markdown này nằm ngoài source fingerprint.

`npm.cmd run dev:check` PASS: đủ cấu hình PostgreSQL, các port 3000/4000/4100 trống, launcher chọn đủ sáu service. Đây là dry-run; không migrate runtime DB hoặc gọi provider trả phí. `npm.cmd run readiness` vẫn **BLOCKED**: thiếu Chronicle coordinates, Google viewer identity và Docker daemon.

Lệnh chạy tuần tự: source check → skill audit → build → typecheck → unit → isolated PostgreSQL integration → environment → component smoke → Chromium browser → production dependency audit.

Manifest/log nằm trong `data/verification/<run-id>/`. Đây là dữ liệu local bị gitignore; JSON lưu exit code, command, thời gian, SHA-256 log, revision và scoped source fingerprint. `releaseStatus` luôn BLOCKED cho đến khi có đủ hard-gate evidence bên ngoài. Không coi fingerprint là một signed release attestation.

### Những lỗi đã được regression tìm ra

- Test IDE cũ thiếu mô phỏng task-acceptance ACK: fixture được sửa, không bỏ ACK runtime.
- Test SDK dùng plaintext remote hostname: chuyển fixture thành loopback, không nới policy mạng.
- Browser alert locator trùng Next route announcer: scope đúng vùng lỗi approval.
- Windows khóa generated SDK output và Turbo log: thay writer bằng atomic emit, build theo dependency order, unit runner trực tiếp; không xóa/reset repository.
- Root unit config từng merge nhầm integration include, và migration fixture phụ thuộc workspace cwd: thay include rõ ràng, dùng URL relative-to-module. Lượt cuối unit chỉ chạy unit, integration áp migration lên schema test riêng.
- S3 provider treo sau GET headers: test deadline/abort không chấp nhận evidence. Audit insert lỗi: test PostgreSQL xác minh ACL/revocation rollback, không có quyền mới thiếu security audit.

## Việc chưa hoàn tất — không chỉ là thiếu credential

| Việc | Cần thực hiện tiếp | Tiêu chí đóng |
|---|---|---|
| Staging browser SSO | OIDC authorization-code/PKCE, reviewed IdP config, session lifecycle/revocation qua browser và WS/BFF | Browser staging analyst/operator/approver pass; không bypass ACL/MFA |
| Approval → proposal verification | Lấy đúng immutable artifact, apply patch vào ephemeral copy, fixed build/test, source-bound verification evidence, recheck approval ngay trước proposal dispatch | Expiry/hash/requester/duplicate/restart tests + sandbox evidence; không merge/deploy |
| AST/scanner adapters | Chọn language parsers, offline ruleset và digest-pinned tool image; normalize source-backed findings | Parser/adapter contract + real sandbox tool output; không canned findings |
| Canary/rollback | Chỉ sau quyết định mở phạm vi staging: deployment/metrics adapter, durable action audit, fault injection | Metric thật và rollback evidence; hiện không tự deploy/rollback |
| Fleet lifecycle | Durable heartbeat/presence, workload identity mapping, multi-node halt/recovery | Worker crash/partition/certificate rotation tests |
| FinOps hard budget | Reservation trước provider call, reconcile actual usage, account crash window và unknown pricing | Concurrent reservation/budget exhaustion/provider error tests + measured invoices |
| Remaining UI adapters | Chuyển các trang vẫn dùng demo adapter sang authority-backed lifecycle/evidence data | Browser end-to-end với dữ liệu runtime thật; DataNotice không phải verification evidence |
| Release/freeze | Staging load/recovery SLO, remote security scans, 72-hour freeze trên một candidate cố định | Không Critical; High có owner/expiry hoặc xử lý; zero lost/duplicated logical transitions |

Các prototype bị khóa vẫn cần implementation ở bảng này. Không dùng phần trăm để che khoảng trống.

## Hard prerequisites đang BLOCKED

1. Chronicle staging: project/location/instance/endpoint, ADC/WIF viewer-only, dataset đã cho phép/ẩn nhạy cảm, known IOC/time window.
2. Linux Docker rootless: daemon và cgroup controls, reviewed digest image, mount allowlist; gVisor runtime nếu yêu cầu. Không dùng host executor fallback.
3. IdP issuer/audience/JWKS, MFA claim mapping và PKI riêng cho từng service. Đừng gửi secret trong chat.
4. S3-compatible bucket đã bật Object Lock COMPLIANCE; read/write-only scoped credential cho ArtifactStore; chứng minh retention/delete denial.
5. OTLP staging collector, labeled redacted SOC corpus và kết quả provider usage được phép sử dụng.
6. GitHub CI evidence, deployment/fault-injection target được phê duyệt và thời gian 72 giờ thực tế.

`npm.cmd run readiness` hiện xác nhận PostgreSQL connectivity; Chronicle coordinates, Google identity và Docker chưa đủ. Không migrate runtime schema trong lúc regression: migrations 006–012 chỉ được áp dụng lên các schema test cô lập. Launcher áp dụng migration khi người dùng chạy stack.

## Cách dùng

```powershell
# Trong D:\du an GGS
npm.cmd run verify:local
npm.cmd run readiness
npm.cmd run model:eval -- redacted-corpus.jsonl provider-samples.jsonl
```

Ctrl+Shift+B vẫn chạy sáu service local sau migration/build. Account `BaoNVG / 1` chỉ dành cho loopback demo; cùng một username có identity ổn định nên đăng nhập hai lần không tạo hai approver độc lập. Task **GSS: Verify local with evidence** trong VS Code chạy bộ kiểm chứng đầy đủ.

Không copy toàn bộ `.env` sang worker/browser. Cấu hình mẫu mới nằm ở `.env.example`; bỏ trống rates chưa biết thay vì 0. Staging phải dùng TLS và identity riêng, không dùng local launcher làm deployment workflow.

## Skill influence và nguồn kỹ thuật

- `gss-verification-gate` buộc tách PASS local khỏi BLOCKED/NOT RUN staging, giữ failure log và chưa công bố hoàn tất roadmap.
- `gss-durable-approval` / `gss-evidence-next-step` giữ authority ở PostgreSQL, approval không cấp quyền deploy và model không tạo evidence.
- `gss-model-routing-eval` buộc NULL/UNKNOWN cho usage/cost thiếu và không tự promote model sau fixture test.
- `ui-ux-pro-max` giữ Apple-inspired visual system hiện có, bổ sung approval form có label, trạng thái lỗi/live region, touch target và responsive layout; không dùng demo counts làm success.
- OpenAI Docs: completion budget dùng `max_completion_tokens`; token usage lấy từ provider, không từ context heuristic. [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol).
- TLS CA/client verification đối chiếu [Node TLS](https://nodejs.org/api/tls.html); Docker boundary đối chiếu [Docker rootless](https://docs.docker.com/engine/security/rootless/).
- Retention adapter đối chiếu [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html); CI OSV đối chiếu [OSV GitHub Action](https://google.github.io/osv-scanner/github-action/).

## Quyết định release

**BLOCKED.** Local code/tests là một advancement có thể kiểm chứng, không phải lời xác nhận tất cả task đã xong. Mở các prerequisite ở trên rồi mới đóng staging/release gates; remediation, SIEM writeback, auto-merge và auto-deploy vẫn bị cấm.

## Follow-up 2026-10-04

Đã thêm durable model reservation trước provider call, CAS acquisition một lần, transaction settlement với usage ledger/audit, unknown/crash holds và policy immutability. Final local verification mới: **222 tests PASS**, build/typecheck/smoke/audit PASS, source không đổi. Đây là bước tiến của hàng FinOps, chưa invoice/rate-card reconciliation hoặc bảo đảm tuyệt đối provider billing.

Xem [GSS — Durable Model Reservation — Codex](<D:/du an GGS/GSS_FINOPS_RESERVATION_2026-10-04_CODEX.md>) để đọc semantics, cấu hình opt-in local, staging requirements, manifest và những phần còn thiếu. Kết quả ngày 2026-10-03 phía trên được giữ nguyên như historical snapshot. Không đổi `.env` thật hoặc migrate runtime DB trong lượt mới.
