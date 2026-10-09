# GSS Goal Conditions — Codex Sol High

Date: 2026-09-27

> Historical planning snapshot. Current verification as of 2026-10-02 is recorded in [GSS_DAILY_CLOSURE_2026-10-02_CODEX.md](GSS_DAILY_CLOSURE_2026-10-02_CODEX.md). The statuses below describe the original baseline, not today's repository. No readiness percentage is being declared.

## Quy tắc đánh giá

GSS không được công bố phần trăm readiness dựa trên cảm nhận. Một goal chỉ đạt khi toàn bộ điều kiện con có bằng chứng trực tiếp và được gắn một trong bốn trạng thái:

- `PASS`: đã có code, test đúng phạm vi và bằng chứng runtime cần thiết.
- `PARTIAL`: đã có một phần code/test nhưng còn thiếu bằng chứng cùng phạm vi.
- `BLOCKED`: code có thể đã sẵn sàng nhưng thiếu dependency hoặc quyền truy cập bên ngoài.
- `NOT RUN`: có thể kiểm tra nhưng chưa chạy.

Dashboard, mock, fixture, output LLM và smoke test thành phần không được dùng thay cho bằng chứng PostgreSQL, Chronicle, sandbox hoặc closed-loop staging thật.

## Hard gates bổ sung

| ID | Điều kiện bắt buộc | Bằng chứng hoàn thành | Hiện tại |
| --- | --- | --- | --- |
| GSS-GATE-001 | TypeScript là runtime source-of-truth duy nhất | Không còn `.js/.d.ts/.map` sinh cũ trong `src`; test package luôn build dependency trước khi chạy | `PARTIAL` — dependency build đã bắt buộc, artifact cũ trong `src` còn tồn tại |
| GSS-GATE-002 | PostgreSQL là source-of-truth duy nhất | Launcher từ chối chạy khi thiếu DB; migrations có checksum; restart không mất state | `PARTIAL` — launcher/checksum đã có, live DB chưa xác minh |
| GSS-GATE-003 | Migration an toàn và lặp lại được | Chạy migrations hai lần trên PostgreSQL sạch và PostgreSQL đã có dữ liệu; lần hai không thay đổi state | `BLOCKED` — thiếu `DATABASE_URL` hợp lệ |
| GSS-GATE-004 | Investigation run durable | Run, budget, deadline, depth, frontier version và policy sống qua restart | `PARTIAL` — schema và transaction đã có, chưa test DB thật |
| GSS-GATE-005 | Evidence frontier deterministic | Dedup fact tương đương, giữ contradiction, mỗi fact truy ngược task/evidence/artifact | `PASS` ở contract/unit test |
| GSS-GATE-006 | Không có evidence giả | Worker/provider lỗi, timeout hoặc payload sai không được tạo evidence/frontier thành công | `PASS` ở local integration; staging chưa xác minh |
| GSS-GATE-007 | Planner bounded | Enforce depth, deadline, external-query, cost và repeated-action guard | `PASS` ở unit test |
| GSS-GATE-008 | Transactional state transition | Result, observation, frontier, decision, outbox và audit cùng commit hoặc cùng rollback | `PARTIAL` — transaction test qua mock client; cần PostgreSQL fault test thật |
| GSS-GATE-009 | Outbox restart-safe | Event được lease, integrity-check, retry; chỉ publish sau khi worker nhận | `PASS` ở restart integration mô phỏng; live DB còn thiếu |
| GSS-GATE-010 | Không duplicate logical transition | Replay cùng observation/idempotency trả cùng decision; body khác phải `409` | `PARTIAL` — loop replay có; Control API `409` chưa có |
| GSS-GATE-011 | Control Plane là writer duy nhất | UI/worker chỉ gọi `/control/v1`; không ghi trực tiếp task lifecycle | `NOT RUN` — Control Plane HTTP API chưa triển khai |
| GSS-GATE-012 | API semantics cố định | Replay cùng body `200`; reuse khác body `409`; schema `422`; policy `403`; unavailable `503` | `NOT RUN` |
| GSS-GATE-013 | Health có ý nghĩa | `/livez` chỉ báo process; `/readyz` kiểm tra PostgreSQL, migration và authority dependencies | `NOT RUN` |
| GSS-GATE-014 | Approval bind đầy đủ | Bind case, action, canonical parameters, artifact hash, policy, requester và expiry | `PASS` ở persistence test |
| GSS-GATE-015 | Dual approval thật | Hai approver khác nhau; requester không tự approve; duplicate idempotent | `PASS` ở persistence test |
| GSS-GATE-016 | Approval không cấp deploy authority | Kết quả cao nhất là `APPROVED_FOR_PROPOSAL`; không merge/deploy tự động | `PASS` ở persistence contract; API/GitOps chưa có |
| GSS-GATE-017 | Artifact mutation vô hiệu approval | Hash khác bị từ chối và ghi audit denial | `PASS` ở persistence test |
| GSS-GATE-018 | Chronicle read-only staging | Known IOC, zero result, invalid query, 401/403/429/timeout/truncation đều có bằng chứng | `BLOCKED` — thiếu Chronicle coordinates và viewer identity |
| GSS-GATE-019 | Chronicle fail-closed | Adapter failure tạo `BLOCKED/FAILED`, không tạo evidence | `PASS` ở contract test; staging chưa xác minh |
| GSS-GATE-020 | Sandbox không fallback host | Rootless container, read-only root, network off, non-root, resource limits, COW workspace | `NOT RUN` — runner hiện là mock và máy chưa có Docker |
| GSS-GATE-021 | Sandbox adversarial | Traversal, symlink, egress, fork bomb, memory, timeout, output overflow, host immutability | `NOT RUN` |
| GSS-GATE-022 | Model usage ledger thực | Mọi invocation ghi model, effort, route, tokens, latency, retry, cost, trace và status | `PARTIAL` — schema/store có, runtime chưa gọi ledger |
| GSS-GATE-023 | Routing có eval | Labeled corpus, Sol baseline, shadow-route Luna/Terra, cost-quality report | `NOT RUN` |
| GSS-GATE-024 | Không silent downgrade | High-risk/provider failure phải block hoặc dùng route được policy cho phép | `PARTIAL` — routing test có, runtime ledger/eval chưa đủ |
| GSS-GATE-025 | Identity boundary staging | OIDC/MFA-capable identity, revocation, role authorization và incident ACL | `BLOCKED` — chỉ có local demo auth |
| GSS-GATE-026 | Trust-boundary UI | `/standalone` và `/control` tách route, navigation và server-side authorization | `NOT RUN` |
| GSS-GATE-027 | Artifact store staging | S3-compatible, content-addressed SHA-256, metadata PostgreSQL, retention/Object Lock | `NOT RUN` — local filesystem only |
| GSS-GATE-028 | End-to-end tracing | Một trace xuyên case → task → outbox/queue → worker → result → frontier | `NOT RUN` |
| GSS-GATE-029 | Signing-key separation | Control Plane giữ private signing key; worker chỉ có verify public key Ed25519/JWS | `NOT RUN` — hiện dùng shared HMAC secret |
| GSS-GATE-030 | Security scanning release gate | OSV lockfile + Trivy vulnerability/misconfig/secret; exception có owner và expiry | `NOT RUN` — CI hiện chỉ build/typecheck/test |
| GSS-GATE-031 | Browser E2E đúng trust boundary | Analyst flow Standalone và operator/approval flow Control Plane chạy trên browser thật | `NOT RUN` |
| GSS-GATE-032 | Load/recovery | Concurrent cases, worker crash, DB restart, provider retry và queue replay không mất transition | `NOT RUN` |
| GSS-GATE-033 | SLO được đo | API p95 <300 ms, enqueue p95 <500 ms, queue lag p95 <2 s, internal HTTP error <1% | `NOT RUN` |
| GSS-GATE-034 | 72-hour release freeze | Không blocker mới; regression/load/recovery liên tục; findings có disposition | `NOT RUN` |

