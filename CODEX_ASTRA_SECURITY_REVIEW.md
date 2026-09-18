# ASQ-Engine — Architecture & Security Review — Codex

Ngày bàn giao: 2026-09-18. Phạm vi: tiếp nối rà soát tài liệu Markdown và triển khai lớp an toàn cho điều phối local, không phải chứng nhận an toàn production.

## Kết luận điều hành

Dự án có ranh giới vai trò hợp lý: Standalone điều phối, IDE phân tích, CLI thu thập/thực thi, SDK và guardrails bảo vệ giao tiếp. Vấn đề lớn nhất không phải thiếu model mạnh mà là khoảng cách giữa lời mô tả trong tài liệu và hành vi runtime.

**Quyết định: tiếp tục phát triển theo hướng read-only, evidence-first; chưa bật tự động remediation/deployment.** Đợt này sửa các đường có thể thực thi không đúng quyền, giả danh agent, báo thành công giả và làm sai kết quả build/test. Chưa triển khai đầy đủ chu trình SIEM → AST → patch → sandbox → phê duyệt → canary → rollback.

Các báo cáo phase/acceptance cũ là hồ sơ lịch sử hoặc mục tiêu thiết kế. Chữ “PASS 100%” trong đó không thay thế bằng chứng integration của hệ thống hiện tại. Trạng thái hiện hành xem [PROJECT_TRUTH.md](PROJECT_TRUTH.md).

## 1. Phát hiện và thay đổi

| Ưu tiên | Phát hiện trước sửa | Thay đổi | Giới hạn còn lại |
|---|---|---|---|
| P0 | CLI kiểm tra tiền tố rồi chạy shell; có khả năng ghép thêm lệnh | Parse allowlist chính xác; `execFile`, `shell:false`; giới hạn timeout/output/concurrency; token gắn task, incident, hash lệnh | Chạy trên host, **không phải container sandbox** |
| P0 | WebSocket nhận danh tính do client tự khai | Xác thực handshake, lấy role/agent từ token; kiểm tra quyền CONTROL; chặn worker gửi lệnh quản trị | HMAC dùng chung secret, chưa phân tách trust domain bằng khóa bất đối xứng/mTLS |
| P1 | Token thiếu expiry/secret an toàn | Bắt buộc secret ≥32 ký tự, xác minh constant-time, kiểm tra thời gian/TTL; đóng phiên hết hạn | Chưa có rotation/revocation phân tán |
| P1 | Evidence không được ràng buộc chắc với task | Pending task theo taskId/incidentId/agent; timeout và offline trả trạng thái rõ | Chưa có durable queue/audit, mất state khi restart |
| P1 | Kill-switch có thể bị vượt qua bởi quyết định LLM đang chờ | Kiểm tra halt sau await; hủy tác vụ executor đang chạy; chặn task mới | Không đảm bảo worker mất mạng đã nhận lệnh; không cách ly mạng, không phải “zero-second rollback” |
| P1 | IDE/HITL tự mô phỏng hoàn tất/phê duyệt | IDE trả BLOCKED khi chưa có adapter; deployment trả PENDING_APPROVAL/ADVISORY; bỏ giả lập patch trong trình duyệt | Chưa có workflow phê duyệt thật |
| P1 | UI gửi sai frame, tự đăng ký làm worker, 2FA chỉ là ô nhập | UI gửi envelope chuẩn; panel chỉ quan sát; kill-switch chờ HALTED và mô tả đúng giới hạn | Chưa kiểm thử tương tác trình duyệt end-to-end; chưa tích hợp MFA |
| P1 | Cấu hình login demo và proxy “ready” gây hiểu nhầm | Login local dùng cấu hình môi trường, cookie HttpOnly; production login trả 503; proxy Grafana trả 503 chưa cấu hình | Local auth chưa có chống brute force đầy đủ; cần IdP production |
| P1 | FinOps âm thầm hạ model trong ca nghiêm trọng | Từ chối khi không đủ tier/quota; severity lạ chuyển sang yêu cầu triage | Quota là heuristic theo request, không phải kế toán token/chi phí provider |
| P1 | JavaScript sinh cạnh TypeScript che source, test/build dễ chạy nhầm | Root typecheck noEmit; resolver ưu tiên source TS; build package ra dist; Next output riêng | Generated files đã tracked từ trước vẫn cần dọn qua thay đổi riêng được review |
| P2 | Runtime dùng cú pháp Windows, gRPC dùng `__dirname` sai trong ESM | Launcher Node đa nền tảng; proto theo import.meta.url và được copy khi build; gRPC deadline và close | Chưa chạy live gRPC server/mTLS; production live và mock đều fail closed |

