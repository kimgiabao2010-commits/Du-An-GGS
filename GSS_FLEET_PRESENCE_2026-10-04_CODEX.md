# GSS — Durable Fleet Presence — Codex

Ngày: 2026-10-04. Phạm vi: worker lifecycle/presence và trang Agents; không phải tuyên bố hoàn tất roadmap hoặc production-ready.

## Kết quả triển khai

1. Thay API workers suy diễn từ audit log bằng registry + connection history + heartbeat lease trong PostgreSQL. Audit cũ không làm worker trở thành ONLINE.
2. Migration `014_worker_presence.sql`: ba identity/capability allowlist cố định cho CLI, IDE và SIEM; connection generation, execution binding, sequence, readiness, lease, closed state. Trigger bảo vệ binding và phiên đã đóng/fenced.
3. WebSocket server tự cấp connection ID; frame không thể ghi đè identity/connection này. ACK heartbeat/task acceptance gửi về đúng connection, tránh ACK cũ ảnh hưởng phiên mới.
4. Command Center chuyển connect/heartbeat/disconnect qua service API; Control Plane là writer. Connect/readiness/disconnect có audit transaction. Heartbeat lặp không kéo dài lease; thay payload ở cùng sequence gây conflict.
5. Worker SDK gửi heartbeat mỗi 5 giây; lease tính bằng giờ PostgreSQL, hết hạn sau 20 giây. TCP mở thành công không reset retry budget trong chế độ bắt buộc presence: chỉ heartbeat commit ACK mới reset.
6. Phiên mới không chiếm identity khi lease cũ còn hiệu lực. Sau khi phiên cũ đóng/hết hạn, connection mới tăng generation; heartbeat/disconnect trễ của phiên cũ không sửa phiên mới.
7. Dispatch và acceptance kiểm tra presence trong luồng launcher/staging. Acceptance kiểm tra connection + execution + lease + READY ngay trong transaction trước cập nhật RUNNING. Restart với execution ID khác trả `EXECUTION_STATE_UNKNOWN`, không tự chạy lại.
8. CLI/IDE/SIEM báo readiness riêng; HALTED không có quyền thực thi chỉ nhờ còn kết nối. Shutdown dừng khởi polling/dispatch mới; các receipt/outbox đã lưu vẫn thuộc cơ chế recovery hiện có.
9. Trang `/control/agents` đọc gateway API thực: loading/error/empty, presence, reported readiness, heartbeat time, generation và số task RUNNING đã ghi. Không còn success rate/token totals giả. Snapshot hết lease thành STALE; mất API thành UNVERIFIED.
10. UI giữ Apple-inspired surface/typography, button 44px, focus rõ, icon có semantics và trạng thái có chữ. Bỏ nhãn “Evidence protected” tĩnh trong shell, thay bằng “Read-only execution”.

## Contract và quyền

| Endpoint | Quyền / mục đích |
| --- | --- |
| `GET /control/v1/workers` | Role được phép xem fleet; trả `gss.worker-presence.v1` |
| `POST /control/v1/workers/connect` | Service authority; bind worker/role/connection/observer |
| `POST /control/v1/workers/heartbeat` | Service authority; execution ID, sequence và readiness bounded |
| `POST /control/v1/workers/disconnect` | Service authority; đóng đúng phiên, idempotent |
| `POST /control/v1/tasks/accept` | Service authority; nhận thêm trusted connection ID |

Operator, kể cả SECURITY_ADMIN, không được trực tiếp mutate presence qua các endpoint trên. Identity của worker được Command Center lấy từ authenticated socket, không từ payload tự khai.

Presence gồm UNKNOWN, CONNECTED, ONLINE, STALE, OFFLINE. `reportedReadiness` gồm UNKNOWN, READY, BUSY, BLOCKED, HALTED. ONLINE chỉ chứng minh có heartbeat mới được commit; READY là tự báo, không phải attestation hoặc dependency health đã xác minh. `activeTasks` là số record RUNNING, không phải số process đang sống.

## Chạy bằng Ctrl+Shift+B

- Default VS Code task vẫn là `GSS: Run local stack` → `npm.cmd run dev`.
- Launcher luôn bật `GSS_REQUIRE_WORKER_PRESENCE=true`; staging không thể tắt gate bằng switch local.
- `.env.example` có switch này. Local thủ công cũ chưa bật switch giữ compatibility; không được coi là runtime đã enforce presence.
- Launcher chạy migration trước startup. Lượt kiểm tra này chỉ migrate schema test cô lập, không migrate schema runtime của người dùng.
- Khi chạy lại stack, mở `/control/agents`. Chronicle chưa cấu hình sẽ không có worker live; UNKNOWN/OFFLINE/STALE tùy lịch sử, không tạo READY giả.

## Verification

Final verification: **local PASS; release BLOCKED**. `npm.cmd run verify:local` kết thúc exit 0 lúc 2026-10-04T11:40:20.857Z.

Manifest: [verification report](data/verification/2026-10-04T11-36-19-720Z-e16cc5cb-cee1-46c2-a27a-0b9f8856d730/manifest.json).

