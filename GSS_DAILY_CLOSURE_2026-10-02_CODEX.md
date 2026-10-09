# GSS - Code Review & Local Engineering Closure - Codex

Historical baseline: the initial-task dispatch gap described below was partially closed on 2026-10-03. See `GSS_INITIAL_DISPATCH_CLOSURE_2026-10-03_CODEX.md` for atomic task/outbox creation and its verified crash windows. Durable command intake, worker ACK and pg-boss remain incomplete.

Ngày: 2026-10-02. Baseline được kiểm tra: `7bbd8adf87bd58778a9af8c82851646211ed41ae`.

## Kết luận

Đợt này triển khai local hardening theo execution plan: loại direct database fallback khỏi Command Center, siết HTTP contract và replay/concurrency, thêm browser E2E thật, nối causal tracing và cập nhật tài liệu. Không công bố phần trăm readiness, closed-loop Chronicle staging hoặc production-ready.

PostgreSQL, HTTP server, WebSocket và Chromium trong các test là thật. Dữ liệu của worker trong test chuỗi bốn bước và model usage là fixture có nhãn; không có cuộc gọi model trả phí, SIEM staging, deploy hoặc remediation trong đợt này.

## Findings đã xử lý

| Finding | Thay đổi |
| --- | --- |
| Command Center còn ghi PostgreSQL trực tiếp | Chỉ nhận `ControlPlaneTaskClient`; thiếu URL hoặc authority không ready thì fail closed. `RuntimeStore` chỉ được dùng qua fixture test riêng. |
| File sinh cũ có thể làm runtime lệch source | Loại 212 file `.js/.d.ts/.map` đã đối chiếu có TypeScript tương ứng; thêm `source:check` vào CI. File đã tracked có thể khôi phục từ lịch sử Git. |
| Async route rejection vượt ngoài HTTP error handler | Await route handlers để lỗi JSON/schema/policy trả đúng status thay vì rejection thất lạc. |
| Hai request khác body có thể cùng vượt idempotency precheck | Advisory transaction lock theo key, canonical fingerprint và unique constraint; case/task creation trong cùng transaction. |
| Result replay ghi đè evidence đã nhận | Migration `006_result_receipts_and_trace.sql`; canonical envelope hash và receipt immutable. Replay đúng body trả `200`; đổi result/observation/proposal trả `409`. |
| Result/executor/case/run provenance thiếu kiểm tra | Kiểm tra task đã tồn tại, executor/target, case/run và ObservationPack; failed result không được tạo observation/frontier/evidence thành công. |
| Task hoàn thành có thể bị ghi lùi thành DISPATCHED | Persist dispatch status trước socket delivery; khóa task row và cấm regression sau khi result đã commit. |
| Readiness chỉ kiểm tra kết nối | `/readyz` kiểm tra các bảng runtime/approval/audit cần thiết; thiếu migration trả `503`, `/livez` vẫn `200`. Pool có timeout hữu hạn. |
| Trace ID trước đây chỉ là message ID | OpenTelemetry span/context thật; W3C traceparent qua HTTP/task, persist trên run/task/outbox, model ledger dùng trace ID thật. |
| Telemetry có thể lộ dữ liệu | Attribute allowlist; không gửi prompt, parameter, credential, raw output, baggage hoặc exception text. Test sentinel chứng minh không xuất các nội dung đó. |
| AUDITOR bị chuyển sang workspace không có quyền | Chuyển role AUDITOR vào `/control/executions`; đồng bộ kiểm tra claim/TTL của proxy với giới hạn session. |
| Xóa secret khỏi env nhưng dotenv nạp lại | Child services dùng file env rỗng do launcher chỉ định; DB/private signing key chỉ tới Control Plane, control token chỉ tới CP/Command Center, model key chỉ tới Command Center, Chronicle/ADC chỉ tới SIEM worker. |
| grpc-js có advisory High mới | Cập nhật `@grpc/grpc-js` lên nhánh vá từ `1.14.5`; final npm audit không còn vulnerability. |

