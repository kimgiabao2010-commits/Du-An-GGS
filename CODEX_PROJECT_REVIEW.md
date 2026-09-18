# Báo cáo rà soát tổng thể ASQ-Engine — Codex

> Cập nhật 2026-09-18: trạng thái kiểm chứng hiện hành nằm tại [PROJECT_TRUTH.md](PROJECT_TRUTH.md), [review kiến trúc/bảo mật Codex](CODEX_ASTRA_SECURITY_REVIEW.md) và [runbook local](CODEX_LOCAL_RUNBOOK.md). Các tuyên bố hoàn tất/PASS hoặc hạn chế build/test bên dưới thuộc thời điểm tài liệu được viết; không phải chứng nhận production hiện tại.

**Ngày rà soát:** 2026-09-16
**Phạm vi:** Toàn bộ tài liệu Markdown, cấu trúc repository, manifest, mã nguồn liên quan và kiểm tra build/test.

## 1. Kết luận điều hành

ASQ-Engine có ý tưởng kiến trúc tốt và định hướng đúng cho một nền tảng Autonomous SecOps: Standalone điều phối, IDE phân tích, CLI thực thi, còn SDK/Guardrails phụ trách giao tiếp và kiểm soát an toàn.

Tuy nhiên, trạng thái thực tế hiện tại phù hợp với **prototype/scaffolding**, chưa phải hệ thống Enterprise Production. Một số tài liệu QA tuyên bố các phase đã PASS 100%, trong khi mã nguồn vẫn còn nhiều adapter/mock và kiểm tra E2E chưa chạy thành công.

## 2. Điểm mạnh

- Kiến trúc Quartet và ranh giới vai trò giữa Standalone, IDE, CLI, SDK tương đối rõ.
- Có tư duy Zero-Trust, RBAC, MFA, kill-switch, dual approval, audit log và progressive autonomy.
- Monorepo Turborepo đã được dựng.
- Có package riêng cho SDK, auth, guardrails và CLI.
- Có dashboard Next.js, unit test và kịch bản closed-loop.
- Tài liệu mô tả được luồng SIEM → điều tra → thu thập evidence → tạo patch → kiểm thử → triển khai.

## 3. Các phát hiện quan trọng

### 3.1. Tài liệu và implementation chưa đồng nhất

Các tài liệu như `docs/qa/PHASE_6_ACCEPTANCE.md`, `PHASE_4_ASSESSMENT.md` và `PHASE_5_ASSESSMENT.md` mô tả trạng thái hoàn tất/PASS 100%. Nhưng mã nguồn vẫn có các thành phần mô phỏng:

- `services/ide-reasoning/src/engine.ts` dùng `fakeEvidence`.
- `services/ide-reasoning/src/ast/ast-parser.ts` trả dữ liệu AST giả lập.
- `services/ide-reasoning/src/remediation/patch-generator.ts` sinh diff/YARA-L giả lập.
- `services/cli-worker/src/sandbox/ephemeral-runner.ts` chưa chạy Docker sandbox thật.
- `services/standalone/src/ingestion/siem-receiver.ts` dùng alert mô phỏng.
- `packages/sdk/src/transport/grpc-client.ts` có fallback `mock-hash-123`.
- `services/standalone/src/autonomy/progressive-controller.ts` dùng HITL approval mô phỏng.
- Runtime vẫn sử dụng các token như `worker-token-mock`.

Nên phân loại lại trạng thái thành: **prototype có implementation một phần**, chưa phải production-ready.

### 3.2. Build/test chưa xác nhận PASS

Kết quả kiểm tra thực tế:

- Các package TypeScript chính build được.
- `apps/standalone` thất bại khi Next.js ghi `.next/server/pages-manifest.json`.
- `npm test` thất bại trước khi chạy assertion do vấn đề load module/import giữa `.js` và `.ts` với `ts-node`/`NodeNext`.

Do đó chưa nên ghi nhận E2E hoặc toàn bộ dự án là PASS 100%.

### 3.3. VS Code Extension được tài liệu hóa nhưng chưa thấy trong repository

`docs/qa/PHASE_4_ACCEPTANCE.md` tham chiếu `apps/ide-extension/`, `PatchWebviewProvider.ts` và `ast-patcher.ts`. Kiểm tra repository cho thấy thư mục `apps/ide-extension` không tồn tại.

Hiện có `services/ide-reasoning`, nhưng đây là service backend, không thay thế cho một VS Code extension hoàn chỉnh.

### 3.4. Production security còn thiếu bằng chứng

Cần hoàn thiện và kiểm thử thực tế các phần sau:

