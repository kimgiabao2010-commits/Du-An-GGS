# Hướng dẫn Đóng góp (Contributing Guide) - ASQ-Engine

## 1. Môi trường phát triển cục bộ (Local Dev)
- Yêu cầu cài đặt Node.js v22+ và Docker.
- Ở thư mục gốc (root), chạy lệnh: `npm install` để tự động link các workspace.
- Khởi động hạ tầng nền (Postgres, Redis, Grafana, NATS): `cd infra && docker-compose up -d`.
- Khởi chạy Turborepo build toàn bộ hệ sinh thái: `npx turbo run build`.

## 2. Tiêu chuẩn Branching
- `main`: Nhánh production/stable (không được phép push code thẳng vào nhánh này).
- `feature/TICKET-ID-short-desc`: Nhánh phát triển tính năng mới.
- `hotfix/TICKET-ID-short-desc`: Nhánh sửa lỗi khẩn cấp trên production.

## 3. Tiêu chuẩn Commit (Conventional Commits)
- `feat:` Thêm tính năng mới hoặc API mới.
- `fix:` Sửa lỗi (bug fix).
- `docs:` Cập nhật tài liệu thiết kế hệ thống / README.
- `chore:` Tác vụ linh tinh (cấu hình CI, script build, versioning).
- *Ví dụ commit minh họa: `feat: Thêm chức năng Kill-Switch cho Standalone UI (ASQ-101)`*

## 4. Quy trình Merge (Pull Request - Code Review)
- Mọi thay đổi đều phải thông qua Pull Request (PR).
- **Mandatory (Bắt buộc)**: CI pipeline (GitHub Actions) báo xanh (Lint, Test, Build thành công).
- **Mandatory (Bắt buộc)**: Phải có ít nhất 1 Review Approve từ thành viên SecOps Lead hoặc Maintainer.
- Nguyên tắc Zero-Trust: Mọi thay đổi về Role/RBAC hoặc Token Logic cần 2 Approve.
