# ASQ-Engine - Project Truth

## Current engineering checkpoint — 2026-10-09

The September snapshot below is historical, not the current runtime status. Current evidence and GitHub checkpoint: [Codex roadmap report](GSS_ROADMAP_CHECKPOINT_2026-10-09_CODEX.md), [gitlog](GITLOG.md), [workload identity runbook](infra/identity/WORKLOAD_IDENTITY_CODEX.md).

- PostgreSQL Control Plane is the durable state-transition authority; initial/follow-up transactional outbox, intake/result receipts, restart/replay handling, worker presence and bounded model reservations are implemented and tested locally.
- Incident/task/evidence provenance, two-distinct-approver proposal boundary, Ed25519 task signing, OIDC/MFA API policy and mTLS SAN/leaf binding have local contract/integration coverage. This does **not** establish live IdP/staging PKI or successful deployment.
- Migration 015 adds permanent certificate revocation tombstones + monotonically increasing revision + atomic audit. Command Center checks the authority on handshake, incoming frame, authorized send and periodic idle checks; file pin rollback cannot undo a persisted tombstone in authority-integrated mode.
- Latest focused verification: 17 PostgreSQL/mTLS tests PASS; root/UI typecheck PASS. Full-source verification and exact final fingerprint belong to the dated report, not this narrative.
- `proxy-addr` 2.0.8 closes the previously reported Critical; diagnostic full dependency audit is zero findings at this checkpoint. Local and CI gates now include development dependencies as well as production, with retained local audit logs.
- Ctrl+Shift+B starts the local stack through `npm.cmd run dev`, requiring PostgreSQL and running migrations/build before service startup. Do not run generated source-adjacent JS or bypass authority to make startup green.
- Release remains BLOCKED: Chronicle coordinates/ADC viewer identity and rootless Docker unavailable; live browser OIDC/MFA, workload PKI, Object Lock/OTLP, labeled routing eval, external security/CI and staging load/freeze evidence remain separate gates.
- No remediation, SIEM writeback, automatic merge/deploy, dynamic enrollment or physical distributed cancellation is enabled. Deny-only certificate revocation is not dual-control certificate grant publication or protection against a PostgreSQL superuser/whole-database snapshot rollback.

## Historical snapshot — 2026-09-18

Cập nhật: 2026-09-18. Người thực hiện: Codex. Đây là trạng thái kỹ thuật hiện hành, thay cho các tuyên bố PASS/hoàn tất trong báo cáo phase cũ.

## Kết luận

**Local prototype đã có lớp kiểm soát điều phối và kiểm thử tích hợp; chưa production-ready.** Không triển khai tự động remediation. Không coi dữ liệu demo, heuristic hay provider mock là evidence vận hành thật.

Xem [review kiến trúc và bảo mật](CODEX_ASTRA_SECURITY_REVIEW.md), [runbook local](CODEX_LOCAL_RUNBOOK.md) và [review tổng thể lịch sử](CODEX_PROJECT_REVIEW.md).

## Kết quả đã chạy

Môi trường: workspace Windows hiện có, ngày 2026-09-18. Không phải clean checkout. Dùng npm.cmd do wrapper PowerShell npm.ps1 bị giới hạn LanguageMode.

| Lệnh | Kết quả | Phạm vi |
|---|---|---|
| npm.cmd run build | PASS, exit 0 | 4 build tasks, gồm Next.js production build; 1 task dùng cache |
| npm.cmd run typecheck | PASS, exit 0 | Source TS services/packages/tests và ứng dụng Next.js |
| npm.cmd test | PASS, exit 0 | 20 unit + 27 integration/contract = **47 test**, cùng component smoke |
| Git diff --check trên các đuôi source/config/doc đã chọn | PASS, exit 0 | Có cảnh báo LF/CRLF, không phải kiểm định mọi file untracked |

Chi tiết: SDK 4, auth 8, CLI 2, IDE routing 6; security integration 24; LLM adapter contract với provider mock 3. Unit test không lấy kết quả từ cache. Integration mở WebSocket thật và chạy lệnh đọc hostname thật. Routing trong bài control-plane dùng stub xác định; không gọi model API.

