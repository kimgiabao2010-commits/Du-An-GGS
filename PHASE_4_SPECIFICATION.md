# ĐẶC TẢ KỸ THUẬT & HƯỚNG DẪN TRIỂN KHAI: GIAI ĐOẠN 4
**Mã phân hệ:** `IDE-REASONING-ENGINE` | **Dự án:** `ASQ-Engine (Quartet V4)`  
**Thư mục trọng tâm:** `d:\du an GGS\services\ide-reasoning`  
**Đơn vị giám sát:** Antigravity Architecture Supervisor

---

## 🎯 1. MỤC TIÊU CỐT LÕI CỦA GIAI ĐOẠN 4

Giai đoạn 4 chịu trách nhiệm xây dựng **"Bộ não Phân tích Vi mô & Suy luận R&D (Semantic & AST Reasoning Engine)"**. Đây là trung tâm trí tuệ của toàn bộ nền tảng, đảm nhận các nhiệm vụ tối quan trọng:
1. **Phân tích Cây Cú pháp Trừu tượng (AST Reasoning):** Đi sâu vào cấu trúc mã nguồn ứng dụng và các tệp Hạ tầng dạng mã (**IaC: Terraform `.tf`, Kubernetes `.yaml`**) để định vị chính xác điểm lỗi nguyên nhân gốc rễ (Root Cause), vượt xa các phương pháp Regex thông thường.
2. **Định tuyến Mô hình Thông minh 3 Tầng (Model Tiering Matrix):** Tự động lựa chọn mô hình AI tối ưu nhất (`Flash-Lite` $\rightarrow$ `Flash` $\rightarrow$ `Pro/Reasoning`) theo mức độ nghiêm trọng và chính sách FinOps.
3. **Tự động Sinh Bản vá & Tập luật Phát hiện (Remediation Diff & YARA-L):** Sinh ra các bản vá chuẩn định dạng Git Diff và tập luật YARA-L để phát hiện/ngăn chặn sự cố tái diễn.
4. **Tích hợp Thẩm định Đối kháng (Dual-LLM Red-Team Loop):** Tự động đưa bản vá qua lớp kiểm định của `AdversarialRedTeamVerifier` trước khi chuyển giao cho CLI Sandbox.
5. **Giao tiếp Sự kiện Khép kín (Event-Driven Integration):** Lắng nghe dữ liệu trinh sát từ `cli-worker` qua `EventBus` và phát tín hiệu bản vá sẵn sàng cho chu trình kiểm thử.

---

## 🗂️ 2. CẤU TRÚC THƯ MỤC CHI TIẾT (`services/ide-reasoning`)

```
d:\du an GGS/services/ide-reasoning/
├── package.json                          # Cấu hình package @asq/ide-reasoning
└── src/
    ├── router/
    │   └── model-router.ts               # [Module 1] Bộ định tuyến mô hình 3 tầng (Model Tiering)
    ├── ast/
    │   └── ast-parser.ts                 # [Module 2] Động cơ phân tích cú pháp AST cho Source Code & IaC
    ├── remediation/
    │   └── patch-generator.ts            # [Module 3] Bộ sinh mã vá (Git Diff) & Luật phát hiện YARA-L
    └── engine.ts                         # [Module 4] IDE Reasoning Engine điều phối tổng thể
```

---

## ⚙️ 3. CHI TIẾT 4 MODULE CỐT LÕI

### 🧠 Module 1: Model Tiering Router
* **File:** `src/router/model-router.ts`
* **Nhiệm vụ:**
  * Ánh xạ mức độ nghiêm trọng của sự cố sang 3 tầng mô hình tác chiến:
    * **Tier 1 (Triage & Lọc ồn):** `Gemini Flash-Lite` / Small SLM $\rightarrow$ Phục vụ xử lý log dung lượng lớn, ping sweep, phân loại cảnh báo sơ bộ.
    * **Tier 2 (Điều tra & Phản ứng):** `Gemini Flash / Sec-Tuned` $\rightarrow$ Phục vụ tra cứu IoC/Mandiant Threat Intel, kích hoạt SOAR Playbook.
    * **Tier 3 (Đại án APT & Lỗ hổng IaC):** `Gemini Pro / Reasoning Model` $\rightarrow$ Phục vụ phân tích tấn công đa chặng, leo thang đặc quyền và sinh mã vá IaC/Source code phức tạp.
  * Tích hợp `FinOpsGuardrail` để tự động giáng cấp mô hình (Fallback) khi lưu lượng đạt ngưỡng trần token.

