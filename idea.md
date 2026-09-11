# Ý tưởng UI/UX cho Hệ thống ASQ-Engine (Autonomous SecOps Platform)

## 1. Tổng quan
Hệ thống lõi **ASQ-Engine** (bao gồm Core SDK và Guardrails) được định hướng tích hợp chặt chẽ với **Grafana** (cho phần trực quan hóa log/metric) và các giao diện người dùng chuyên biệt để quản trị an ninh tự động. Ứng dụng được hỗ trợ ba giao diện tương tác chính:
- **Standalone Command Center** – Web Dashboard độc lập đóng vai trò trung tâm điều khiển (Central Command).
- **IDE (VSCode Extension)** – Môi trường phát triển trực tiếp trên mã nguồn, cấp quyền phân tích AST và định tuyến vá lỗi (Patch Routing).
- **CLI Workspace** – Giao diện dòng lệnh tương tác mạnh mẽ cho giả lập Sandbox và tự động hóa.

Ba giao diện này **tự động đồng bộ** với nhau thông qua **ASQ SDK** nội bộ (Phase 1), đảm bảo mọi thay đổi (cấu hình, rule, mức độ tự trị, dashboard) luôn đồng nhất và tuân thủ Zero-Trust.

## 2. Kiến trúc tổng thể
```text
+------------------------+      +-------------------+      +-------------------+
|  Standalone Dashboard  | <--> |   ASQ SDK Core    | <--> |   Grafana Server  |
| (Next.js / React)      |      +-------------------+      +-------------------+
+------------------------+              ^      ^                     ^
        ^  ^                            |      |                     |
        |  |                            |      +-- IDE (VSCode Ext)|
        |  +-- CLI (Interactive/Ink)    |                            |
        |                               |                            |
        +--- REST/WS API/gRPC ----------+----------------------------+
```

- **ASQ SDK Core**: Lớp trung gian chịu trách nhiệm đồng bộ trạng thái, cấu hình, xử lý Blast Radius và mức độ Autonomy.
- **REST/WS API & gRPC**: Giao thức giao tiếp. HTTP/WebSocket cho các báo động thời gian thực (Alerts), và gRPC cho payload lớn (Patching AST source code).
- **Grafana**: dùng làm front‑end visualisation cho Logs và Metrics; các panel này có thể được nhúng (iframe) trực tiếp vào bên trong Standalone.

## 3. Các thành phần và Đề xuất triển khai

### 3.1 Standalone Central Command (Phase 5)
- **Công nghệ**: Web Application (Khuyến nghị: Next.js/React bao bọc bên ngoài) kết hợp tích hợp nhúng Grafana API.
- **Tính năng độc quyền ASQ**:
  - **Nút "KILL-SWITCH" khẩn cấp**: Nổi bật dạng DEFCON, một click để ngắt lập tức mọi sandbox worker/agent đang chạy.
  - **Thanh trượt Autonomy Level (L0-L4)**: Cho phép SecOps dễ dàng tăng giảm mức độ tự động hóa của hệ thống.
  - Trình quản lý service (start/stop, health-check) và giám sát **Blast Radius** (Phạm vi ảnh hưởng) của mã độc.

### 3.2 IDE Reasoning (Phase 4)
- **Công nghệ**: Thay vì tự xây dựng Custom Web IDE, đóng gói thành một **VSCode Extension** chính thức.
- **Tính năng đặc trưng**:
  - CodeLens / Quick Fixes: Nhận diện mã độc ngay trên Editor (VD: *ASQ-Engine: Phát hiện Vulnerability -> [Click: Tự động vá]*).
  - Tích hợp Live Terminal đã có sẵn của VSCode để test rule/playbook.
  - **Lint & Security**: Phân tích AST thời gian thực, nhắc nhở bảo mật inline ngay khi User đang gõ code.

### 3.3 CLI Worker / Workspace (Phase 3)
- **Công nghệ**: Xây dựng dạng Interactive CLI (sử dụng thư viện `Commander` hoặc `Ink` (React for Terminal) để form nhập liệu/chọn menu có UI đẹp ngay trên terminal).
- **Lệnh chính (chuyển sang thương hiệu `asq`)**:
  - `asq init`: Khởi tạo cấu hình bảo mật dự án.
  - `asq sandbox start --level 3`: Kích hoạt môi trường giả lập (ephemeral sandbox) để phân tích các file nguy hiểm.
  - `asq rule sync`: Đồng bộ các rule bảo mật (Sigma/YARA).
  - `asq kill --all`: Kích hoạt Kill-switch từ terminal để dừng khẩn hệ thống.

