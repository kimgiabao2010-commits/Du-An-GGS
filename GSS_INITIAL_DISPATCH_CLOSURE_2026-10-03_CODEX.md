# GSS — Initial Dispatch Closure — Codex

Historical checkpoint: see `GSS_RESULT_DELIVERY_CLOSURE_2026-10-03_CODEX.md` for the subsequent result journal/commit-ACK implementation. Task acceptance ACK, durable intake, pg-boss and full execution recovery remain incomplete.

Ngày: 2026-10-03. Đây là phần triển khai tiếp sau báo cáo hardening ngày 2026-10-02, không phải tuyên bố hoàn thành toàn bộ roadmap.

## Kết quả đã triển khai

Task đầu tiên không còn được gửi trực tiếp ngoài outbox. Control Plane ghi task và dispatch intent trong cùng transaction PostgreSQL. Lỗi ghi outbox làm rollback task và cả case/run nếu chúng được tạo trong transaction này. Không cần thay đổi migration đã phát hành: payload versioned dùng bảng `control_outbox` hiện có, vẫn giữ foreign key đến investigation run.

- Thêm payload `gss.initial-dispatch.v1` nằm trong event `gss.control-outbox.v1`. Hash dùng canonical JSON/SHA-256; initial intent không có frontier, fact hoặc next-step decision giả.
- Task không chỉ định run được liên kết với run bền vững tạo trong cùng transaction; run không thay thế evidence.
- Idempotency lock và semantic fingerprint ngăn concurrent replay tạo task/outbox trùng; reuse khác payload trả conflict, kể cả gọi store trực tiếp.
- Thêm `POST /control/v1/outbox/initial/claim` qua authority HTTP hiện có. Initial intent và planner decision có bộ lọc claim riêng, không giành lease lẫn nhau.
- Publish bắt buộc lease owner tại HTTP client, endpoint và runtime store; bỏ đường publish không kiểm tra owner. Thiếu owner trả 422; owner cũ sau re-claim không publish được.
- Claim kiểm tra event hash, persisted task parameters/provenance, trạng thái terminal, investigation state và deadline. Payload bị sửa, kể cả recompute hash nhưng không khớp task gốc, không được dispatch.
- Task đã có result, task terminal hoặc run inactive/expired được retire intent, giữ lý do trong `last_error`; `published_at` là intent đã được xử lý, không phải chứng cứ worker ACK.
- Command Center lấy initial task từ authority; instruction CLI được dựng từ capability allowlist, không khôi phục prompt tùy ý làm shell command.
- Worker offline: task được ghi BLOCKED, intent chưa published và được retry có lease. BLOCKED này chỉ retry khi chưa có execution/result; một result BLOCKED thực tế không được chạy lại.
- Có guard pending/capacity/halt trước delivery và kiểm tra halt lần nữa sau status write. Halt vẫn là local memory, không được quảng bá thành distributed kill switch.
- Follow-up task tiếp tục dùng planner decision outbox đã có; không tạo initial intent thứ hai cho child task có parent provenance.

Code chính: `packages/sdk/src/runtime/investigation-loop.ts`, `packages/persistence/src/runtime-store.ts`, `packages/persistence/src/loop-store.ts`, `services/control-plane/src/server.ts`, `services/standalone/src/control-plane-client.ts`, `services/standalone/src/command-center.ts`.

## Bằng chứng kiểm tra

Skill `gss-verification-gate` được áp dụng để dùng schema PostgreSQL cô lập cho fault injection, giữ failure path không tạo evidence và phân biệt local verification với staging gate.

| Gate | Status | Lệnh/check và kết quả |
| --- | --- | --- |
| Initial dispatch + causal trace focused | PASS | `npm.cmd run test:integration -- tests/integration/initial-outbox.test.ts tests/integration/causal-trace.test.ts`: 13 tests; PostgreSQL/HTTP/WebSocket thật. |
| Unit regression | PASS | `npm.cmd run test:unit`: 65 tests, 7 packages/services. |
| Integration regression | PASS | `npm.cmd run test:integration -- --reporter=dot`: 70 tests, 13 files, không skip PostgreSQL tests trong lần chạy này. |
| Typecheck | PASS | `npm.cmd run typecheck`: root và Next workspace, exit 0. |
| Build | PASS | `npm.cmd run build`, sau đó `npm.cmd run build -- --force`: 6/6 build tasks, lượt force 0 cached, exit 0; Next production build 28 pages. Sau hardening lease owner, `npm.cmd run build -- --force --filter=@asq/control-plane`: 3/3 dependency/backend tasks pass. Import helper từ built SDK cũng thành công. |
| Browser auth/RBAC | PASS | `npm.cmd run test:browser`: 7 Chromium scenarios trên production UI, exit 0. Không phải browser approval/GitOps E2E. |
| Environment boundary | PASS | `npm.cmd run test:environment`: 1 test; phạm vi secret của các child service. |
| Source/authority | PASS | `npm.cmd run source:check`: TS source và authority boundary. |
| Skills audit | PASS | `npm.cmd run skills:audit`: 6 skills, 3 eval files. |
| Component smoke | PASS | `npm.cmd run test:smoke`: component smoke, không chứng minh Chronicle/sandbox/deployment. |
| Ctrl+Shift+B preflight | PASS local config | `npm.cmd run dev:check`: database configured, 6 services, ports khả dụng; không phải live full-stack startup. Default VS Code task vẫn gọi `npm.cmd run dev`. |
| Scoped whitespace review | PASS | `git diff --check` trên source thay đổi, không reset/xóa generated dist/cache hoặc tài liệu của người dùng. |
| Overall staging gate | BLOCKED | `npm.cmd run readiness`: Chronicle coordinates, Google viewer identity và Docker chưa có; exit 1 là kết quả đúng của hard gate. |