Build/test còn cảnh báo ts-node experimental loader, fs.Stats deprecation, Turbo dirty hash và line endings Git. CI Windows/Ubuntu đã cấu hình nhưng chưa chạy remote trong phiên này. Không suy diễn clean CI PASS từ local PASS.

## Ma trận trạng thái

| Thành phần | Đã có và đã kiểm chứng | Chưa có/chưa kiểm chứng |
|---|---|---|
| Token/session | Secret bắt buộc, HMAC timing-safe, claims/expiry, tự đóng phiên hết hạn | Khóa bất đối xứng, rotation, distributed revocation |
| WebSocket | Auth handshake, Origin, role CONTROL, identity từ token, replay check, multiple browser panels | TLS/mTLS production, tenant ACL, load/DoS tổng thể |
| CLI execution | Allowlist chính xác, execFile không shell, scope task/incident/hash, timeout, output/concurrency bounds, halt | Container/VM sandbox, durable replay, arbitrary scanners |
| Orchestration | Correlation task/evidence, offline/timeout, chặn dispatch sau halt | Durable queue/state machine, restart recovery, distributed kill acknowledgement |
| Local UI | Đăng nhập local, frame chuẩn, bỏ giả danh worker/fake patch, kill-switch phản hồi backend | Browser E2E, MFA, IdP production; autonomy slider chưa điều khiển policy thật |
| SIEM/Grafana | Thiếu adapter được báo BLOCKED/503; dashboard demo được gắn nhãn | Query/ingestion/telemetry thật |
| Model routing | Severity/quota tests, không silently downgrade ca nghiêm trọng; timeout và validate tool instruction | API model/params/access thực tế, token/cost accounting, task evals |
| gRPC | Proto ESM path và build-copy, deadline, close; chặn production khi thiếu mTLS | Live server integration/mTLS |
| AST/patch/red-team | Có code prototype/heuristic | Parser, patch application, adversarial review độc lập và sandbox verify thật |
| HITL/deployment | Không tự giả phê duyệt hoặc báo rollout thành công | Approval durable gắn artifact hash, GitOps, canary/rollback/metric thật |

## Ranh giới bắt buộc

- Chỉ vận hành local, có phép; không công khai WebSocket và không dùng multi-tenant.
- HMAC secret dùng chung là rủi ro trust-domain: ai giữ secret có thể ký quyền khác. Chưa đạt Zero Trust.
- Replay/halt/pending trong memory mất khi restart. Kill-switch không có nghĩa mọi worker mất mạng đã dừng.
- Host allowlist không phải sandbox. Evidence đọc máy vẫn có thể nhạy cảm.
- Broadcast chưa phân quyền theo incident/tenant. Không đưa log nhiều khách hàng vào hệ thống này.
- Production login và gRPC bị khóa chủ động; không bỏ kiểm soát để làm demo chạy trên production.
- Không thực hiện paid API calls, SIEM external calls, deploy, push hoặc migration dữ liệu.
- Generated JS/d.ts/caches đã tồn tại và có phần tracked từ trước; chưa dọn phá hủy hay reset worktree người dùng. Dùng launcher/resolver hiện hành để tránh chạy source cũ.

## Phân vai model

Theo lựa chọn của người dùng: Luna medium cho triage/lặp; Terra cho coding/test/refactor; Astra high cho kiến trúc/security review/thay đổi lớn. Đây không phải chứng nhận benchmark.

Model chọn trong Codex độc lập với model API trong ứng dụng. Không tự chuyển runtime sang Astra vì đổi model hội thoại. Cần eval trên dữ liệu được phép trước khi quyết định model runtime và chi phí.

## Gate tiếp theo

1. Tách signing key control-plane khỏi verification key worker; thêm IdP/MFA, TLS/mTLS, audit/persistence và test restart/revocation.
2. Chốt một SIEM cùng schema, endpoint staging và phạm vi dữ liệu để tích hợp thật.
3. Thay sandbox/AST/patch mock bằng adapter có kiểm thử phá vỡ ranh giới và evidence có provenance.
4. Chỉ sau đó xây approval/GitOps/canary/rollback có test lỗi và bằng chứng staging.