## 4. Giao thức Tự động đồng bộ (SDK Features)
| Chức năng | Mô tả | SDK Interaction |
|-----------|------|------------------|
| **Sync Rule** | Khi rule được sửa trong VSCode IDE, SDK gửi WebSocket/gRPC command để Standalone reload ngay lập tức. | `asq.rule.update(ruleId, payload)` |
| **Sync Dashboard** | CLI/IDE cấu hình metric, SDK tự động gọi API Grafana upsert dashboard. | `asq.grafana.dashboard.upsert(json)` |
| **Kill-Switch Event**| Ấn Kill-switch từ CLI/Standalone, toàn bộ kiến trúc sync để chặn mọi process worker. | `asq.security.triggerKillSwitch()` |
| **Event Stream** | Báo động, log event stream real-time push tới 3 môi trường giao diện. | `asq.events.subscribe(callback)` |
| **Auth & Context** | Token JWT/Zero-Trust cấp phát trong SDK, ủy quyền tự động đính kèm vào mọi node. | `asq.auth.setToken(token)` |

## 5. Chức năng công việc chính của ASQ UI
1. **Thu thập log**: Từ Syslog, Windows Event, Cloud Logs, APM Tracing đẩy vào backend lưu trữ.
2. **Phân tích (IDE & Core)**: Worker phân tích hành vi mã độc trong Sandbox, khớp Rule Sigma, Machine Learning anomaly detection.
3. **Cảnh báo (Standalone)**: Đánh giá Alert liên kết Blast Radius, trigger playbook hoặc chuyển qua hệ thống tự trị tự xử lý (khi ở L3/L4).
4. **Trực quan hoá (Grafana)**: Biển đồ lưu lượng mạng thời gian thực, heat-map bùng phát rủi ro, topology hạ tầng mạng.
5. **Vá lỗi tự động (IDE)**: Patch Routing (Phase 4) tự sinh mã sửa lỗi đưa qua IDE để DEV bấm *Approve*.
6. **Bảo mật**: Audit mọi thay đổi, quản lý cấp quyền RBAC.

## 6. Lợi ích Kiến trúc Giao diện Đồng bộ
- **Kiểm soát thông minh**: Phân tầng rõ ràng. Standalone làm "Trung tâm chỉ huy" bao quát, IDE/CLI làm "Công cụ thực thi / vận hành" ở tuyến đầu.
- **Trải nghiệm Zero-Trust**: SecOps luôn kiểm soát nút ngắt (Kill-Switch) và giám sát mọi lệnh qua SDK.

## 7. Kịch bản làm việc Khuyến nghị (Workflow Demos)
1. **Quy trình Phát hiện & Vá lỗi (Ở chế độ Autonomy L2)**
   - Hệ thống ngầm phát hiện bất thường -> Standalone hiển thị Cảnh báo Đỏ và vùng *Blast Radius*.
   - Dev mở VSCode, Extension *ASQ-Engine IDE* nháy highlight dòng code bị nhận dạng lỗi. Nhấp *Accept Patch* -> Code tự sửa.
   - SDK sync ngược về server dập Cảnh báo trên Live Dashboard.
2. **Phản ứng khẩn cấp (Incident Response)**
   - Agent báo cáo mã độc (Malware/Wiper) đang lan truyền nhanh trong network.
   - Quản trị viên (SecOps) đăng nhập Standalone Dashboard, ấn nút vật lý **KILL-SWITCH**. 
   - Lệnh được broadcast dạng Event Stream thông qua SDK -> Tức thời khóa mọi Ephemeral Sandbox worker, phong tỏa mạng và cắt quyền Write.
3. **Môi trường Test cho Chuyên gia (DevOps/SecOps)**
   - Chạy lệnh `asq sandbox start --target /malware-folder` trên CLI tương tác.
   - CLI giả lập cô lập thư mục đang chạy, report kết quả ngay trên Terminal với UI text (Ink format) màu sắc trực quan gọn lẹ mà không cần build Standalone UI rối rắm.

---

## 8. Điểm Cần Bổ Sung — Đề xuất Hướng đi

### 8.1 Autonomy Level Slider (L0–L4) — Cần UI & Logic chi tiết hơn

**Vấn đề**: Hiện tại Slider L0–L4 chỉ được mô tả là "thanh trượt" nhưng chưa có định nghĩa cụ thể từng cấp độ, ai được phép chỉnh, và hậu quả của mỗi mức là gì.