- Git HEAD: `7bbd8adf87bd58778a9af8c82851646211ed41ae`; code được xác minh là working tree có thay đổi, không chỉ HEAD.
- Scoped source fingerprint: `1f378687d554466c70b82f6389c8cf569f3a50251cd3b31793a855553efee9f2`.
- `sourceUnchangedDuringVerification: true`; log và SHA-256 từng gate nằm cạnh manifest. Báo cáo Markdown gốc này nằm ngoài phạm vi source fingerprint.

| Gate | Command/check | Môi trường | Kết quả |
| --- | --- | --- | --- |
| Source authority | `npm.cmd run source:check` | Local | PASS |
| Skill audit | `npm.cmd run skills:audit` | Local | PASS: 6 skills, 3 eval files |
| Build | `npm.cmd run build -- --force` | Local | PASS: 6/6 workspace, 29 Next.js pages |
| Typecheck | `npm.cmd run typecheck` | Local | PASS |
| Unit | `npm.cmd run test:unit` | Local | PASS: 91 test / 18 files |
| Integration | `npm.cmd run test:integration` | PostgreSQL local thật, schema test cô lập | PASS: 127 test / 21 files |
| Environment | `npm.cmd run test:environment` | Local | PASS: 6 test |
| Smoke | `npm.cmd run test:smoke` | Local component scope | PASS, không chứng minh closed-loop staging |
| Browser | `npm.cmd run test:browser` | Chromium local | PASS: 12 test |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | Registry diagnostic | PASS: 0 production dependency vulnerabilities; không thay OSV/Trivy/image scan |
| Scoped review | `git diff --check` + review identity/provenance/API/lease paths | Working tree | PASS cho phạm vi thay đổi; không phải audit độc lập toàn hệ thống |

Tổng **236 test PASS** (91 + 127 + 6 + 12). Không có test bị bỏ qua trong các tổng này. Hai lần chạy FAILED trước đó vẫn được giữ dưới đây.

Các kiểm tra riêng đã đạt:

- Unit transport fixture: rejected heartbeat không tạo reconnect vô hạn; chỉ hai connection khi max reconnect = 1.
- Live PostgreSQL, 20 test trong outbox + fleet: concurrent registration, immutable binding, replay không renew, payload mismatch, stale/fencing, restart binding, HALTED, staging gate không tắt được, audit rollback, authenticated WS → HTTP → DB và durable disconnect.
- Chromium fleet: failure không tạo demo metrics, contract validation, stale snapshot, failed refresh giữ dữ liệu nhưng đánh dấu UNVERIFIED; layout không tràn tại 375/768/1024/1440px. Đã xem ảnh mobile/desktop cuối sau build. Dữ liệu browser fixture chỉ xác minh UI, không phải SIEM/staging evidence.
- `npm.cmd run dev:check`: PASS dry-run; cổng 3000/4000/4100 khả dụng, PostgreSQL được cấu hình, migration sẽ chạy trước startup. Không phải bằng chứng toàn stack đã chạy.
- `npm.cmd run readiness`: PostgreSQL SELECT 1 PASS; tổng BLOCKED vì thiếu Chronicle coordinates, Google viewer identity và Docker.

Lịch sử lỗi giữ nguyên, không xóa để tạo báo cáo xanh:

- `data/verification/2026-10-04T11-16-48-241Z-b22a6d05-0ace-4afd-b3be-55ce0a74a8a9/manifest.json`: FAILED do browser test riêng của Codex chiếm cổng test 3107. Phiên đó đã kết thúc; rerun tuần tự.
- `data/verification/2026-10-04T11-25-40-147Z-f76d50c7-1383-4a49-8086-0a0d491dc04b/manifest.json`: FAILED vì teardown initial-outbox quá 10 giây dù 126 test assertions pass. Shutdown được siết; fixture cleanup có budget 20 giây, phù hợp startup fixture và vẫn bounded. Rerun riêng đã pass.

## Những việc chưa hoàn tất

- Registry hiện chỉ có ba canonical worker identity, chưa có dynamic enrollment/fleet autoscaling.
- Chưa bind certificate SAN với workload identity, chưa có chứng cứ rotation/revocation staging. Presence không thay mTLS/IdP/incident ACL.
- Lease expiry không chứng minh process đã chết và không ngắt chắc chắn lệnh vật lý đang chạy. Không thêm host fallback hoặc auto-reexecute để che trạng thái không rõ.
- Lịch sử connection cần chính sách retention/capacity được phê duyệt trước quy mô production; chưa có load/SLO staging cho slice này.
- Chronicle staging E2E, rootless Docker/gVisor adversarial, browser OIDC/MFA, Object Lock thật, OTLP staging, labeled model eval, remote OSV/Trivy/CI và 72-hour freeze vẫn cần bằng chứng riêng.
- Các màn hình khác có demo adapter chưa được thay toàn bộ trong slice này.

Không sửa `.env` thật, không gọi provider trả phí, không merge/deploy, không remediation/SIEM writeback và không push GitHub trong lượt này.

## Bước tiếp theo

Ưu tiên cấu hình và xác minh Chronicle read-only staging cùng sandbox rootless; tiếp theo browser identity, workload certificate binding/rotation, artifact retention/OTel và release/load gates. Không quy đổi local test PASS thành phần trăm readiness hoặc staging PASS.
