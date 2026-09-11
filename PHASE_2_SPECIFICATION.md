# ĐẶC TẢ KỸ THUẬT & HƯỚNG DẪN TRIỂN KHAI: GIAI ĐOẠN 2
**Mã phân hệ:** `GUARDRAILS-ENGINE` | **Dự án:** `ASQ-Engine (Quartet V4)`  
**Thư mục trọng tâm:** `d:\du an GGS\packages\guardrails`  
**Đơn vị giám sát:** Antigravity Architecture Supervisor

---

## 🎯 1. MỤC TIÊU CỐT LÕI CỦA GIAI ĐOẠN 2

Giai đoạn 2 chịu trách nhiệm xây dựng **"Lá chắn An toàn & Bộ điều tiết FinOps"** cho toàn bộ nền tảng. Đây là tầng bảo vệ Zero-Trust bắt buộc phải có để:
1. **Triệt tiêu nguy cơ Indirect Prompt Injection:** Đảm bảo dữ liệu log từ SIEM không thể "bẻ lái" hoặc chiếm quyền điều khiển LLM.
2. **Kiểm soát chi phí & Chống nghẽn tài nguyên (FinOps):** Khống chế tốc độ gọi API và tự động hạ tầng mô hình khi xảy ra bão cảnh báo (Alert Storm).
3. **Phản biện bản vá độc lập (Dual-LLM Red-Team):** Đóng vai trò Pentester nội bộ soi xét các rủi ro bảo mật tiềm ẩn trong code vá trước khi thử nghiệm.
4. **Bảo vệ môi trường Production (Canary & Rollback):** Đảm bảo không bao giờ xảy ra sự cố sập hệ thống nhờ cơ chế thu hồi bản vá trong 0 giây.

---

## 🗂️ 2. CẤU TRÚC THƯ MỤC CHI TIẾT (`packages/guardrails`)

```
d:\du an GGS/packages/guardrails/
├── package.json                          # Cấu hình package @asq/guardrails
└── src/
    ├── sanitizer/
    │   └── log-sanitizer.ts              # [Module 1] Bộ khử độc & Phân lập Boundary Token
    ├── finops/
    │   └── token-bucket.ts               # [Module 2] Quản lý hạn ngạch RPM/TPM & Auto-Fallback
    ├── adversarial/
    │   └── red-team-verifier.ts          # [Module 3] Dual-LLM Red-Team thẩm định đối kháng
    ├── canary/
    │   └── rollback-guard.ts             # [Module 4] Giám sát Canary & Rollback 0 giây
    └── index.ts                          # Cổng xuất khẩu API tập trung
```

---

## ⚙️ 3. CHI TIẾT 4 MODULE CỐT LÕI

### 🛡️ Module 1: Log Sanitizer & Prompt Boundary Isolation
* **File:** `src/sanitizer/log-sanitizer.ts`
* **Nhiệm vụ:**
  * Quét và phát hiện các mẫu lệnh tiêm độc hại (Jailbreak / Override patterns) như: `ignore previous instructions`, `system override`, `developer mode`, `delete files`, v.v.
  * Loại bỏ các ký tự điều khiển nguy hiểm (Control characters).
  * Đóng gói dữ liệu thô vào khối dữ liệu cách ly với thẻ phân tách mật mã hóa ngẫu nhiên (`<!-- SECURITY BOUNDARY START [ID: nonce] -->`).

### 💰 Module 2: FinOps 2-Layer Quota & Fallback Controller
* **File:** `src/finops/token-bucket.ts`
* **Nhiệm vụ:**
  * **Lớp 1 (Tốc độ tức thời - RPM/TPM):** Áp dụng thuật toán **Token Bucket** để kiểm soát số lượng request trên phút, tránh quá tải khi bị DoS cảnh báo.
  * **Lớp 2 (Ngân sách dài hạn - 5 Hours Budget Cap):** Khống chế tổng lượng token tiêu thụ trong chu kỳ 5 giờ.
  * **Cơ chế Fallback thông minh:** Khi chạm ngưỡng ngân sách hoặc rate limit, tự động chuyển bậc mô hình từ **Gemini Pro $\rightarrow$ Gemini Flash $\rightarrow$ Gemini Flash-Lite** để duy trì tính liên tục của dịch vụ.

### 🕵️ Module 3: Dual-LLM Adversarial Red-Team Verifier
* **File:** `src/adversarial/red-team-verifier.ts`
* **Nhiệm vụ:**
  * Phân tích độc lập bản vá (Code Diff / IaC Patch) trước khi đưa vào Sandbox.
  * Kiểm tra 4 lỗi chí mạng:
    1. Cấu hình mở toàn bộ IP (`0.0.0.0/0` không có Deny rule).
    2. Vô hiệu hóa xác thực / bypass security check (`skip_verification`, `bypass_auth`).
    3. Lộ lọt mã bí mật (Hardcoded API keys / passwords).
    4. Sử dụng hàm thực thi nguy hiểm (`eval()`, `exec()`, `sudo`).
  * Trả về điểm tin cậy (**Confidence Score**) và thông báo lý do nếu từ chối bản vá.

### 🚦 Module 4: Canary Deployment & 0-Second Rollback Guard
* **File:** `src/canary/rollback-guard.ts`
* **Nhiệm vụ:**
  * Điều phối tiến trình cập nhật Production theo tỷ lệ an toàn: **5% $\rightarrow$ 25% $\rightarrow$ 100%**.
  * Liên tục đối soát các chỉ số APM (Tỷ lệ lỗi HTTP 5xx, Độ trễ trung bình).
  * **Zero-Second Automated Rollback:** Nếu tỷ lệ lỗi vượt ngưỡng cho phép ($>2\%$), hệ thống ngay lập tức phát tín hiệu thu hồi bản vá về phiên bản ổn định trước đó.

---

## 📋 4. TIÊU CHÍ NGHIỆM THU GIAI ĐOẠN 2 (ACCEPTANCE CRITERIA)

| Tiêu chí kiểm toán | Điều kiện đạt chuẩn | Trạng thái |
| :--- | :--- | :---: |
| **1. Kháng Prompt Injection** | 100% chuỗi log độc hại bị phát hiện và đóng gói trong Boundary Nonce. | 🟢 Sẵn sàng |
| **2. Điều tiết FinOps** | Cơ chế Token Bucket tự động hạ cấp mô hình khi vượt ngưỡng RPM/TPM. | 🟢 Sẵn sàng |
| **3. Khả năng Red-Teaming** | Chặn đứng các bản vá cố tình chèn backdoor hoặc mở port `0.0.0.0/0`. | 🟢 Sẵn sàng |
| **4. Cơ chế Rollback an toàn** | Kích hoạt Rollback tức thì khi tỷ lệ lỗi vượt ngưỡng 2%. | 🟢 Sẵn sàng |

---

## 🔗 5. HƯỚNG DẪN KẾT NỐI TÍCH HỢP

Tất cả các dịch vụ khác chỉ cần import đơn giản từ `@asq/guardrails`:
```typescript
import { 
  LogSanitizer, 
  FinOpsGuardrail, 
  AdversarialRedTeamVerifier, 
  CanaryRollbackGuard 
} from '@asq/guardrails';
```

> **Bước chuyển tiếp tiếp theo:** Sau khi Giai đoạn 2 được vận hành hoàn chỉnh, hệ thống sẽ kết nối trực tiếp với **Giai đoạn 3 (`services/cli-worker`)** để điều khiển Docker Sandbox tạm thời và công cụ quét mạng nội bộ.
