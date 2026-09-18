# ASQ-ENGINE (GGS) — BẢN ĐẶC TẢ KIẾN TRÚC VÀ LỘ TRÌNH CHUẨN HÓA

> **Tài liệu chiến lược cốt lõi:** Định hình lại kiến trúc bản chất của GGS — Bộ Tứ tự hành (Quartet Closed-Loop) xoay quanh SIEM, loại bỏ mã giả (fake/mock) và biến SDK thành hệ tuần hoàn kết nối tự động hoá thực sự.

---

## 🏛️ 1. SƠ ĐỒ TỔNG QUAN HỆ THỐNG GGS

```
                         ┌──────────────────────────┐
                         │       STANDALONE         │
                         │    (Bộ não tổng thể)     │
                         │   Bao quát toàn bộ SIEM  │
                         └────────────┬─────────────┘
                                      │
                         ═════════════╪═════════════
                         ║          S D K          ║
                         ║       "Mạch máu"        ║
                         ║  Giao tiếp & Automation ║
                         ═════════════╤═════════════
                                      │
                        ┌─────────────┴─────────────┐
                        │                           │
                        ▼                           ▼
                 ┌─────────────┐             ┌─────────────┐
                 │   AI IDE    │             │     CLI     │
                 │             │             │             │
                 │  Chuyên gia │             │   Cánh tay  │
                 │    SIEM     │             │   thực thi  │
                 │  (Analysis/ │             │   Terminal  │
                 │ Correlation)│             │ (Scan/Fix)  │
                 └──────┬──────┘             └──────┬──────┘
                        │                           │
                        └─────────────┬─────────────┘
                                      ▼
                              ┌───────────────┐
                              │     SIEM      │
                              │ (Cơ thể sống  │
                              │ Chiến trường) │
                              └───────────────┘
```

> **Nguyên tắc cốt lõi:** **SIEM là trung tâm của toàn bộ hệ thống**, không phải chỉ là một data source phụ. SDK là hệ tuần hoàn kết nối 3 thành phần tự vận hành xoay quanh SIEM.

---

## 🎯 2. VAI TRÒ THỰC SỰ CỦA 4 THÀNH PHẦN

### 1. SIEM = Cơ thể / Chiến trường
Nơi chứa toàn bộ sự thật khách quan của môi trường tác chiến:
* Alerts & Triggers
* Raw Logs & Aggregated Events
* Network Flows & DNS Logs
* Threat Intelligence feeds
* Host Metrics & Telemetry
* Incident cases & Evidence store

> **Mọi hoạt động của GGS đều bắt đầu từ SIEM, diễn ra vì SIEM và quay trở về cập nhật SIEM.**

---

### 2. Standalone = Bộ não Tổng thể
Không phải là một worker chuyên làm một tác vụ vụn vặt. Standalone đứng ở vị trí tư lệnh nhìn toàn cảnh:
* *"SIEM đang có chuyện gì bất thường?"*
* *"Alert nào có độ ưu tiên cao cần xử lý ngay?"*
* *"Cần giao việc gì cho IDE để đào sâu?"*
* *"Cần CLI xuống máy chủ để xác minh điều gì?"*
* *"Kết quả từ CLI có làm đổi hướng điều tra không?"*
* *"Đã đủ chứng cứ kết luận True Positive hay False Positive chưa?"*
* *"Cần áp dụng chính sách gì: Auto-remediate, Rollback, hay xin duyệt CISO?"*

---

### 3. IDE Agent = Chuyên gia Phân tích SIEM (SOC Analyst AI)
Đảm nhận toàn bộ khối lượng công việc phân tích chuyên sâu mà analyst con người thường làm:
* **Alert Triage:** Phân loại cảnh báo, lọc nhiễu.
* **Threat Hunt & Query:** Truy vấn sâu vào SIEM log (Loki, Elasticsearch, Splunk).
* **Correlation:** Xâu chuỗi sự kiện theo timeline (thời gian, dải IP, user session).
* **Threat Intelligence Matching:** Đối soát mã CVE, danh sách IoC, kỹ thuật MITRE ATT&CK.
* **Detection Reasoning:** Phân tích bản chất kỹ thuật của cuộc tấn công.
* **Remediation Proposal:** Soạn thảo bản vá code diff hoặc luật phát hiện YARA-L/Sigma.

> **Ranh giới:** IDE làm tất cả công tác trí tuệ, **trừ** phần cần trực tiếp xuống terminal hệ điều hành để quét/can thiệp vật lý.

---

### 4. CLI Worker = Cánh tay Thực thi Terminal (Execution Arm)
Không cạnh tranh về reasoning với IDE. CLI là lực lượng thực địa chuyên trách:
* Port & Network scanning (`nmap`, network discovery).
* Path / Route / Firewall discovery.
* Host inspection (kiểm tra tiến trình đang chạy, socket kết nối, dịch vụ OS).
* Attack validation & Simulation trong sandbox cô lập.
* Terminal remediation & Patch execution (chặn IP firewall, restart service, apply git patch).

> **Ranh giới an toàn (Governance):** CLI **không tự do `exec()` tùy tiện**. Mọi hành động của CLI bắt buộc phải có **Task do Standalone giao + Token chữ ký số hợp lệ**.

---