Unique tests/scenarios: 143 = 65 unit + 70 integration + 7 browser + 1 environment. Focused tests nằm trong integration nên không cộng thêm lần nữa. Component smoke và guards được ghi riêng.

Sau thay đổi cuối về lease owner, chạy lại root/Next typecheck và toàn bộ 70 integration tests: PASS. Package persistence cũng chạy lại `npm.cmd exec --workspace=@asq/persistence -- vitest run`: 8/8 tests pass; không cộng lại vào tổng unique tests.

11 integration tests mới ở `tests/integration/initial-outbox.test.ts` bao phủ: rollback bằng trigger lỗi trong schema test; concurrent idempotency; restart Control Plane; phân biệt hai loại intent; concurrent lease và lease expiry; thiếu/stale owner không publish được; tamper hash; tamper có recomputed hash; terminal task; deadline/finalized run; orchestrator offline/restart rồi worker trả failure không tạo evidence; canonical/versioned intent.

Worker outputs trong các scenario restart là fixture có nhãn. DB/server/socket/transaction thật không làm fixture trở thành Chronicle hoặc provider thật. Test không gọi model trả phí, không dừng database service của người dùng. Schema test được kiểm tra tên và xóa sau test; không chạm case/evidence thật để fault-inject.

Regression ban đầu: 58/59 pass, assertion causal trace thất bại vì recovery offline có thêm một dispatch-attempt span. Assertion đã được sửa để cho phép attempt spans, nhưng vẫn yêu cầu đúng bốn worker executions, bốn result spans, bốn task IDs riêng và bốn immutable receipts. Final integration regression 70/70 pass; không bỏ qua yêu cầu logical uniqueness.

## Crash window và giới hạn

| Window | Kết quả/phạm vi |
| --- | --- |
| Outbox insert lỗi trong transaction tạo task | PASS: case/run/task mới rollback, không có dispatch/evidence. |
| Commit task/intent rồi restart Control Plane trước claim | PASS: lấy lại cùng intent từ PostgreSQL, replay không tạo intent thứ hai. |
| Claim rồi owner mất, chưa publish | PASS: lease expiry cho owner khác claim; owner cũ không publish được. |
| Worker offline, restart Command Center | PASS local: intent retry; worker fixture nhận một task và result failure lưu một receipt, không evidence. |
| Nhận command/model response trước transaction tạo task | Chưa có durable command-intake ledger/replanning; không claim ingress end-to-end durable. |
| Socket send thành công nhưng crash trước publish | Chưa có durable worker ACK/dedup; physical execution có thể lặp lại. |
| Published intent nhưng crash trước result commit | Pending vẫn memory; chưa có result spool/ACK/recovery đầy đủ. |
| Case state write ngoài transaction task/intent | Chưa đảm bảo toàn bộ logical case lifecycle atomic hoặc exactly-once. |

Event leasing hiện dùng PostgreSQL `FOR UPDATE SKIP LOCKED`, **chưa tích hợp pg-boss**. Lần kiểm tra restart là restart application/authority và lease expiry, không phải physical PostgreSQL service restart. Không claim zero lost transition trên mọi crash window, exactly-once execution, measured SLO hay 72-hour freeze.

## Những phần vẫn chưa hoàn tất

1. Durable command intake, worker ACK/dedup và result spool/retry; sau đó pg-boss và crash/replay/load matrix đầy đủ.
2. Durable kill switch, lifecycle writer semantics, incident ACL, session revocation và identity OIDC/MFA/mTLS; local shared HMAC không phải production boundary.
3. Chronicle staging read-only với coordinates, viewer-only ADC/WIF và dataset được phép/redacted: BLOCKED external configuration.
4. Rootless Docker/gVisor và sandbox adversarial: BLOCKED runtime chưa có. Không host fallback để vượt gate.
5. Approval runtime/browser workflow, artifact-hash-bound hai approver và proposal-only GitOps E2E: chưa hoàn chỉnh; không merge/deploy tự động.
6. S3/retention/Object Lock, external telemetry collector, labeled routing corpus/eval và paid-provider usage reconciliation: NOT RUN trong đợt này.
7. GitHub CI cho working diff mới, OSV/Trivy, SLO/load/recovery và 72-hour freeze: NOT RUN trong đợt này.

Không mở remediation, SIEM writeback, auto-merge hoặc auto-deploy. Không sửa DOCX/PDF đầu vào, không đưa credential `.env` vào báo cáo. Chưa commit/push đợt này.

## Bàn giao

Đợt này hoàn tất phần **atomic initial task dispatch** và kiểm chứng local; toàn bộ roadmap chưa hoàn tất. Ctrl+Shift+B giữ workflow migration → build → Control Plane ready → Command Center/workers/UI; không dùng preflight thay full-stack E2E.

Force-build verification: PASS, 6/6 tasks, 0 cached, exit 0. Chạy thêm lượt bỏ Turbo cache vì môi trường kiểm tra có cảnh báo không đọc được dirty Git hash; không sửa cấu hình Git global của người dùng. Helper `initialTaskDispatchEvent` được import và gọi thành công từ built SDK, trả payload version `gss.initial-dispatch.v1`.