## Điều kiện riêng cho Control Plane API

Các endpoint sau phải cùng dùng PostgreSQL authority và cùng cơ chế authorization:

1. `POST /control/v1/tasks`
   - Chỉ chấp nhận contract version được hỗ trợ.
   - Idempotency key được bind với canonical body hash.
   - Không dispatch trước khi task và outbox cùng commit.
2. `GET /control/v1/tasks/:id`
   - Không rò task ngoài incident ACL.
   - Trả lifecycle từ PostgreSQL, không lấy từ UI cache.
3. `POST /control/v1/results`
   - Worker identity phải khớp target/executor/task.
   - Một task chỉ có một logical result; replay cùng body idempotent, body khác conflict.
4. `GET /control/v1/cases/:id/frontier`
   - Xác minh frontier hash trước khi trả.
   - Trả contradictions và provenance đầy đủ.
5. `POST /control/v1/approvals` và `POST /control/v1/approvals/:id/decision`
   - Enforce requester/approver separation ở server.
   - Không nhận identity từ request body.
6. `GET /control/v1/audit`
   - Chỉ `AUDITOR`/`SECURITY_ADMIN`.
   - Pagination bounded; không có delete endpoint.
7. `GET /control/v1/workers`
   - Phân biệt connected, healthy, stale và revoked.
8. `/livez`, `/readyz`
   - Không yêu cầu đăng nhập nhưng không lộ secret hoặc topology nhạy cảm.

## Điều kiện hoàn thành engineering MVP ~85%

Chỉ được gọi là engineering MVP khoảng 85% khi:

- GSS-GATE-001 đến GSS-GATE-021 đều `PASS`;
- GSS-GATE-025, 026, 028, 029, 030, 031 và 032 đều `PASS`;
- Chronicle staging và sandbox adversarial có artifact/provenance thật;
- không còn gate `BLOCKED` trong release scope;
- report cuối ghi riêng `PASS`, `BLOCKED`, `NOT RUN`, không quy đổi `PARTIAL` thành hoàn thành;
- production readiness vẫn phải được gọi là chưa đạt cho tới khi SLO và 72-hour freeze hoàn tất.

## Thứ tự thực thi tiếp theo

1. Control Plane API authority và exact idempotency semantics.
2. Live PostgreSQL migration + restart/replay/fault integration.
3. Model usage wiring và trace IDs.
4. `/standalone`–`/control` route split cùng server-side roles.
5. Chronicle staging hard gate.
6. Rootless Docker/gVisor sandbox hard gate.
7. Artifact store, OTel, signing-key separation và security scanners.
8. Browser E2E, load/recovery và 72-hour freeze.
