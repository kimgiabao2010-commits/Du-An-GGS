# GSS — Worker Result Delivery Closure — Codex

Ngày: 2026-10-03. Phạm vi: làm tiếp phần result retry/commit ACK sau atomic initial dispatch. Chưa hoàn thành toàn bộ roadmap hoặc staging readiness.

## Đã triển khai

Luồng mới: worker journal → WebSocket → PostgreSQL raw receipt → prepared envelope → transaction result/frontier/receipt → RESULT_ACK → xóa journal đã được xác nhận.

1. Thêm contract `gss.worker-delivery.v1`, delivery ID theo canonical JSON/SHA-256 và `ResultSubmission` hash. Retry giữ nguyên nội dung nhưng dùng message ID/timestamp mới cho mỗi frame; replay protection của socket không bị vô hiệu hóa.
2. SDK có `ReliableResultQueue`: tối đa 100 kết quả chưa ACK, payload tối đa 48 KB, worker identity cố định, không silently evict. Có journal filesystem opt-in với exclusive temporary write, file fsync và rename; worker/queue restart đọc lại file chưa ACK. File bị sửa, khác worker hoặc malformed JSON bị từ chối; error không in nội dung journal. Temporary write chưa hoàn chỉnh không được replay.
3. SDK gửi lại kết quả khi kết nối phục hồi hoặc chưa có ACK; mỗi flush tối đa 10 records, retry tối thiểu 2 giây cho mỗi record. Kết quả quá lớn được báo FAILED/RESULT_OUTPUT_LIMIT, không tạo evidence/truncation success giả. ACK phải đúng delivery ID, task và case, `committed=true`, nguồn Standalone.
4. CLI, IDE và SIEM worker dùng reliable result publication. Task đang có kết quả chưa ACK được gửi lại kết quả cũ, không chạy lại chỉ vì cùng task được dispatch lại. Điều này không phải durable exactly-once execution cho mọi task/crash window.
5. Launcher Ctrl+Shift+B tự cấp journal riêng: `GSS_DATA_DIR/worker-spool/cli`, `/ide`, `/siem`; UI và authority không nhận `GSS_WORKER_SPOOL_DIR`. Worker không nhận database/private signing/model credential mới. `/data/` và `worker-spool` được gitignore để không vô tình đẩy raw operational output lên GitHub.
6. Migration `007_worker_result_deliveries.sql` thêm raw receipt, prepared payload/hash, committed state và retry metadata. Raw receipt và prepared payload không được gọi là evidence.
7. Control Plane có receive/pending/prepare/retry API, dùng auth boundary hiện có. Receive bind với task/case/assigned worker/target; một task chỉ có một raw delivery ID. Concurrent replay không tạo nhiều raw receipt. Payload khác, provenance khác hoặc hash không đúng bị từ chối.
8. Prepared envelope đầu tiên được giữ nguyên. Các timestamp, ObservationPack IDs, signature và metrics đã chuẩn hóa không bị tạo lại sau restart rồi gây false conflict. Shared submission validator áp dụng cho prepare và commit.
9. Transaction result commit kiểm tra prepared hash, ghi immutable receipt/frontier/decision và `committed_at` cùng transaction. ACK chỉ phát sau commit. Mất commit response/ACK được xử lý bằng đọc lại committed receipt và re-ACK; không tạo thêm result transition.
10. Command Center có background recovery từ PostgreSQL, không phụ thuộc pending map hoặc worker phải gửi lại. Processing lỗi được giữ lại với backoff, capped delay dưới 5 phút. Corrupted receipt bị defer riêng, không làm cả batch hợp lệ bị bỏ qua. Không ACK cho dữ liệu chưa commit hoặc dữ liệu bị từ chối.
11. Chặn token role không đúng worker ID hoặc thiếu REPORT, không nâng worker failure thành successful evidence, không commit late result sau durable terminal cancellation. Các receipt bị policy/cancellation từ chối được giữ để reconciliation, không tự xóa hoặc giả ACK.
12. `test:integration` nay chạy qua launcher schema cô lập, áp dụng tất cả migrations trong schema test rồi dọn khi kết thúc bình thường. Không chạy migration 007 vào schema runtime của người dùng chỉ để đạt test xanh.

PostgreSQL vẫn là lifecycle/evidence source-of-truth. Worker journal chỉ là transport buffer cho output chưa được authority xác nhận; không cấp quyền, không tự sửa task state, không thay database.

## Verification

Skill `gss-verification-gate` định hướng test failure/restart trên schema PostgreSQL cô lập, không paid-provider call và không đánh đồng fixture với staging.