Historical executions chưa có receipt không được tự ghi đè hoặc tự backfill một envelope không thể kiểm chứng. Replay những execution này trả conflict yêu cầu reconciliation rõ ràng; migration giữ nguyên dữ liệu cũ.

## Verification local

| Gate | Kết quả | Bằng chứng/phạm vi |
| --- | --- | --- |
| Build | PASS | `npm.cmd run build`; 6 build tasks thành công, Next production build gồm 28 static pages. |
| Typecheck | PASS | `npm.cmd run typecheck`; root và Next workspace. |
| Unit | PASS | `npm.cmd run test:unit`; 65 tests ở 7 packages/services. |
| Integration | PASS | `npm.cmd run test:integration`; 59 tests, có PostgreSQL live. |
| Environment boundary | PASS | `npm.cmd run test:environment`; 1 test, cả 6 service và dotenv reload. |
| Browser | PASS | `npm.cmd run test:browser`; 7 Chromium scenarios trên production UI. |
| Source/authority guard | PASS | `npm.cmd run source:check`; không còn generated duplicates trong thư mục source được quản lý hoặc RuntimeStore fallback trong Command Center. |
| Skills audit | PASS | `npm.cmd run skills:audit`; 6 skills và 3 eval files hợp lệ. |
| Smoke | PASS | `npm.cmd run test:smoke`; chỉ là component smoke, không chứng minh staging. |
| Migration | PASS local | Migration 006 chạy trên PostgreSQL hiện có; chạy lại `db:migrate` không áp dụng lại migration đã checksum. Test trace dùng schema cô lập tạo từ toàn bộ migration. |
| Dependency audit | PASS | `npm.cmd audit --audit-level=high`; 0 vulnerabilities tại thời điểm chạy. |
| Launcher preflight | PASS local config | `npm.cmd run dev:check`; PostgreSQL được cấu hình, ports kiểm tra được, Chronicle vẫn cảnh báo chưa cấu hình. Không coi preflight là live stack E2E. |
| Source diff whitespace | PASS | `git diff --check` trên thay đổi source, loại `dist` và `.turbo` đã tracked/dirty; không sửa hoặc xóa những artifact người dùng đang có. |
| Overall staging readiness | BLOCKED | `npm.cmd run readiness`: Chronicle coordinates, Google viewer identity và Docker thiếu. Đây là kết quả đúng, không phải PASS. |

Tổng: 132 tests/scenarios pass (65 unit + 59 integration + 7 browser + 1 environment), cộng component smoke riêng.

Failure path bổ sung: IDE worker đọc repository thật và trả SUCCESS nhưng artifact registration ở authority thất bại → result FAILED, không persisted ObservationPack/evidence, không emit UI SUCCESS và không giữ investigation success payload trong result thất bại.

Browser scenarios: anonymous ở hai workspace; mật khẩu sai rồi đăng nhập local đúng; analyst được Standalone và bị từ chối Control; auditor được Control và bị từ chối Standalone; expired session; invalid signature; legacy redirect không vượt auth boundary. Browser tests không lưu cookie/storage state, screenshot, video hay trace có credential.

HTTP/PostgreSQL scenarios: `200/201/401/403/404/409/413/422/503`, replay và payload conflict, request đồng thời, restart CP, result conflict, failed result không có observation, terminal status không bị ghi lùi.

Causal trace scenario: bốn task read-only → bốn observations/frontiers; tạm giữ outbox sau bước đầu, restart Command Center, lease/recover follow-up rồi FINALIZE. Test kiểm tra cùng trace ID, parent span tồn tại, bốn dispatch/worker/result spans, model_usage trace correlation và bốn immutable receipts. Readiness failure được kiểm tra bằng đổi tên bảng trong **schema test cô lập**, không dừng PostgreSQL của người dùng.

Lần chạy Chromium đầu pass assertions nhưng teardown server Windows chậm; đã dừng đúng PID preview do test tạo. Lần chạy cuối ngoài sandbox hoàn tất tự động: 7/7, exit 0. Không dừng server hay Node process không thuộc test.