## 🩸 3. BẢN CHẤT CỦA SDK: HỆ TUẦN HOÀN (COMMUNICATION & ORCHESTRATION SUBSTRATE)

SDK không phải là một Agent thứ 5. SDK là **mạch máu vận chuyển**:

$$\text{Event} \longleftrightarrow \text{Task} \longleftrightarrow \text{Result} \longleftrightarrow \text{Evidence} \longleftrightarrow \text{State} \longleftrightarrow \text{Permission} \longleftrightarrow \text{Audit}$$

### Cấu trúc Gói tin Mạch máu Chuẩn (`ASQMessage` Contract):
Mọi giao tiếp giữa 4 thành phần bắt buộc phải tuân theo cấu trúc thống nhất:

```typescript
interface ASQMessage<T = any> {
  message_id: string;          // UUID v4 định danh gói tin
  incident_id: string;         // Gắn chặt với mã sự cố SIEM
  source: 'SIEM' | 'STANDALONE' | 'IDE' | 'CLI';
  target: 'SIEM' | 'STANDALONE' | 'IDE' | 'CLI' | 'BROADCAST';
  type: 'EVENT' | 'TASK' | 'RESULT' | 'EVIDENCE' | 'COMMAND' | 'STATUS' | 'AUDIT';
  permission: string[];        // Danh sách quyền hợp lệ (RBAC)
  signature: string;           // Ký số mật mã HMAC-SHA256
  timestamp: number;
  payload: T;
}
```

---

## 🔄 4. CHU TRÌNH TÁC CHIẾN TỰ HÀNH KHÉP KÍN (CLOSED-LOOP SCENARIO)

Ví dụ thực tế khi xuất hiện cảnh báo tấn công vào dịch vụ Database:

```
               [SIEM]
      "ET SCAN Suspicious inbound to MSSQL 1433"
                 │
                 ▼ (SDK Event)
           [STANDALONE]
                 │ "Lệnh: Điều tra IOC + Lịch sử truy vấn"
                 ▼ (SDK Task)
             [AI IDE]
                 │
                 ├── Query SIEM logs tương quan
                 ├── Threat Intelligence IoC lookup
                 └── Phát hiện: Cần kiểm tra Host xem port 1433 có mở & process nào bind
                 │
                 ▼ (SDK Result / Request Host Check)
           [STANDALONE]
                 │ "Lệnh + Token EXECUTE_RECON: CLI kiểm tra host"
                 ▼ (SDK Task)
              [CLI]
                 │
                 ├── Kiểm tra Port 1433 & Active Sockets
                 ├── Kiểm tra Process ID liên quan đến MSSQL
                 └── Thu thập Evidence vật lý thực tế
                 │
                 ▼ (SDK Evidence)
           [STANDALONE]
                 │ "Bàn giao Host Evidence cho IDE"
                 ▼ (SDK Task)
             [AI IDE]
                 │
                 └── Tương quan dữ liệu Host + SIEM Log
                 │
                 ▼ (SDK Result: Verdict Analysis)
           [STANDALONE]
                 │
                 ├── Ra phán quyết: TRUE POSITIVE (Tấn công thật)
                 ├── Đánh giá Blast Radius & Autonomy Level
                 └── Giao CLI áp dụng Firewall Rule chặn IP / Mở Git PR
                 │
                 ▼ (SDK Command)
               [SIEM]
     (Cập nhật Incident: RESOLVED, Đóng Case, Lưu WORM Audit Log)
```

---

## 🚀 5. NĂM ƯU TIÊN HÀNH ĐỘNG CẤP BÁCH (ACTION ROADMAP)

| Thứ tự | Hạng mục | Mục tiêu cụ thể | Hành động kỹ thuật |
| :---: | :--- | :--- | :--- |
| **1** | **Chuẩn hóa SDK Mạch Máu** | Thống nhất giao thức Event, Task, Evidence, Result có `incident_id`, signature, RBAC. | Nâng cấp `packages/sdk`, xóa bỏ format JSON tự do, cung cấp client typed handlers cho 3 bên. |
| **2** | **Standalone Tự Vận Hành** | Biến Standalone thành State Machine: Receive $\rightarrow$ Plan $\rightarrow$ Delegate $\rightarrow$ Evaluate $\rightarrow$ Close. | Thay thế router `if/else` trong `llm-router.ts` bằng Orchestrator State Machine thực thụ. |
| **3** | **IDE Làm SIEM Thật** | Xóa bỏ `fakeEvidence` và `setTimeout` trong `engine.ts`. | Tích hợp query dataset SIEM thực tế, phân tích tương quan và trả về Evidence có cấu trúc. |
| **4** | **CLI Có Governance** | CLI chỉ chạy lệnh chuẩn chuyên môn (port scan, process inspection) khi có Token. | Chuẩn hóa các action trong `cli-worker`, kiểm soát bằng policy và cấp phép có chữ ký. |
| **5** | **Khép Kín Chu Trình (Closed-Loop)** | Hoàn thiện kịch bản mẫu từ Alert $\rightarrow$ Điều tra $\rightarrow$ Quét $\rightarrow$ Phán quyết $\rightarrow$ Cập nhật SIEM. | Viết test E2E thực thi đầy đủ 5 bước khép kín không phụ thuộc mock giả. |
