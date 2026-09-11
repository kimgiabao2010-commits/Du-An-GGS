# Báo cáo Nghiệm thu: Phase 0 (Foundation & Infrastructure)

**Ngày hoàn thành**: 2026-09-04
**Mục tiêu**: Thiết lập cấu trúc Monorepo, Docker hạ tầng, và bảo mật sơ khởi WORM.

## 1. Kết quả Bàn giao
- Khởi tạo **Turborepo** (`turbo.json`) tích hợp.
- Hạ tầng **Docker Compose** (`infra/docker-compose.yml`) gồm 4 dịch vụ: Postgres, Redis, NATS, Grafana.
- Kịch bản chặn ghi/xóa Audit **WORM Database** (`infra/postgres/init.sql`).
- Cấu hình CI/CD trên Github Actions (`.github/workflows/ci.yml`).

## 2. Các Bước QA Kiểm thử (Test Cases)

### Test case 1: Khởi động nền tảng
```bash
cd "d:\du an GGS\infra"
docker-compose up -d
```
✅ **Pass Condition**: 4 Container trạng thái `Up`. Grafana truy cập được tại `http://localhost:3000`.

### Test case 2: Build Cache (Turborepo)
```bash
cd "d:\du an GGS"
npm install
npx turbo run build
```
✅ **Pass Condition**: Terminal trả về build cactched/successfully.

### Test case 3: Zero-Trust Database WORM
Dùng DB Client (DBeaver) kết nối Postgres (`localhost:5432`, `asq_user`/`asq_password`, `asq_db`) và chạy lệnh xóa:
```sql
DELETE FROM audit_events;
```
✅ **Pass Condition**: Database cấm và báo lỗi trigger: `WORM Violation: Xóa dòng trên bảng audit_events bị cấm tuyệt đối.`
