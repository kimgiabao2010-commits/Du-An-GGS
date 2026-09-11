# ASQ-Engine — Build Roadmap (Phase-by-Phase)

> **Nguyên tắc xây dựng**: Mỗi phase phải **chạy được độc lập** và **có thể test được** trước khi sang phase tiếp theo.
> Không bắt đầu phase mới khi phase hiện tại chưa vượt qua **Definition of Done (DoD)**.

---

## Tổng quan các Phase

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
  Nền       SDK      Auth &    CLI        IDE        Standalone  Production
  móng      Core     Security  Workspace  Reasoning  Dashboard   Hardening
```

| Phase | Tên | Thời gian ước tính | Output chính |
|-------|-----|--------------------|--------------|
| 0 | Foundation & Infrastructure | 1–2 tuần | Repo, CI/CD, Docker, Grafana |
| 1 | ASQ SDK Core | 2–3 tuần | SDK library publish được |
| 2 | Auth & Security Layer | 1–2 tuần | JWT, RBAC, MFA hoạt động |
| 3 | CLI Workspace | 2–3 tuần | `asq` CLI chạy được |
| 4 | IDE Reasoning (VSCode Ext) | 3–4 tuần | Extension publish được |
| 5 | Standalone Dashboard | 3–4 tuần | Next.js app chạy được |
| 6 | Production Hardening | 2–3 tuần | Sẵn sàng deploy thực tế |

---

## Phase 0 — Foundation & Infrastructure
> **Mục tiêu**: Dựng nền móng kỹ thuật. Không có nền này, mọi thứ sau sẽ không nhất quán.

### Việc cần làm
- [ ] Khởi tạo **monorepo** (khuyến nghị: Turborepo hoặc Nx) với cấu trúc:
  ```
  asq-engine/
  ├── packages/
  │   ├── sdk/          ← Phase 1
  │   ├── cli/          ← Phase 3
  │   └── ide-ext/      ← Phase 4
  ├── apps/
  │   └── dashboard/    ← Phase 5
  ├── infra/
  │   ├── docker-compose.yml
  │   └── grafana/
  └── docs/
  ```
- [ ] Cài đặt **Docker Compose** cho local dev:
  - Grafana (port 3000)
  - PostgreSQL (lưu config, RBAC, Audit Log)
  - Redis (message broker cho WebSocket)
  - NATS (event streaming)
- [ ] Cài đặt **Grafana** với:
  - Datasource mặc định (PostgreSQL / ClickHouse)
  - Service Account Read-only cho BFF
  - Cấu hình `allow_embedding = true` (tạm thời cho dev)
- [ ] Thiết lập **CI/CD pipeline** (GitHub Actions / GitLab CI):
  - Lint → Test → Build → Docker build
  - Chặn merge nếu test fail
- [ ] Thiết lập **cấu trúc Audit Log** (WORM):
  - Bảng `audit_events` trong PostgreSQL với INSERT ONLY trigger
  - Không có UPDATE / DELETE permission trên bảng này
- [ ] Viết `CONTRIBUTING.md` và coding convention

### Definition of Done ✅
- [ ] `docker compose up` khởi động toàn bộ infra thành công
- [ ] Grafana truy cập được tại `localhost:3000`
- [ ] CI pipeline chạy xanh trên một commit mẫu
- [ ] Bảng `audit_events` không thể UPDATE/DELETE dù là admin DB

---

## Phase 1 — ASQ SDK Core
> **Mục tiêu**: Xây lớp trung gian — trái tim của toàn bộ hệ thống. SDK phải hoạt động ổn định trước khi CLI/IDE/Dashboard dùng nó.

### Việc cần làm
- [ ] Khởi tạo package `@asq/sdk` (TypeScript)
- [ ] Implement **WebSocket client** với auto-reconnect:
  - `asq.events.subscribe(callback)` — nhận event stream
  - `asq.events.publish(event)` — gửi event
- [ ] Implement **gRPC client** cho payload lớn (AST patch):
  - `asq.patch.submit(patchPayload)` — gửi patch lên server
- [ ] Implement **Rule sync**:
  - `asq.rule.update(ruleId, payload)` — cập nhật rule
  - `asq.rule.list()` — lấy danh sách rule
- [ ] Implement **Grafana dashboard sync**:
  - `asq.grafana.dashboard.upsert(json)` — tạo/cập nhật dashboard
  - `asq.grafana.dashboard.get(uid)` — lấy dashboard
- [ ] Implement **Kill-Switch event**:
  - `asq.security.triggerKillSwitch(env, otpToken)` — kích hoạt
  - `asq.security.onKillSwitch(callback)` — lắng nghe
- [ ] Implement **Autonomy Level**:
  - `asq.autonomy.setLevel(level, approvals[])` — chỉnh level
  - `asq.autonomy.getLevel()` — lấy level hiện tại
  - `asq.autonomy.onLevelChange(callback)` — lắng nghe thay đổi
- [ ] Implement **Blast Radius tracker**:
  - `asq.blast.getRadius(incidentId)` — lấy phạm vi ảnh hưởng
- [ ] Viết **unit test** đầy đủ cho mọi method
- [ ] Publish lên internal npm registry (hoặc GitHub Packages)

### Definition of Done ✅
- [ ] Tất cả unit test xanh (`npm test`)
- [ ] SDK publish được và import được từ package khác
- [ ] Demo script: subscribe event → nhận event → log ra console thành công
- [ ] Kill-Switch event broadcast tới 2 subscriber khác nhau thành công

---

## Phase 2 — Auth & Security Layer
> **Mục tiêu**: Bảo vệ toàn bộ hệ thống trước khi mở bất kỳ giao diện nào ra ngoài.

### Việc cần làm
- [ ] Xây **Auth Service** (Keycloak / Auth0 / tự build với `jose`):
  - Đăng nhập → cấp JWT với claims: `{ userId, role, env }`
  - Refresh token, Logout / revoke token
- [ ] Tích hợp **MFA (TOTP)**:
  - Setup MFA khi tạo account
  - Bắt buộc MFA với: Kill-Switch, Autonomy L3/L4, Approve Patch
  - Thư viện: `otpauth` hoặc `speakeasy`
- [ ] Implement **RBAC middleware** phía server:
  - Kiểm tra role trong JWT claim trước mỗi API call
  - Trả về `403 Forbidden` nếu không đủ quyền (không chỉ ẩn UI)
  - Áp dụng bảng RBAC đã định nghĩa trong `idea.md §8.4`
- [ ] Implement **Dual Approval** cho Autonomy L3/L4:
  - Tạo `approval_request` record, chờ 2 user khác nhau confirm
  - Timeout: sau 15 phút không đủ 2 approval → tự hủy request
- [ ] Tích hợp **Secret Manager** cho Grafana token:
  - HashiCorp Vault (self-hosted) hoặc cloud Secret Manager
  - Không lưu token trong `.env` file trên production
- [ ] Viết integration test cho toàn bộ RBAC matrix

### Definition of Done ✅
- [ ] Mọi API endpoint đều trả `401` nếu không có token hợp lệ
- [ ] Mọi API endpoint đều trả `403` nếu role không đủ quyền
- [ ] MFA flow test thành công end-to-end
- [ ] Dual Approval: 1 người approve → chưa được, 2 người → thành công
- [ ] Grafana token không xuất hiện trong bất kỳ response body nào về client

---

## Phase 3 — CLI Workspace
> **Mục tiêu**: Công cụ đầu tiên dùng được. SecOps/DevOps thao tác toàn hệ thống qua terminal.

### Việc cần làm
- [ ] Khởi tạo package `@asq/cli` dùng **Ink** (React for Terminal)
- [ ] Implement các lệnh cốt lõi:
  - `asq init` — khởi tạo config cho project
  - `asq login` — đăng nhập, lưu token local
  - `asq status` — xem trạng thái hệ thống
  - `asq rule list` / `asq rule sync` — quản lý rule bảo mật
  - `asq alert list` / `asq alert ack <id>` — quản lý alert
  - `asq sandbox start --target <path>` / `asq sandbox stop <id>`
  - `asq autonomy get` / `asq autonomy set <level>` (có MFA)
  - `asq kill --all` — kill-switch (có 3 lớp xác nhận)
  - `asq dashboard export` — export Grafana dashboard JSON
- [ ] Implement **3 lớp xác nhận cho `asq kill`**:
  - Lớp 1: gõ tên môi trường (PRODUCTION / STAGING)
  - Lớp 2: MFA OTP
  - Lớp 3: broadcast event qua SDK + ghi audit log
- [ ] Implement **Interactive menu** bằng Ink cho lệnh phức tạp
- [ ] Implement **Autocomplete** cho bash/zsh/fish: `asq completion bash >> ~/.bashrc`
- [ ] Output màu sắc rõ ràng: 🟢 OK, 🔴 CRITICAL, 🟡 WARNING, 🔵 INFO
- [ ] Viết **e2e test** cho các lệnh chính (mock server)

### Definition of Done ✅
- [ ] `asq --help` hiển thị đầy đủ lệnh
- [ ] `asq login` → `asq status` → `asq alert list` chạy thành công end-to-end
- [ ] `asq kill --all` có đủ 3 lớp xác nhận, không thể bỏ qua
- [ ] Kill-Switch từ CLI → SDK broadcast → subscriber nhận được event
- [ ] E2e test xanh

---

## Phase 4 — IDE Reasoning (VSCode Extension)
> **Mục tiêu**: Đưa ASQ vào ngay môi trường làm việc của Developer — không cần mở tool riêng.

### Việc cần làm
- [ ] Khởi tạo VSCode Extension project (`@asq/ide-ext`) dùng `yo code`
- [ ] Implement **CodeLens** trên từng dòng bị phát hiện:
  `⚠ ASQ: SQL Injection risk detected → [View Details] [Auto-Fix]`
- [ ] Implement **Diagnostic / Problem panel**: hiển thị lỗi bảo mật trong tab "Problems"
- [ ] Implement **Patch Routing workflow** — luồng 4 bước:
  - Bước 3: Mở `vscode.diff` tab với 4 metrics: Confidence, Unit Test, Security Scan, Blast Radius Resolution
  - Nút Approve / Reject / Edit trong WebView panel
- [ ] Implement **Feedback Loop khi Reject**:
  - Dialog bắt buộc nhập lý do
  - Gửi `(patch_diff, reject_reason, metadata)` về Feedback Store (Vector DB) qua SDK
- [ ] Implement **Live Alert badge** trên Status Bar:
  `🔴 3 Alerts | Autonomy: L2` — click mở WebView danh sách alert
- [ ] Implement **AST real-time lint** chạy ngầm khi save file
- [ ] Implement **Command Palette**: ASQ: Show Alerts, Sync Rules, Set Autonomy Level, Show Audit Log
- [ ] Viết test cho Extension (dùng `@vscode/test-electron`)

### Definition of Done ✅
- [ ] Extension cài được từ VSIX file
- [ ] CodeLens xuất hiện trên file có lỗi bảo mật mẫu
- [ ] Approve Patch: diff hiện → metrics hiện → Approve → file cập nhật
- [ ] Reject: lý do được gửi về Feedback Store thành công
- [ ] Status bar badge cập nhật real-time khi có alert mới
- [ ] MFA bắt buộc khi thực hiện hành động nhạy cảm từ Extension

---

## Phase 5 — Standalone Dashboard (Central Command)
> **Mục tiêu**: Trung tâm chỉ huy — bức tranh toàn cảnh cho SecOps Lead và CISO.

### Việc cần làm
- [ ] Khởi tạo **Next.js app** (`apps/dashboard`) với TypeScript + Tailwind CSS
- [ ] Implement **BFF layer** (Next.js API Routes):
  - Proxy tất cả Grafana API call qua server-side
  - Grafana token chỉ tồn tại server-side, không bao giờ về client
- [ ] Implement **Authentication UI**: Login page (email + password + MFA), session management
- [ ] Implement **Layout chính**: Header + Sidebar + Main content
- [ ] Implement **Kill-Switch button** — Progressive Confirmation:
  - Click 1: nút vàng + tooltip cảnh báo, chưa thực thi
  - Click 2: dialog MFA + countdown configurable (mặc định 15s, range 5–60s)
  - Nút Cancel trong suốt countdown
  - Sau xác nhận: broadcast qua SDK, UI cập nhật trạng thái
- [ ] Implement **Autonomy Level Slider**:
  - Màu: xanh(L0)→vàng(L1)→cam(L2)→đỏ(L3)→đỏ đậm(L4)
  - Dual Approval UI cho L3/L4: badge "Chờ approval thứ 2"
  - Auto-Expiry countdown badge
- [ ] Implement **Grafana panels** dùng `@grafana/ui`:
  - Log stream, Alert timeline, Blast Radius heat-map, Network topology, WS connection count
- [ ] Implement **Alert Management**: filter, acknowledge, assign, escalate, deep-link tới VSCode
- [ ] Implement **Audit Log viewer**: read-only table, filter, export CSV
- [ ] Implement **Service Health dashboard**: sandbox status, CPU/Memory/Ingest rate, Start/Stop
- [ ] Implement **RBAC Admin panel** (chỉ CISO): quản lý user, gán role, xem active session

### Definition of Done ✅
- [ ] Login → Dashboard hiển thị đầy đủ panels
- [ ] Kill-Switch: Progressive Confirmation hoạt động, không thể bỏ qua MFA
- [ ] Autonomy Slider: Dual Approval flow test thành công
- [ ] Grafana panels render data thực từ BFF (không dùng iframe)
- [ ] Grafana token không xuất hiện trong browser DevTools (Network tab)
- [ ] Audit Log: chỉ có INSERT, không có nút/action xóa ở UI lẫn API
- [ ] Responsive: hoạt động trên 1080p và 1440p

---

## Phase 6 — Production Hardening
> **Mục tiêu**: Sẵn sàng deploy thực tế. Bảo mật, hiệu năng, vận hành phải đạt chuẩn.

### Bảo mật
- [ ] Pentest nội bộ: thử khai thác RBAC bypass, token leak, XSS
- [ ] Cấu hình **Sandbox isolation 3 tầng**:
  - Tầng 1: Linux namespace (PID, Network, Mount)
  - Tầng 2: seccomp profile (chặn fork bomb, raw socket...)
  - Tầng 3: gVisor hoặc Firecracker microVM
  - Timeout cứng: auto force-kill sau N giây, không có outbound internet
- [ ] Cấu hình **Grafana production**: HTTPS only, HSTS, rate limiting trên API

### Hiệu năng & Reliability
- [ ] Implement **WebSocket backpressure + rate limiting**:
  - Redis Pub/Sub hoặc NATS làm broker trung gian
  - Rate limit: X event/giây/client
  - Tín hiệu `SLOW_DOWN` khi queue vượt ngưỡng
- [ ] Load test WS: mô phỏng N agent gửi đồng thời
- [ ] Cấu hình **Data Retention Policy**: archive log cũ → cold storage, KHÔNG xóa
- [ ] Cấu hình **Grafana token rotation**: cron job 30 ngày/lần

### Vận hành
- [ ] Viết **Runbook** cho: Kill-Switch được kích hoạt, Sandbox nghi escape, Alert storm
- [ ] Cấu hình **Meta-monitoring**: Grafana theo dõi chính ASQ (WS connections, API latency, error rate)
- [ ] Viết **Disaster Recovery plan**: backup config, rule, dashboard JSON
- [ ] Cấu hình **Self-Healing Memory Pipeline**:
  - Batch job 24h aggregate Reject events
  - Export JSONL fine-tuning dataset
  - Trigger re-training pipeline

### Definition of Done ✅
- [ ] Pentest: không tìm được lỗ hổng RBAC/token nào
- [ ] Load test: chịu được N concurrent agents không drop connection
- [ ] Sandbox escape test: mã độc mẫu không thoát được ra host
- [ ] Token rotation chạy thành công, hệ thống không downtime
- [ ] Runbook được review bởi SecOps Lead
- [ ] Meta-monitoring: alert khi ASQ latency > 500ms

---

## Nguyên tắc chung khi build

| Nguyên tắc | Chi tiết |
|------------|----------|
| **Core trước, UI sau** | SDK (P1) → Auth (P2) → CLI (P3) → IDE (P4) → Dashboard (P5) |
| **Test trước khi tiếp** | Mỗi phase phải pass DoD trước khi sang phase mới |
| **Security by design** | Auth/RBAC (P2) xây trước mọi giao diện người dùng |
| **Fail fast** | CI/CD chặn merge khi test fail, không để nợ kỹ thuật |
| **Least Privilege** | Mặc định mọi user là Viewer, cấp quyền tường minh |
| **WORM Audit** | Audit log không bao giờ được sửa/xóa ở bất kỳ layer nào |
| **No secret in code** | Không có token/secret nào trong source code hay `.env` committed |

---

*Roadmap Version: 1.0 — 2026-08-28*
*Review bởi team trước khi bắt đầu Phase 0.*