Mã trọng tâm: `packages/sdk/src/security/token-signer.ts`, `packages/sdk/src/transport/ws-server.ts`, `services/cli-worker/src/controlled-executor.ts`, `services/standalone/src/command-center.ts`, `tests/integration/security.test.ts`.

## 2. Ranh giới thực thi hiện tại

1. Trình duyệt đăng nhập local để nhận cookie phiên quản trị; native worker dùng token riêng.
2. WebSocket kiểm tra token và Origin, bỏ qua danh tính tự khai trong frame. Worker không được gửi command điều khiển.
3. Standalone gửi yêu cầu cho router; router không trực tiếp chạy OS. Call có timeout; lỗi không giả lập thành công.
4. Quyết định CLI được cấp token có scope gắn đúng lệnh/task/incident. Executor quyết định allowlist độc lập với LLM.
5. Chỉ evidence từ đúng agent được giao task và đúng incident mới hoàn tất pending task.
6. Không có worker thì OFFLINE, hết thời gian thì TIMEOUT, adapter IDE chưa có thì BLOCKED. Không tự suy diễn thành “đã vá”.

Allowlist hiện tại: `hostname`, `systeminfo`, `ipconfig`, `ipconfig /all`, `netstat`, `netstat -ano`. Trên nền tảng không phải Windows chỉ hỗ trợ `/bin/hostname`. Không hỗ trợ câu văn tự nhiên tại executor, shell operators, arbitrary arguments, nmap hay thay đổi cấu hình host. Những lệnh đọc này vẫn có thể lộ metadata máy; chỉ dùng trong môi trường được phép.

Dashboard biểu đồ/DEFCON/inbox vẫn là demo, đã được gắn nhãn. Slider autonomy chưa phải policy enforcement backend. Không dùng chúng để ra quyết định vận hành thật.

## 3. Bằng chứng kiểm chứng

- Unit: SDK 4, auth 8, CLI 2, model routing 6 — tổng 20.
- Integration security: 24 assertions/test cases, gồm WebSocket thật, từ chối unauthenticated/cross-origin, chống giả danh/replay, nhiều panel quản trị, session hết hạn, injection, scope token, hủy task, offline worker và kill-switch khi router đang chờ.
- Một integration thực thi **lệnh đọc `hostname` thật**, nhận output và kiểm tra incident correlation. Router trong bài này là stub xác định, không phải API model thật.
- Thêm 3 test contract LLM với provider mock: lỗi upstream không giả thành công, instruction sai kiểu bị chặn, delegation hợp lệ được parse.
- Component smoke chỉ kiểm tra các thành phần local. Không gọi nó là E2E production hay bằng chứng chống mọi prompt injection.
- Vòng chạy cuối: `npm.cmd run build`, `npm.cmd run typecheck`, `npm.cmd test` đều PASS (exit 0). Tổng **47 test** và component smoke. Chi tiết nằm trong PROJECT_TRUTH.
- Chưa kiểm chứng: LLM API/model access thật, SIEM/Grafana thật, gRPC/mTLS server thật, Docker sandbox, GitOps/CI từ xa, deployment/rollback, UI bằng browser automation, load/chaos testing.

Môi trường thực thi lần này: Windows workspace hiện có, không phải clean clone. Một số package build có cache; unit test buộc chạy lại. CI matrix Windows/Ubuntu được khai báo nhưng chưa có bằng chứng chạy remote CI. Không đưa secret vào báo cáo và không gọi API trả phí.

## 4. Các rủi ro chặn production