### 🌳 Module 2: AST Semantic & IaC Parser
* **File:** `src/ast/ast-parser.ts`
* **Nhiệm vụ:**
  * **Phân tích IaC (Terraform / Kubernetes):** Quét cây cú pháp của tệp cấu hình hạ tầng để phát hiện khối tài nguyên lỗi (như S3 bucket có `acl = "public-read"` hoặc Pod có `privileged: true`).
  * **Phân tích Mã nguồn Ứng dụng (App Source Code):** Xác định tên hàm, tham số đầu vào và dòng mã chứa lỗ hổng (như SQL Injection không dùng tham số ràng buộc, XSS).
  * Trích xuất vị trí chính xác của khối mã cần sửa đổi (`startLine`, `endLine`).

### 📝 Module 3: Patch & YARA-L Generator
* **File:** `src/remediation/patch-generator.ts`
* **Nhiệm vụ:**
  * **Sinh Git Code Diff chuẩn:** Tạo ra bản vá vi sai có thể nạp trực tiếp qua lệnh `git apply patch.diff`.
  * **Sinh Luật Phát hiện YARA-L:** Tự động tạo tập luật phát hiện mối đe dọa tương ứng để nạp ngược vào SIEM/Chronicle nhằm giám sát hành vi tái diễn.
  * Đóng gói toàn bộ vào hợp đồng dữ liệu chuẩn `RemediationProposal`.

### ⚡ Module 4: IDE Reasoning Master Engine
* **File:** `src/engine.ts`
* **Nhiệm vụ:**
  * Kết nối trực tiếp vào `EventBus` để lắng nghe sự kiện `worker:recon_completed` từ CLI Worker.
  * Kích hoạt chuỗi xử lý: `Model Routing` $\rightarrow$ `AST Parsing` $\rightarrow$ `Patch Generation`.
  * Gửi bản vá qua `AdversarialRedTeamVerifier` (từ `@asq/guardrails`) để kiểm định đối kháng 4 lỗi chí mạng.
  * Nếu Red-Team phê duyệt $\rightarrow$ Phát sự kiện `worker:patch_dispatch` kèm `EXECUTE_SANDBOX_BUILD` Token sang CLI Runner để tiến hành kiểm thử sandbox.

---

## 📋 4. TIÊU CHÍ NGHIỆM THU GIAI ĐOẠN 4 (ACCEPTANCE CRITERIA)

| Tiêu chí kiểm toán | Điều kiện đạt chuẩn | Trạng thái |
| :--- | :--- | :---: |
| **1. Định tuyến Mô hình 3 Tầng** | Tự động chọn đúng Model Tier theo mức độ nghiêm trọng và hỗ trợ FinOps Fallback. | 🟢 Sẵn sàng |
| **2. Phân tích Cú pháp AST** | Xác định đúng khối tài nguyên IaC và dòng mã nguồn lỗi nguyên nhân gốc rễ. | 🟢 Sẵn sàng |
| **3. Sinh Code Diff & YARA-L** | Bản vá chuẩn cú pháp Git Diff và quy tắc YARA-L hợp lệ. | 🟢 Sẵn sàng |
| **4. Red-Team Audit Tích hợp** | 100% bản vá phải vượt qua bộ lọc phản biện trước khi bàn giao cho Sandbox. | 🟢 Sẵn sàng |

---

## 🔗 5. SƠ ĐỒ CHU TRÌNH SUY LUẬN TẠI GIAI ĐOẠN 4

```mermaid
flowchart TD
    A[EventBus: 'worker:recon_completed'] --> B[ModelTieringRouter: Quyết định Tier 1/2/3]
    B --> C[AstSemanticParser: Soi cấu trúc AST & Định vị Root Cause]
    C --> D[PatchGenerator: Sinh Git Diff & YARA-L Rule]
    D --> E[AdversarialRedTeamVerifier: Thẩm định Đối kháng]
    E -->|❌ Audit Failed| F{Số lần thử lại < 3?}
    F -->|Còn lượt (retry <= 3)| D
    F -->|Hết lượt (retry > 3)| G[🛑 Infinite Loop Breaker: Escalate to Human]
    E -->|✅ Audit Passed| H[EventBus: 'worker:patch_dispatch' -> Bàn giao sang CLI Sandbox]
```

