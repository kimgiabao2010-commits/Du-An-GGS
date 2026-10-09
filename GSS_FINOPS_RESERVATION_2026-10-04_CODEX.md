# GSS — Durable Model Reservation — Codex

Ngày: 2026-10-04 · Phạm vi: FinOps admission/settlement cho runtime Standalone LlmRouter.

## Kết quả triển khai

Đã nối reservation trước provider call vào luồng Command Center → Control Plane → PostgreSQL. Model không được tự tăng budget, chọn thêm capability hay quyết định approval. Chưa đóng toàn bộ roadmap hoặc chứng nhận production.

- Migration `013_model_reservations.sql`: case budgets, call reservations, ledger linkage và immutable binding/state/policy triggers.
- Authority duy nhất: Control Plane. Command Center dùng HTTP client, không ghi DB trực tiếp.
- `POST /control/v1/model-reservations`: giữ một ceiling theo policy server; cùng usage ID/body là replay, thay body là conflict.
- `POST /control/v1/model-reservations/start`: một chuyển `RESERVED → STARTED`; kể cả lặp cùng attempt ID cũng không cấp quyền gọi lần nữa.
- `GET /control/v1/cases/:id/model-budget`: snapshot metadata giới hạn/đã quyết toán/đang giữ và tối đa 100 invocation; nằm sau incident ACL. Không chứa prompt, response hay credential.
- `POST /control/v1/model-usage`: quyết toán reservation, audit, ledger và run cost trong cùng transaction. Insert ledger lỗi thì toàn bộ settlement rollback.
- RPC reservation/start là service-only, kể cả operator có role `SECURITY_ADMIN` cũng không được bypass.

Ngân sách khả dụng được kiểm tra bằng số nguyên: `limit − spent − held`. PostgreSQL khóa account theo case để concurrent admission không đặt vượt ngân sách. Không dùng token estimate của ContextBudgeter làm usage hoặc billable cost.

## Failure và crash semantics

| Trạng thái | Điều xảy ra | Điều không được suy diễn |
|---|---|---|
| RESERVED | Ceiling đã giữ, provider chưa được cấp quyền gọi | Không phải đã tốn tiền |
| STARTED | Một attempt được cấp quyền; không cấp lại sau restart/lost ACK | Không chứng minh provider thực sự nhận hoặc tính tiền |
| SETTLED | Usage đầy đủ và configured cost đã ghi; trả phần ceiling chưa dùng | Không phải invoice reconciliation |
| UNKNOWN | Giữ nguyên toàn bộ ceiling; chặn call mới và task creation của case | `spent=0` không có nghĩa miễn phí; ledger cost vẫn NULL |
| BREACHED | Ghi đúng estimated cost vượt ceiling, trả hold và khóa call/task mới | Không che phần vượt và không claim ngăn được provider đã tính phí |

Không TTL-refund cho call đã bắt đầu. Restart không reset STARTED. Một lost ACK trước provider có thể làm không có call nào nhưng vẫn giữ ceiling; lựa chọn này ưu tiên fail-closed hơn availability. RESERVED bỏ dở cũng chưa có auto-refund hoặc manual-release API.

Xóa cấu hình policy không bỏ được boundary của case đã có budget. Đổi policy/limit giữa chừng bị từ chối, không tự nâng ngân sách. Case CLOSED và durable halt ngăn admission/start mới.

Kết quả model đã được lưu trong frozen intake decision có thể được replay để ghi ledger mà không gọi lại model. Crash sau provider nhưng trước freeze decision vẫn là uncertainty: hold giữ nguyên, lần xử lý sau không gọi lại cùng invocation.

## Cấu hình và giới hạn quan trọng

Biến **Control Plane only**: `GSS_MODEL_BUDGET_POLICY_JSON`. Launcher không truyền policy sang worker, UI hoặc Command Center. Command Center nhận quyết định admission từ authority.

Policy cần version, case budget và allowlist từng provider/model với reservation ceiling, maximum serialized request bytes và maximum output tokens. Mẫu trong `.env.example` được ghi rõ là **fixture, không phải giá thật hoặc khuyến nghị pricing**.

Local không cấu hình policy vẫn là unbudgeted demo để không âm thầm phá cấu hình đang chạy. Staging từ chối thiếu policy; LlmRouter staging cũng từ chối missing/disabled gate trước provider call. Tôi không sửa `.env` thật, không bật fixture ceilings và không gọi provider trả phí trong đợt này.

Ceiling phải được review theo pricing/account/provider thực tế. Serialized request bytes chỉ là admission bound, không phải số token chính xác. Cost quyết toán hiện vẫn là **provider token counts × configured rates** trong ledger sẵn có, chưa được authority tự đối chiếu rate card/invoice. Vì thế đây là durable reservation enforcement, **không phải bảo đảm tuyệt đối số tiền nhà cung cấp sẽ thu**. Nếu estimate vượt ceiling, hệ thống ghi BREACHED và khóa case, không sửa số để trông như pass.

