# GSS — Roadmap checkpoint 2026-10-09 — Codex

Mốc người dùng yêu cầu: **11:20:00 ngày 09/10/2026, Asia/Bangkok (UTC+7)**. Đã tạo heartbeat một lần trong chính chat này, ID `gss-checkpoint-11-20`; chưa coi lịch đã tạo là bằng chứng commit/push thành công. Máy/app cần hoạt động để scheduler thực thi; GitHub authentication và remote trạng thái được kiểm tra lại tại checkpoint.

## Kết quả triển khai

Tiếp tục security/identity và release gates trong roadmap evidence-first, PostgreSQL source-of-truth; không mở remediation/writeback/merge/deploy.

1. **Đóng Critical dependency còn mở:** targeted update `proxy-addr` → 2.0.8 trong lockfile; [maintainer advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h). Audit toàn dependency (kể cả dev) trả 0 findings. Lần npm update đầu bị lỗi mở lockfile Windows; retry thành công, không reset/xóa file. Gate local/CI giờ audit cả dev/build supply chain, retain log + SHA-256, không che finding bằng production-only PASS.
2. **Permanent certificate deny floor:** migration 015, PostgreSQL tombstone không update/delete/truncate, revision tăng đơn điệu, idempotent request bound body/trusted actor. Revoke + revision + audit cùng transaction. Revoke là deny-only: không có endpoint un-revoke, không grant quyền/enroll/deploy.
3. **Control Plane authority:** Security Admin được xác thực mới revoke; service bearer/role header không được làm admin. Check endpoint chỉ dành service; list giới hạn 100 bản ghi cho SECURITY_ADMIN/AUDITOR/service. Invalid=422, conflict=409, revoked=403, authority unavailable=503.
4. **Runtime thật:** Control Plane kiểm tra deny floor trên peer mTLS; Command Center → HTTP mTLS → PostgreSQL cho handshake/frame/outbound WS và idle checks. Pin-file rollback không resurrect leaf đã revoke; restart giữ tombstone. Outage/timeout fail closed. Sync SDK send không bypass async gate; CLI/IDE task ACK, heartbeat ACK, result ACK, dispatch và broadcast chuyển sang authorized send.
5. **Bounds:** CP check timeout 2 giây, WS authority timeout 3 giây; 8 queued frames/socket, 64 pending authenticated upgrades, 200 TLS connections. Idle poll 2 giây subject to event-loop scheduling; không phải zero-latency distributed revocation hay physical cancellation.
6. **Tài liệu/gitlog:** cập nhật Project Truth/current runbook và `GITLOG.md`; giữ phần September dưới nhãn historical. Thay đổi cũ chưa commit được kiểm tra lại cùng source trước publication; tài liệu riêng của người dùng, .env, dữ liệu operational và generated/cache không đưa lên GitHub.