- Xác minh chữ ký ở phía nhận, không chỉ tạo chữ ký.
- Cấm fallback mock trong production.
- Loại bỏ token/API secret mặc định khỏi code và cấu hình.
- Allowlist command và policy engine cho CLI.
- Docker/Podman sandbox với giới hạn filesystem, network, capability và resource.
- Kill-switch phải ngắt worker thật, không chỉ đóng WebSocket.
- Audit log bất biến và có kiểm chứng end-to-end.
- Canary/rollback sử dụng metric thật thay vì dữ liệu hard-code.

### 3.5. Tài liệu cần chuẩn hóa

- Có hai file kiến trúc gần như trùng nhau: `ARCHITECTURE_GGS_CORE.md` và `docs/ARCHITECTURE_GGS_CORE.md`.
- Một số môi trường hiển thị tiếng Việt bị lỗi encoding. Nên thống nhất UTF-8.
- Nên tạo một nguồn sự thật duy nhất, ví dụ `PROJECT_TRUTH.md`, ghi rõ trạng thái code, test, mock và production readiness của từng tính năng.

## 4. Thứ tự ưu tiên đề xuất

1. Làm cho `npm run build` và E2E test chạy ổn định.
2. Chuẩn hóa chiến lược module TypeScript, tránh import lẫn `.js` và `.ts` không nhất quán.
3. Tách rõ adapter `mock`, `local`, `integration` và `production` bằng cấu hình.
4. Chuẩn hóa contract cho message, task, evidence, result, permission và signature.
5. Chọn một SIEM adapter thật để tích hợp trước.
6. Thay mock CLI sandbox bằng sandbox thực có policy bảo mật.
7. Viết E2E test có assertion, không chỉ in console.
8. Bổ sung timeout, retry, dead-letter queue, correlation ID, metrics và tracing.
9. Chỉ sau khi các bước trên ổn định mới mở rộng progressive autonomy và auto-remediation.

## 5. Khuyến nghị model

Với quy mô và độ nhạy cảm của dự án, nên dùng mô hình phân tầng:

| Tầng | Model đề xuất | Vai trò |
|---|---|---|
| Tier 1 | `gpt-5.6-luna` | Phân loại log, triage sơ bộ, tác vụ volume lớn |
| Tier 2 | `gpt-5.6-terra` | Điều tra thông thường, coding, test, refactor |
| Tier 3 | `gpt-6-astra` | Kiến trúc, security review, reasoning phức tạp, remediation quan trọng |

Nếu chỉ chọn một model cho vai trò chính của Codex trong dự án này, chọn **`gpt-6-astra`**. Nếu cần cân bằng chi phí trong công việc hằng ngày, dùng **`gpt-5.6-terra`** làm model mặc định và chuyển các nhiệm vụ rủi ro cao sang Astra.

Theo OpenAI Docs, GPT-6 Astra phù hợp công việc reasoning/coding phức tạp nhất; GPT-5.6 Terra cân bằng năng lực và chi phí; GPT-5.6 Luna phù hợp workload lớn và nhạy về chi phí: [OpenAI Models documentation](https://developers.openai.com/api/docs/models).

## 6. Đánh giá cuối

- Ý tưởng/kiến trúc: **8/10**
- Tổ chức repository: **6.5/10**
- Mức hoàn thiện implementation thực tế: **4/10**
- Mức sẵn sàng production: **2.5/10**
- Tiềm năng phát triển: **cao**

Định hướng nên tập trung hiện tại là chuyển từ “demo có tài liệu đầy đủ” sang “hệ thống có integration thật, security boundary thật và bằng chứng kiểm thử có thể lặp lại”.

## 7. Cập nhật triển khai 2026-09-16

- Đã chuẩn hóa model routing: Luna cho triage volume lớn, Terra cho engineering mặc định và Astra cho ca phức tạp/rủi ro cao.
- Đã chuyển router Standalone sang OpenAI API và để Terra là model mặc định qua `ASQ_ROUTER_MODEL`.
- Đã tách gRPC mock thành chế độ explicit `grpcMode: 'mock'`; production không còn âm thầm fallback sang mock khi gRPC lỗi khởi tạo.
- Đã sửa pipeline test: SDK (4), Auth (8), CLI (2), IDE model routing (3) và smoke test closed-loop hiện đều chạy xanh bằng `npm test`.
- Trạng thái chi tiết được quản lý tại `PROJECT_TRUTH.md`; build production của Next.js vẫn cần được kiểm tra trong môi trường sạch, không có tiến trình phát triển giữ lock lên output.