Giữ `NULL/UNKNOWN` khi thiếu counts/rates. Schema Chat Completions hiện có `prompt_tokens_details.cache_write_tokens`; không thay trường thiếu bằng 0. Tham chiếu [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) và [prompt caching accounting](https://developers.openai.com/api/docs/guides/prompt-caching). Không đổi model baseline hoặc hardcode bảng giá.

## Verification

Final `npm.cmd run verify:local` kết thúc **10:17:17 ngày 2026-10-04 (Asia/Bangkok), exit 0, Local PASS**. Cả 10 gate PASS; source fingerprint không đổi trong lượt kiểm chứng. Lượt trước có 222 test xanh nhưng typecheck lỗi literal typing trong test fixture nên vẫn FAILED; đã sửa fixture, không nới runtime policy. Không dùng lượt FAILED làm chứng nhận.

| Gate | Kết quả |
|---|---|
| Source authority / skill audit | PASS; 6 skills, 3 eval files |
| Build | PASS 6/6 workspace, UI 29 pages |
| Typecheck | PASS backend + UI |
| Unit | 90 PASS, 17 files |
| PostgreSQL integration | 118 PASS, 20 files; live local DB, schema cô lập |
| Child environment | 6 PASS |
| Component smoke | PASS; không phải staging E2E |
| Chromium browser | 8 PASS; không phải OIDC staging certification |
| Production dependency audit | PASS, 0 vulnerabilities; không thay OSV/Trivy remote gate |

Tổng **222 tests PASS** cộng các gate build/static/smoke/audit.

Manifest và log: [final verification](<D:/du an GGS/data/verification/2026-10-04T03-15-16-843Z-0dde7fe4-2286-44ef-a4dd-ad3d2628417a/manifest.json>).
Scoped source SHA-256: `68d715ba886f4b704a65098efadb28a1455b93f259ee0253c66f4fed6bc3cb07`.
HEAD ghi trong manifest vẫn là `7bbd8adf87bd58778a9af8c82851646211ed41ae`; thay đổi mới chưa commit. Fingerprint không bao gồm root report Markdown và không phải signed release attestation.

`npm.cmd run dev:check`: PASS dry-run sáu service và port check. Git diff whitespace check (source/text, loại generated dist/cache logs): PASS, chỉ còn cảnh báo LF/CRLF. `npm.cmd run readiness`: BLOCKED, PostgreSQL connectivity PASS nhưng Chronicle coordinates, Google viewer identity và Docker daemon chưa có. Chưa migrate runtime DB hoặc chạy paid model.

Acceptance được kiểm tra bằng PostgreSQL thật trong schema test riêng:

- concurrent admission/held+spent exhaustion;
- exact replay và case/request/limit mismatch;
- CAS start một lần, same-attempt duplicate và restart;
- settlement/replay/conflict/ledger rollback;
- UNKNOWN giữ hold, BREACHED ghi cost thật theo fixture, không tạo task mới;
- unreserved usage, wrong attempt, incomplete usage, unsupported provider/model;
- policy removal/change, DB binding/state/limit immutability;
- legacy unknown accounting và CLOSED case;
- router không gọi provider khi reservation denied, STARTED replay hoặc lost acquisition;
- staging missing gate/disabled gate; deterministic intent không gọi model;
- provider failure giữ reservation identity và UNKNOWN usage;
- service-only RBAC và child environment scope.

DB là thật; provider, prices và counts trong test là synthetic fixtures. Chưa invoice/provider E2E. Migration 013 chỉ áp vào schema test trong lượt này; Ctrl+Shift+B sẽ chạy migration trước stack, không phải tôi đã migrate runtime DB.

## Còn phải làm

1. Rate-card version/provider pricing được review, server-side reconciliation và audited xử lý reservation không có usage; không tự trả tiền hoặc giả lập invoice.
2. Live provider metadata được phép, billing reconciliation và eval corpus SOC. Chưa thực hiện paid call.
3. Fleet heartbeat/workload identity, các UI còn demo, browser OIDC staging, approved proposal verification.
4. Chronicle staging, Linux rootless sandbox adversarial, Object Lock/OTLP live, remote security CI, load/recovery và freeze 72 giờ.

Release vẫn **BLOCKED** bởi các gate chưa có evidence. Remediation, SIEM writeback, auto-merge và auto-deploy vẫn tắt. Không commit/push/deploy trong đợt này.

## Skill influence

`gss-model-routing-eval` giữ unknown cost và cấm silent fallback; `gss-evidence-next-step` giữ dispatch policy ở authority; `gss-verification-gate` yêu cầu real DB regression và giữ failure report. OpenAI Docs giúp xác nhận schema/cache-write accounting, không thay model hay đoán giá.