**Đề xuất hướng đi**:

| Level | Tên | Hành vi hệ thống | Ai được phép chỉnh |
|-------|-----|-----------------|---------------------|
| **L0** | Manual Only | Chỉ phân tích, không tự hành động, mọi việc do SecOps quyết định | Tất cả SecOps |
| **L1** | Assisted | Đề xuất patch/action, chờ SecOps approve từng bước | SecOps L2+ |
| **L2** | Semi-Auto | Tự vá lỗi thấp rủi ro, alert + chờ approve cho lỗi cao rủi ro | SecOps L3+ |
| **L3** | Auto-Response | Tự xử lý hầu hết, chỉ escalate khi Blast Radius vượt ngưỡng cấu hình | SecOps Lead |
| **L4** | Full Autonomous | Toàn quyền tự trị, tự vá, tự cô lập, tự report — Con người chỉ giám sát | CISO / Admin tối cao |

- **Yêu cầu xác nhận kép (Dual Approval)**: Khi chuyển từ L2 lên L3/L4, bắt buộc phải có **2 người** trong nhóm SecOps Lead xác nhận đồng thời (giống Two-Man Rule trong hạt nhân).
- **Thời hạn tự động (Auto-Expiry)**: Level L3/L4 chỉ được phép kích hoạt tối đa **N giờ** (cấu hình được), sau đó tự động hạ về L2 để tránh "quên tắt".
- **UI**: Slider có màu sắc cảnh báo theo cấp (xanh → vàng → cam → đỏ → đỏ đậm), tooltip giải thích hành vi từng level, badge hiển thị thời gian còn lại nếu đang ở L3/L4.

---

### 8.2 Grafana Nhúng — Giải pháp thay thế iframe

**Vấn đề**: Nhúng Grafana qua `<iframe>` sẽ gặp vấn đề `X-Frame-Options` và `Content-Security-Policy`, đặc biệt khi deploy trên HTTPS hoặc môi trường doanh nghiệp.

**Đề xuất hướng đi** (sắp xếp theo thứ tự ưu tiên):

- **Phương án A — Next.js BFF + `@grafana/ui`** ⭐ *(Ưu tiên cao nhất)*: Xây dựng giao diện bằng Next.js đóng vai trò lớp BFF (Backend For Frontend) — nắm toàn bộ Auth, MFA và logic nghiệp vụ. Dùng `@grafana/ui` component library kết hợp Grafana HTTP API để render panel trực tiếp trong React, không cần iframe.
  - *Ưu điểm*: Next.js làm chủ hoàn toàn Layout UI/UX. Tự do thiết kế animation cảnh báo, nút Kill-Switch DEFCON, và Autonomy Slider với trải nghiệm tùy biến cực cao — không bị giới hạn bởi khung của Grafana.
  - *Yêu cầu*: Cấu hình CORS chặt, Service Account Grafana quyền Read-only, token lưu server-side (không bao giờ expose ra client).
- **Phương án B — Grafana App Plugin** *(Phương án dự phòng — chỉ nếu team không có FE riêng)*: Xây dựng ASQ như 1 plugin chính thức của Grafana. SSO liền mạch nhưng bị gò bó trong bộ khung UI Grafana, rất khó tạo trải nghiệm Enterprise-grade cho Kill-Switch và Autonomy Control. **Không khuyến nghị** nếu có team Frontend.
- **Phương án C — Nginx Reverse Proxy + iframe** *(Giải pháp tạm thời / MVP nhanh)*: Đặt Nginx trước Grafana để inject header `X-Frame-Options: SAMEORIGIN`, đảm bảo cùng origin với Next.js. Phù hợp khi cần demo nhanh, **không dùng cho production lâu dài**.

---

### 8.3 Patch Routing — Bổ sung bước kiểm soát trước khi Apply

**Vấn đề**: Workflow hiện tại "Dev nhấp Accept Patch → Code tự sửa" thiếu bước kiểm tra trung gian, tiềm ẩn rủi ro apply sai patch hoặc patch phá vỡ logic nghiệp vụ.