## BLOCKED / NOT RUN / giới hạn còn lại

- BLOCKED: Chronicle staging thật và ADC/WIF viewer-only, dataset được phép/redacted.
- BLOCKED: rootless Docker/gVisor và sandbox adversarial. Không đổi sang host executor như một fallback để vượt gate này.
- NOT RUN: OIDC/MFA, session revocation, incident ACL, mTLS và worker verify-only identity. Shared HMAC của local demo **không** phải production trust boundary.
- NOT RUN: protected staging Ed25519 key và phân phối verify-only public key. Test key ephemeral/local unsigned không chứng minh staging signing.
- NOT RUN: S3-compatible evidence backend, retention/Object Lock và durable external telemetry collector/OTLP. Local spans dùng SDK/exporter thật; runtime có opt-in console exporter, chưa có staging collector.
- NOT RUN: model routing eval với labeled corpus, actual paid-provider usage reconciliation và cost-quality comparison. Không thay baseline/routing policy trong đợt này.
- NOT RUN: browser approval/GitOps workflow end-to-end, measured SLO, physical PostgreSQL service restart, 72-hour freeze.
- NOT RUN: GitHub CI/OSV/Trivy cho **diff mới này**. Đã thêm Chromium CI job và source guard, nhưng configuration không phải bằng chứng remote run xanh.
- Code Review plugin được kiểm tra khả năng: connector hiện đọc CI của PR; không có PR cụ thể cho working diff này nên chưa chạy PR diagnostics. Review trong đợt này là đọc code/diff, failure-path tests và runtime verification; không giả nhận đã có automated PR review.
- Durable outbox đang dùng PostgreSQL lease của repository; chưa chuyển sang `pg-boss`. Socket send không phải worker ACK, pending/halt còn memory. Không tuyên bố exactly-once physical execution hoặc recovery của mọi crash window.
- Initial-command ingress/dispatch vẫn cần transactional queue/outbox hoàn chỉnh trước staging: không dùng thành công của follow-up outbox test để đánh đồng mọi ingress là durable.

Không bật remediation, SIEM writeback, auto-merge hoặc auto-deploy. Không sửa các DOCX/PDF đầu vào; không đưa secret từ `.env` vào report. Thay đổi generated `dist`/cache sẵn có được để nguyên, ngoài phạm vi handoff source.

## Chạy lại và bàn giao

Chạy lần lượt: `npm.cmd run db:migrate`, `npm.cmd run build`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run test:browser`, `npm.cmd run source:check`, `npm.cmd run readiness`. Browser cần Chromium của Playwright: `npm.cmd exec playwright install chromium` (CI Linux dùng `--with-deps`).

`Ctrl+Shift+B` vẫn gọi VS Code default build task → `npm.cmd run dev`: migration → build → Control Plane ready → Command Center/workers/UI. Launcher giờ đợi authority và phân tách secret đúng hơn. `BaoNVG / 1` chỉ dành cho loopback demo. Đợt này không dùng test xác minh auth để khẳng định chat qua provider thật đã được xác minh.

Local trace console có thể bật `GSS_TRACE_EXPORT=console`; chỉ chứa span identifiers và allowlisted metadata. Không cấu hình exporter internet hay gửi evidence ra ngoài.

Thứ tự tiếp: (1) durable ingress/result ACK + pg-boss; (2) identity/ACL/session và worker verification boundary; (3) Chronicle staging + sandbox hard gates; (4) artifact/collector + browser approval workflow; (5) security/load/SLO và 72-hour freeze. Các bước cần credential/hạ tầng phải được provision trước; không lấy fixture làm PASS thay thế.

Đợt này bàn giao working-tree changes; chưa commit/push lên GitHub. Không auto-merge hoặc deploy.

Tham khảo kỹ thuật đã đối chiếu: [OpenTelemetry JS context](https://opentelemetry.io/docs/languages/js/context/), [Playwright web server](https://playwright.dev/docs/test-webserver), [grpc-js advisory](https://github.com/advisories/GHSA-m9gg-hp2v-232j).