| Gate | Status | Bằng chứng/phạm vi |
| --- | --- | --- |
| Unit | PASS | `npm.cmd run test:unit`: 73 tests, gồm 8 tests mới cho queue/journal. |
| Integration | PASS | `npm.cmd run test:integration -- --reporter=dot`: 80 tests, 14 files; PostgreSQL/HTTP/WebSocket thật, schema cô lập. |
| Focused result recovery | PASS | `npm.cmd run test:integration -- tests/integration/result-delivery.test.ts`: các scenario role/provenance, prepared replay, transaction rollback, worker/CC restart, lost response, cancellation và poison/backoff nằm trong full suite. |
| Typecheck | PASS | `npm.cmd run typecheck`: root và Next workspace. |
| Build | PASS | `npm.cmd run build -- --force`: 6/6 tasks, 0 cached, Next production UI 28 pages. Backend/dependency force-build chạy lại sau các thay đổi cuối. |
| Environment | PASS | `npm.cmd run test:environment`: 2 tests, gồm journal scope riêng cho ba worker. |
| Source authority | PASS | `npm.cmd run source:check`: TypeScript và Control Plane writer boundary. |
| Skills audit | PASS | `npm.cmd run skills:audit`: 6 skills, 3 eval files. |
| Smoke | PASS | `npm.cmd run test:smoke`: component smoke, không phải Chronicle/sandbox E2E. |
| Ctrl+Shift+B preflight | PASS local config | `npm.cmd run dev:check`: database configured, 6 services, ports khả dụng. Không phải full live-stack startup. |
| Runtime migration 007 | NOT RUN | Chỉ áp dụng vào schema test ở đợt này; Ctrl+Shift+B sẽ chạy migration trước startup. `/readyz` yêu cầu bảng mới, không silently chạy thiếu migration. |
| Browser | NOT RUN đợt này | Auth/UI source không đổi trong đợt result delivery; 7 browser tests của đợt trước không cộng vào kết quả hiện tại. |
| Dependency/security scanners, remote CI | NOT RUN | Không thêm dependency; không lấy test local làm bằng chứng GitHub CI/OSV/Trivy. |
| Overall staging | BLOCKED | `npm.cmd run readiness`: thiếu Chronicle coordinates, viewer ADC/WIF và Docker. |

Tổng unique tests đợt này: 155 = 73 unit + 80 integration + 2 environment. Focused runs không cộng thêm lần nữa. Build/smoke/source/skills checks được ghi riêng.

Trong verification, một lượt đầy đủ đã xanh nhưng log cho thấy background reader nhận PostgreSQL composite dưới dạng string. Tôi sửa query thành JSONB và bổ sung assertion: sau restart, worker vẫn disconnect nhưng receipt phải được commit trước khi worker reconnect để lấy ACK. Đây là bằng chứng phục hồi nền, không phải chỉ resend từ worker.

Raw worker/model outputs trong scenario có nhãn fixture; positive fixture chỉ chứng minh atomic frontier/idempotency. Không có Chronicle staging, actual SOC finding, paid LLM, deployment hoặc remediation trong test. Filesystem journals/DB/server/socket trong tests là thật.

## Crash window đã kiểm tra và còn thiếu

| Window | Kết quả |
| --- | --- |
| Journal đã ghi, worker process/queue được tạo lại | PASS local: result được load lại với cùng delivery ID. |
| Raw result đã lưu, normalization/commit chưa xong | PASS local: PostgreSQL giữ receipt, Command Center recover sau restart. |
| Prepared result đã lưu, worker và CC restart trước commit | PASS local: background commit không cần worker online; journal chỉ xóa sau re-ACK. |
| Commit thành công nhưng response/ACK mất | PASS local: resend đọc committed state, re-ACK, một receipt. |
| Receipt insert lỗi trong transaction | PASS: result/receipt/commit-ACK state rollback cùng nhau. |
| Result replay với positive fixture | PASS: một frontier, một decision, một receipt. |
| Failed worker payload bị cố nâng thành success | PASS: denied, không evidence. |
| Result đến muộn sau cancellation | PASS denial: không commit; vẫn cần operator reconciliation để đóng retained journal. |
| Task được nhận/chạy nhưng worker crash trước khi ghi journal | Chưa có durable task acceptance/execution ledger; chưa đảm bảo không mất hoặc không chạy lại. |
| Disk-full/fsync/rename failure, power loss, lost local volume | Chưa có adversarial/power-loss gate; không claim hardware-level durability. |
| Multi-host/multi-CC delivery acquisition | Chưa có pg-boss/claim ownership cho result recovery; transaction guards không chứng minh exactly-once physical execution. |
| ACK đã phát nhưng case message/state UI chưa ghi | Result/evidence không mất, nhưng case lifecycle/message side effects chưa cùng transaction/outbox. |

RESULT_ACK khác task-accepted ACK. Các cải tiến này không biến socket dispatch thành worker đã nhận/đã thực thi bền vững.

Journal ghi file với mode hạn chế trên nền tảng hỗ trợ; Windows ACL, encryption/retention, untrusted parent symlink races và staging volume protection chưa được chứng minh. Nếu khởi chạy worker trực tiếp không qua launcher và không đặt `GSS_WORKER_SPOOL_DIR`, queue chỉ ở memory. Reconnect hiện có số lần thử hữu hạn; hết reconnect/token cần restart/renew để tiếp tục, journal không bị xóa.

## Chạy và phần tiếp theo

Trong VS Code bấm Ctrl+Shift+B như trước: migration → build → authority ready → workers/UI. Migration 007 sẽ được kiểm tra/apply ở startup, journal worker được cấp tự động. Không cần đưa DATABASE_URL hoặc credential Control Plane cho worker.

Chạy regression: `npm.cmd run test:unit`, `npm.cmd run test:integration`, `npm.cmd run test:environment`, `npm.cmd run typecheck`, `npm.cmd run build -- --force`. Integration runner cần tài khoản PostgreSQL được tạo schema test; nếu DATABASE_URL không có, PostgreSQL cases là NOT RUN/skipped, không được gọi là PASS thực.

Ưu tiên tiếp: durable command intake và task acceptance/execution ledger → pg-boss acquisition/retry → durable halt và atomic case/message lifecycle → approval/identity → Chronicle/sandbox hard gates. Chưa mở remediation, SIEM writeback, merge/deploy tự động. Chưa commit/push đợt này; giữ nguyên các DOCX/PDF và thay đổi không liên quan của người dùng.
