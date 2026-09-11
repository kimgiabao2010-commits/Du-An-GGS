# ASQ-Engine: Autonomous SecOps Platform
> **Mô hình tác chiến:** Quartet Closed-Loop Autonomous Security Operations (ASQ V4 Enterprise-Grade)

Hệ thống điều phối an ninh bảo mật tự hành 4 thành phần trụ cột (Standalone, IDE, CLI, SDK) tích hợp các chốt chặn Zero-Trust Guardrails, Log Sanitizer, Dual-LLM Red-Teaming, FinOps 2 Lớp và Progressive Autonomy.

---

## 📑 Tài liệu Chi tiết
- Xem bản đặc tả kiến trúc và kế hoạch triển khai đầy đủ tại: **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)**

## 🚀 Cấu trúc Hệ thống
- `packages/sdk`: Thư viện giao tiếp gRPC, định nghĩa UDM, chữ ký số mã hóa và Event Bus.
- `packages/guardrails`: Bộ lọc chống Prompt Injection, kiểm soát hạn ngạch FinOps Token Bucket, thẩm định đối kháng Red-Team và Canary Rollback.
- `services/standalone`: Ban chỉ huy vĩ mô, tiếp nhận cảnh báo SIEM và đánh giá Blast Radius.
- `services/ide-reasoning`: Động cơ AST, Model Tiering Router và tự động sinh bản vá Code Diff / YARA-L.
- `services/cli-worker`: Agent thực thi trong mạng nội bộ, quét mạng Nmap/Trivy/Semgrep và kiểm thử trong Docker Sandbox tạm thời.
- `tests/e2e`: Kịch bản kiểm thử tích hợp chu trình tự chữa lành 5 bước khép kín.