**Đề xuất hướng đi — Luồng 4 bước**:
```
[1. Phát hiện lỗi AST]
        ↓
[2. Sinh Patch đề xuất]
        ↓
[3. Preview Diff + Dry-run] ← THÊM MỚI
    - Hiển thị diff rõ ràng (kiểu git diff, màu xanh/đỏ)
    - Nút "Run Dry-run": Thực thi patch trên bản sao sandbox ảo (ephemeral).
    - **Hiển thị các chỉ số phê duyệt (Metrics)**:
      1. Confidence: Độ phân giải tin cậy của AI patch (Ví dụ: 92%).
      2. Unit Test Status: Pass/Fail (xác nhận patch không phá vỡ logic của app).
      3. Security Scan: Có tạo rủi ro OWASP mới không?
      4. Blast Radius Resolution: Giảm được bao nhiêu % phạm vi tiếp xúc/lây lan?
        ↓
[4. Approve / Reject / Edit]
    - Approve: Apply vào codebase thực + Lưu sự kiện vào Audit Log.
    - Reject: Yêu cầu bắt buộc nhập lý do. Trạng thái Reject + Code Diff được đẩy trực tiếp về **Data Pipeline Feedback Loop** cho IDE Reasoning theo luồng sau:
      ```
      [Reject Event]
           ↓
      [Lưu vào Feedback Store]
        - Vector DB (VD: Qdrant / Weaviate): lưu embedding của (patch_diff, reject_reason)
        - Structured DB: lưu metadata (rule_id, patch_hash, user_id, timestamp, confidence_score)
           ↓
      [Self-Healing Memory Pipeline]
        - Batch job định kỳ (VD: mỗi 24h) aggregate các Reject events
        - Sinh ra fine-tuning dataset (JSONL format) từ cặp (bad_patch → reject_reason)
        - Trigger re-training / few-shot prompt update cho IDE Reasoning model
           ↓
      [Kết quả]: AI không lặp lại cùng loại patch lỗi ở lần sau
      ```
    - Edit: Mở diff editor để SecOps tự chỉnh sửa tay trước khi apply.
```
- **IDE**: Dùng VSCode's built-in `vscode.diff` API để render diff trong tab mới — không cần build UI riêng.
- **Audit**: Mọi quyết định Approve/Reject phải được ghi vào Audit Log kèm user ID, timestamp, và patch hash.

---

### 8.4 RBAC — Bảng phân quyền chi tiết

**Vấn đề**: Tài liệu hiện tại chỉ đề cập "quản lý cấp quyền RBAC" nhưng chưa định nghĩa các role và quyền hạn cụ thể, đặc biệt với các hành động nhạy cảm.

**Đề xuất — Bảng RBAC ASQ-Engine**:

| Hành động | Viewer | Analyst | SecOps | SecOps Lead | CISO/Admin |
|-----------|--------|---------|--------|-------------|------------|
| Xem Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Acknowledge Alert | ❌ | ✅ | ✅ | ✅ | ✅ |
| Chỉnh Autonomy L0→L2 | ❌ | ❌ | ✅ | ✅ | ✅ |
| Chỉnh Autonomy L3→L4 | ❌ | ❌ | ❌ | ✅ (Dual) | ✅ |
| Approve Patch | ❌ | ❌ | ✅ | ✅ | ✅ |
| Kích hoạt Kill-Switch | ❌ | ❌ | ✅ | ✅ | ✅ |
| Tạo / Xóa Rule | ❌ | ❌ | ✅ | ✅ | ✅ |
| Xem Audit Log | ❌ | ❌ | ✅ | ✅ | ✅ |
| Xóa Audit Log | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cấu hình RBAC | ❌ | ❌ | ❌ | ❌ | ✅ |

- **Nguyên tắc Log Bất biến (Zero-Trust Audit)**: Hàng "Xóa Audit Log" bị trạng thái ❌ cho **tất cả mọi người**, kể cả CISO (nhằm chặn đứng rủi ro Insider Threat). Audit log phải thiết kế theo chuẩn **WORM** (Write Once Read Many - Bổ sung liên tục, tuyệt đối thao tác không được sửa/xóa). Dọn dẹp log cũ là nhiệm vụ riêng của Data Retention Policy chạy ngầm.
- **Triển khai**: Lưu role trong JWT claim, SDK kiểm tra permission triệt để ở mỗi API call (Server-side validation) thay vì chỉ ẩn UI ở Client.
- **Principle of Least Privilege**: Mặc định mọi user đều là `Viewer`, cần được cấp quyền tường minh.

---

## 9. Rủi ro Tiềm ẩn — Đề xuất Hướng xử lý

### 9.1 🔴 Kill-Switch không có xác nhận — Nguy cơ kích hoạt nhầm

**Rủi ro**: `asq kill --all` từ CLI hoặc nút UI có thể bị nhấn/gõ nhầm trong môi trường production, gây gián đoạn toàn bộ hệ thống.