1. **Shared signing secret:** bên nắm khóa HMAC có thể ký quyền khác. Cần control-plane signing key riêng, worker chỉ giữ verification key; session auth tách khỏi task capability.
2. **Thiếu isolation:** allowlist không thay thế sandbox. Cần worker trong container/VM phù hợp, filesystem/network policy, non-root và resource limits.
3. **Thiếu persistence:** pending/replay/halt hiện trong memory; restart làm mất state. Cần transactional state machine, idempotency key durable, outbox và audit append-only.
4. **Kênh truyền và tenant:** WebSocket local chưa có TLS/mTLS; broadcast chưa tách tenant/incident ACL. Không mở cổng này ra Internet hoặc dùng multi-tenant.
5. **Danh tính:** production login bị khóa chủ động; local auth thiếu rate-limit/lockout và MFA thật. Cần IdP/session revocation, kiểm tra quyền từng operation.
6. **Remediation chưa thật:** AST/patch/red-team/blast-radius còn mô phỏng hoặc heuristic; sanitizer không thể chứng minh triệt tiêu 100% prompt injection.
7. **Hợp đồng provider:** chưa xác minh quyền truy cập model/API và mọi tham số request với provider thật. Không coi unit routing xanh là model đã hoạt động end-to-end.
8. **Dependency và chuỗi cung ứng:** chưa hoàn tất vulnerability audit/SBOM, clean install reproducibility và cập nhật dependency. Build xanh không chứng minh dependency an toàn.

Nếu credential từng xuất hiện trong log/chat hoặc từng được commit, phải thu hồi/rotate từ provider. Không chỉ xóa dòng hiển thị rồi coi là đã an toàn.

## 5. Lộ trình có tiêu chí nghiệm thu

| Chặng | Đầu ra cần giao | Điều kiện đạt |
|---|---|---|
| A — Điều phối local | Signed task + read-only executor + evidence có correlation | Các test hiện có xanh; người vận hành chấp nhận giới hạn local |
| B — Identity/persistence | IdP, khóa bất đối xứng, session revocation, durable task/audit | Test giả danh, restart/replay, quyền tenant, revoke phiên và mất kết nối |
| C — Một SIEM adapter thật | Ingestion/query, schema, dedup, cursor, provenance | Replay dataset được phép + query môi trường staging; timeout không sinh evidence giả |
| D — Sandbox & patch | AST/diff thật, isolated build/test, artifact hash | Patch áp dụng được trong sandbox; path traversal/escape/network abuse bị chặn |
| E — Human approval | Approval gắn artifact hash/expiry, GitOps PR | Không tự phê duyệt; thay patch làm approval cũ vô hiệu; audit truy vết đầy đủ |
| F — Canary/rollback | Metric thật, deployment adapter, runbook | Diễn tập rollback staging có fault injection và thời gian đo được |

Đầu vào cần chốt cho chặng C: loại SIEM, schema/log mẫu đã ẩn thông tin nhạy cảm, endpoint staging, phương thức xác thực, phạm vi tenant và retention. Không tự chọn nhà cung cấp, gửi log ra ngoài hoặc triển khai vào production khi chưa có quyết định này.

## 6. Model làm việc và model runtime là hai thứ khác nhau

Giữ cách phân vai người dùng đã chọn: Luna medium cho triage/lặp; Terra cho coding/test/refactor thường xuyên; Astra high cho kiến trúc/security review/thay đổi lớn. Đây là phân công công việc, không phải benchmark hay bảo đảm độ chính xác.

Việc chọn Astra trong Codex **không tự đổi** `ASQ_ROUTER_MODEL` của ứng dụng. Đợt này không đổi toàn bộ runtime sang Astra. Đối với production cần eval trên dataset riêng: false negative, kết quả policy, latency và chi phí. Ca nghiêm trọng không được tự downgrade model vì hết quota; phải dừng/escalate. Dù model nào, model không được tự cấp quyền hoặc tự duyệt patch.

## 7. Vận hành local

Xem [CODEX_LOCAL_RUNBOOK.md](CODEX_LOCAL_RUNBOOK.md). Không có dịch vụ được tự deploy, không commit/push và không xóa các thay đổi sẵn có của người dùng trong đợt bàn giao này.
