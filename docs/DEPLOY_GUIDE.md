# Sổ tay Triển khai ASQ-Engine (Production Playbook)

Xin chúc mừng! Hệ thống ASQ-Engine V4 đã sẵn sàng để triển khai vào môi trường Doanh nghiệp (Enterprise). Vui lòng tuân thủ chặt chẽ sổ tay này.

## 1. Yêu cầu Hệ thống (Prerequisites)
- OS: Ubuntu 22.04 LTS / RHEL 9
- **Docker & Docker Compose v2+**: Chạy hạ tầng cốt lõi.
- **Node.js v22**: Đóng gói Frontend BFF.
- Trình quản lý Monorepo: `npm install -g turbo`

## 2. Trình tự Khởi động (Boot Sequence)

### Bước 2.1: Khởi động Layer Dữ liệu & WORM (Phase 0)
Hệ thống KHÔNG THỂ sống nếu thiếu lớp Database Zero-Trust.
```bash
cd infra/
docker-compose up -d
```
> ⚠️ **Zero-Trust Note**: Hãy đảm bảo user kết nối vào Postgres không có cấp quyền DROP DATABASE. Lớp bảo vệ `init.sql` WORM triggers đã tự động kích hoạt.

### Bước 2.2: Khởi động Web Dashboard BFF (Phase 5)
Standalone Hub đóng vai trò cầu nối. Cần compile và chạy production.
```bash
cd apps/standalone
npm install --legacy-peer-deps
npm run build
npm run start
```
Thao tác này sẽ khóa API sau Reverse Routing của Next.js (chặn đứng XSS token theft).

### Bước 2.3: Phân phối SDK & CLI (Phase 1, 2, 3)
Phát hành mã nguồn cục bộ (hoặc qua Private NPM) để máy SysAdmin cài đặt.
```bash
cd packages/cli
npm run build
npm link
```
Nhân viên SecOps từ nay sẽ thao tác cấu hình L0-L4 thông qua lệnh `asq status` hoặc `asq kill --all` trực tiếp trên Terminal của họ.

### Bước 2.4: Phân phối VSCode IDE Sandbox (Phase 4)
Build ứng dụng Extension dưới dạng tệp `.vsix`.
```bash
cd apps/ide-extension
npx @vscode/vsce package
```
Chuyển file `asq-ide-reasoning-4.0.0.vsix` cho đội Lập trình viên để cài thủ công vào Visual Studio Code. Kênh Review AST Patch giờ đã nối mạng trực tiếp!

## 3. Cấu hình WAF (Web Application Firewall) & Proxy
Cổng web `apps/standalone` (chuẩn là chạy ở port 3000) **BẮT BUỘC** phải giấu sau Nginx / Caddy Proxy với thiết lập Rate-Limit nhằm chặn Brute-force OTP MFA:

**Mẫu Nginx.conf (Tối giản):**
```nginx
limit_req_zone $binary_remote_addr zone=asq_limit:10m rate=5r/s;

server {
    listen 443 ssl;
    server_name secops.yourdomain.com;
    
    location /api/auth {
        limit_req zone=asq_limit burst=2 nodelay;
        proxy_pass http://localhost:3000/api/auth;
    }
}
```

## 4. Kế hoạch Hậu Mãi (Disaster Recovery)
Lớp WORM Audit Logs nằm tĩnh trên tệp Volume của Docker cấp tại `infra/postgres`. Tuyệt đối phải có CRON Job dùng `pg_dump` ném các file này sang S3 Bucket (có bật versioning / WORM) định kỳ 15 phút/lần.