**Đề xuất**:
```bash
# Hiện tại (nguy hiểm):
$ asq kill --all
> Killing all workers... Done.

# Đề xuất — 3 lớp bảo vệ:
$ asq kill --all
> ⚠️  CẢNH BÁO: Lệnh này sẽ dừng TOÀN BỘ hệ thống ASQ trên môi trường [PRODUCTION].
> Gõ tên môi trường để xác nhận: PRODUCTION
> [User gõ: PRODUCTION]
> 🔐 Yêu cầu xác thực MFA (OTP): ______
> [User nhập OTP]
> ✅ Đã xác nhận. Kill-Switch đang được kích hoạt...
```
- **Lớp 1**: Yêu cầu gõ tên môi trường (`PRODUCTION` / `STAGING`).
- **Lớp 2**: Xác thực MFA (TOTP / Hardware Key).
- **Lớp 3**: Ghi log audit + gửi notification tức thì tới tất cả SecOps Lead qua email/Slack.
- **UI Standalone — Progressive Confirmation (thay vì countdown cứng)**:
  - **Click lần 1**: Nút chuyển sang trạng thái "Đang chờ xác nhận" kèm tooltip cảnh báo — chưa thực thi.
  - **Click lần 2** (trong vòng cửa sổ thời gian): Mở dialog xác nhận MFA.
  - **Countdown có thể cấu hình** (mặc định 15 giây, cấu hình được từ 5–60 giây tùy policy tổ chức): đếm ngược hiển thị rõ, người dùng có thể **Cancel** bất cứ lúc nào trước khi hết thời gian.
  - Sau khi countdown hết mà không Cancel: Kill-Switch mới được kích hoạt thực sự.

### 9.2 🟡 Grafana API Token lộ ra ngoài

**Rủi ro**: Nếu SDK nhúng Grafana API Token trực tiếp trong frontend JS bundle, token có thể bị lộ qua DevTools.

**Đề xuất**:
- **Không bao giờ** để Grafana API Token ở phía client/frontend.
- Tạo một **Backend-for-Frontend (BFF)** layer (Next.js API Routes hoặc Go microservice): mọi request tới Grafana đều đi qua BFF, BFF giữ token server-side.
- Cấp cho BFF một **Service Account Grafana** với quyền tối thiểu (chỉ đọc dashboard, không được tạo/xóa).
- Rotate token Grafana định kỳ 30 ngày, lưu trong Secret Manager (Vault / AWS Secrets Manager / GCP Secret Manager).

### 9.3 🟡 WebSocket không có rate-limiting — DDoS nội bộ

**Rủi ro**: Khi nhiều agent/worker gửi event stream đồng thời, WebSocket server có thể bị overload, làm chậm toàn bộ Dashboard và CLI realtime feed.

**Đề xuất**:
- Implement **backpressure**: Nếu queue WS > ngưỡng N message, hệ thống tạm dừng nhận thêm và gửi tín hiệu `SLOW_DOWN` về client.
- Dùng **message broker trung gian** (Redis Pub/Sub hoặc NATS) thay vì kết nối trực tiếp nhiều WS tới server.
- Rate-limit theo `client_id`: mỗi agent chỉ được gửi tối đa X event/giây.
- Giám sát WS connection count trên chính Grafana dashboard (ăn ngay metric của hệ thống vào chính nó).

### 9.4 🟡 Sandbox Escape — Worker thoát ra môi trường thực

**Rủi ro**: Khi phân tích mã độc trong ephemeral sandbox, nếu sandbox không đủ cô lập (chỉ là process isolation), mã độc có thể exploit để thoát ra host.

**Đề xuất**:
- **Cô lập theo tầng**:
  ```
  Tầng 1: Linux namespace (PID, Network, Mount namespace)
  Tầng 2: seccomp profile (chặn syscall nguy hiểm: fork bomb, raw socket...)
  Tầng 3: gVisor hoặc Firecracker microVM (kernel-level isolation)
  ```
- Sandbox worker **không có** network access ra ngoài internet; chỉ được giao tiếp qua một kênh IPC được kiểm soát với host.
- Tự động **kill & destroy** container sandbox sau khi phân tích xong (ephemeral, không lưu state).
- Thêm timeout cứng: nếu sandbox chạy quá T giây (VD: 60s), tự động force-kill.

*Tài liệu cập nhật: 2026-08-28 — Phiên bản 1.1*
*Mọi đề xuất trong Section 8 & 9 cần được review bởi SecOps Lead trước khi đưa vào implementation.*