Skill `gss-verification-gate` dẫn hướng test failure paths, schema cô lập và tách local PASS khỏi staging BLOCKED. Official OpenAI Docs được dùng cho [scheduled checkpoint](https://learn.chatgpt.com/docs/automations?surface=app), không thay đổi model/runtime policy.

## Verification

- Focused PostgreSQL/mTLS: **17 PASS**, gồm audit rollback, parallel replay, mutation denial, service/operator separation, deny-on-send/frame/idle, native HTTP authority stop, pin rollback, restart và hung/backlog bounds.
- Typecheck root + UI: PASS sau triển khai.
- Focused không có DB: **7 PASS, 10 SKIPPED**; không cộng DB-only assertions bị skip vào PASS.
- Full verification: **PASS local**, gồm build 6/6, typecheck, source/skills, smoke, **254 tests** (unit 91 + integration PostgreSQL 144 + environment 7 + browser 12). Hai audit gates production và toàn dependency đều PASS, 0 findings. **Release vẫn BLOCKED**, không công bố complete hoặc phần trăm readiness.
- Manifest gốc: `data/verification/2026-10-09T02-32-45-305Z-0cbef1a0-5e97-49e6-b9f5-91c5b0067560/manifest.json`, hoàn tất 09:36:23 UTC+7. Source không đổi trong verification. Bản metadata có thể đưa lên GitHub: [verification summary](GSS_VERIFICATION_2026-10-09_CODEX.json); log gốc giữ local, mỗi log có SHA-256, không giả vờ đã publish raw logs.
- Source fingerprint: `e51ffe09526410382c38d17353a3e4e1fd63cca24eb60a4cff642e22c33f99d3`; lockfile SHA-256: `303034104dba626be32b080635bc0ab12be8b920cfc6ad30088be6df87e8c067`.

Runtime DB chỉ được kiểm tra SELECT 1, **không migrate runtime schema trong lượt này**; integration runner áp dụng migrations trong schema `gss_suite_...` riêng và dọn đúng schema được tạo. Ctrl+Shift+B sẽ migrate trước khi chạy phiên bản mới.

## BLOCKED / NOT RUN và giới hạn

- Readiness thực: PostgreSQL SELECT 1 PASS; overall BLOCKED vì Chronicle coordinates thiếu, Google ADC/viewer identity thiếu và Docker không khả dụng.
- NOT RUN: Chronicle staging E2E, rootless/gVisor adversarial, browser OIDC/MFA, staging PKI enrollment/rotation, Object Lock, OTLP collector, labeled model eval, remote OSV/Trivy/CI, load/SLO và 72-hour freeze.
- Đã có deny-only revocation; **chưa có full durable versioned enrollment/grant policy, dual-control publication, signed policy distribution, CRL/OCSP/HSM**. File-only local SDK mode không phải durable authority; staging cấm fallback.
- SQL triggers không chống PostgreSQL superuser/DDL compromise hoặc rollback cả database snapshot. Cần DB least privilege, backup anti-rollback/retention và external audit controls.
- Revoke không chứng minh lệnh đã dừng vật lý: task đã được authorize trước lúc revoke commit có thể in-flight. Presence READY là self-report, không attestation.
- Không gọi paid LLM/Chronicle để làm test xanh; không tự tạo credential staging, không sửa .env thật.

## GitHub checkpoint

Status: **PUSHED — người dùng yêu cầu push ngay, trước 11:20**. Branch `main`; origin `kimgiabao2010-commits/Du-An-GGS`. Implementation commit: [`506b1f4e464e35d4dc29e51a2596e9fe5d9e0cba`](https://github.com/kimgiabao2010-commits/Du-An-GGS/commit/506b1f4e464e35d4dc29e51a2596e9fe5d9e0cba). Non-force push thành công; tại **10:05:06 UTC+7**, `git ls-remote origin refs/heads/main` khớp local HEAD. Báo cáo receipt này là commit docs riêng; SHA cuối xem Git history. Remote CI chưa được xác minh.

Đã đối chiếu lại source fingerprint, hash của 357 file trong allowlist (trước chỉnh trạng thái publication trong docs) và hash log verification: khớp snapshot PASS; không chạy lại test khi source không đổi. Chỉ cập nhật trạng thái publication trong tài liệu. 25 file private/generated/cache được loại khỏi commit và giữ nguyên local; .env/runtime data không publish. 212 file sinh cũ cạnh TypeScript được xóa có chủ đích để tránh runtime divergence; không xóa dữ liệu riêng của người dùng.

Tại checkpoint: secret/diff review → cập nhật trạng thái gitlog/report → stage đúng source/tests/migrations/config/docs đã verify → commit → non-force push → xác nhận remote SHA → báo hash, manifest và blockers. Nếu remote thay đổi/auth bị từ chối thì giữ commit local và báo BLOCKED, không force/rebase/reset để che conflict. Log/manifest chưa có trong GitHub không được nói đã publish.

## Tiếp theo

Ưu tiên external prerequisites Chronicle read-only + Linux rootless sandbox; sau đó browser OIDC/MFA và staging PKI/rotation; hoàn thiện certificate grant policy dual-control/anti-rollback, evidence retention/OTLP, CI security evidence, labeled routing eval và load/freeze. Engineering MVP vẫn không production-ready.
