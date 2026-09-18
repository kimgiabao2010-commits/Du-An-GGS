# ASQ local runbook — Codex

Chỉ dành cho máy phát triển được phép. Không mở cổng ra Internet. Dữ liệu trên dashboard có phần mô phỏng; hệ thống chưa hỗ trợ production login/deployment.

## Kiểm chứng

Tại thư mục root, trên Windows dùng `npm.cmd` nếu PowerShell chặn wrapper `npm.ps1`:

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
```

Trên Linux/macOS dùng `npm` tương ứng. `e2e` hiện là alias integration local; không bao gồm SIEM/cloud/deployment. Không chạy `simulation.js` hoặc JS sinh cũ bên cạnh TS để kết luận trạng thái hiện hành.

## Cấu hình thủ công

Tham khảo `.env.example`; không ghi đè `.env` hiện có. Điền secret ngẫu nhiên ≥32 ký tự, username và password local ≥16 ký tự. Model/API key chỉ cần khi dùng router thật. Không đưa secret vào Git, chat hay báo cáo. Root `.env` được launcher service nạp; UI cần được truyền cùng cấu hình như lệnh dưới.

Tạo token phiên worker (hiệu lực một giờ) bằng lệnh chủ động sau. Output là credential nhạy cảm; chỉ lưu cục bộ vào biến tương ứng trong `.env`, không paste vào ticket:

```powershell
node --env-file=.env --import tsx scripts/create-agent-token.ts cli
node --env-file=.env --import tsx scripts/create-agent-token.ts ide
```

Gán token CLI vào `ASQ_WORKER_TOKEN`, IDE vào `ASQ_IDE_TOKEN`. Đảm bảo cùng `ASQ_JWT_SECRET`. Token hết hạn phải tạo lại và khởi động lại worker; chưa có refresh tự động. Không cung cấp secret này cho host/worker không đáng tin cậy.

## Khởi động

Mỗi lệnh trong một terminal riêng ở root:

```powershell
npm.cmd run start:standalone
npm.cmd run start:worker
npm.cmd run start:ide
node --env-file=.env node_modules/next/dist/bin/next dev apps/standalone --hostname localhost
```

Mở `http://localhost:3000`, đăng nhập tại trang Chỉ huy. Chỉ sau khi đăng nhập mới mở/tải lại trang SIEM. Mặc định WebSocket bind `127.0.0.1:4000`, browser Origin cho phép `http://localhost:3000`. IDE sẽ trả BLOCKED khi chưa có adapter SIEM — đây là hành vi đúng, không phải evidence bị mất.

Yêu cầu thử an toàn là đọc hostname. Lệnh tự nhiên còn phụ thuộc router API chưa được xác minh live; executor chỉ nhận lệnh đúng allowlist. Không yêu cầu sửa máy, quét mạng hay tự động triển khai trong phiên local này.

Kill-switch chặn task mới trong process và gửi yêu cầu dừng worker. UI xác nhận backend HALTED, không xác nhận tất cả máy/worker đã cách ly. Muốn chạy lại sau halt cần người vận hành kiểm tra tác vụ đang chạy, rồi chủ động restart các process local cần thiết. Halt/replay chưa được lưu bền qua restart.

## Khi gặp lỗi

- 401/403 WebSocket: kiểm tra token, hạn dùng, Origin và login; không tắt xác thực.
- 503 login khi `NODE_ENV=production`: đúng thiết kế, cần IdP production; không bypass để deploy.
- 503 Grafana: adapter chưa có, không phải telemetry rỗng đã xác minh.
- OFFLINE: worker chưa kết nối đúng agent/token. TIMEOUT: chưa nhận evidence đúng task/incident.
- LLM_UNAVAILABLE: chưa dispatch task; kiểm tra cấu hình provider riêng, không coi câu trả lời dự phòng là kết quả thật.
- Build đọc nhầm JS cũ: dùng script/config hiện hành, không chạy `tsc` root với emit trở lại.

Các lệnh khởi động đầy đủ với credential thật là hướng dẫn vận hành, chưa được chạy trong đợt review. Bằng chứng tự động đã chạy nằm trong PROJECT_TRUTH.md.