---

## 💡 6. ĐỀ XUẤT KỸ THUẬT TỪ HỆ THỐNG (IMPLEMENTATION PROPOSALS)

1. **Cơ chế Ngắt lặp Vô hạn (Infinite Loop Breaker) cho Red-Team:** Tại sơ đồ luồng thẩm định đối kháng, nếu AI liên tục sinh ra mã lỗi (LLM Hallucination) khiến Red-Team liên tục từ chối, hai bộ não này sẽ kẹt trong vòng lặp cãi nhau vô tận, gây sập EventBus và bào mòn ngân quỹ Token FinOps. **Giải pháp:** Cấy tham số `maxRetries = 3` vào Pipeline của `engine.ts`. Sau 3 nỗ lực vá lỗi thất bại, hệ thống tự động bẻ gãy vòng lặp và dội ngược sự kiện `EscalateToHuman`.
2. **Quy hoạch Dependencies Kép:** Phân hệ IDE Reasoning bắt buộc cấu hình `package.json` kết nối đồng thời với cả `@asq/sdk` (để dùng chuẩn Giao tiếp/Token) và `@asq/guardrails` (để gọi 2 dịch vụ RedTeamVerifier và FinOpsGuardrail tích hợp).
3. **Chế độ Giả lập (Mock) AST & LLM Generator:** Ở giai đoạn xây dựng khung (Scaffolding), `AstSemanticParser`, `ModelTieringRouter` và `PatchGenerator` tạm thời được cài đặt ở chế độ **Mock Data (trả về tĩnh)** nhằm kiểm thử trơn tru sự lưu thông của luồng Pipeline mà chưa cần tiêu tốn API Key LLM thật.

---

## 🛡️ 7. ĐÁNH GIÁ & PHẢN HỒI KIỂM TOÁN VỀ 3 ĐỀ XUẤT (ARCHITECTURAL AUDIT VERDICT)

Đơn vị Giám sát Kiến trúc đã tiến hành thẩm định chuyên sâu 3 đề xuất kỹ thuật đối với Bản thiết kế V4 và đưa ra kết luận chính thức:

### 🟢 Kết luận chung: **100% BÁM SÁT, CỦNG CỐ & BẢO VỆ ĐỊNH HƯỚNG GỐC**

| Đề xuất kỹ thuật | Phân tích của Giám sát viên | Mức độ khớp định hướng V4 |
| :--- | :--- | :---: |
| **1. Infinite Loop Breaker (`maxRetries = 3`)** | Áp dụng mô hình **Circuit Breaker Pattern**. Chống nguy cơ 2 AI rơi vào vòng lặp vô tận (Deadlock) gây cạn kiệt ngân sách Token và nghẽn EventBus. Tự động chuyển giao an toàn về Level 3 (Advisory/Human Escalation). | 🟢 **100% Khớp (Chốt chặn sống còn)** |
| **2. Dependencies Kép (`sdk` + `guardrails`)** | Đảm bảo tính toàn vẹn của mô hình Monorepo. Giúp bộ não IDE Reasoning thừa hưởng trực tiếp các chốt chặn an toàn (Red-Team Verifier) và cơ chế FinOps Quota Fallback. | 🟢 **100% Khớp (Chuẩn kiến trúc)** |
| **3. Safe Mock AST & LLM Generator** | Áp dụng mô hình **Adapter Pattern**. Đảm bảo quá trình kiểm thử toàn bộ chu trình 5 bước khép kín diễn ra nhanh chóng, mượt mà và an toàn trên môi trường dev mà không phụ thuộc API key ngoài. | 🟢 **100% Khớp (Tiết kiệm chi phí dev)** |

> **Khuyến nghị thực thi:** 3 đề xuất trên được chính thức **PHÊ DUYỆT** và là tiêu chuẩn kỹ thuật bắt buộc khi triển khai mã nguồn tại phân hệ `services/ide-reasoning`.
