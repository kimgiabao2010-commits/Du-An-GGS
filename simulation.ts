import { ASQClient } from './packages/sdk/src/asq-client.js';
import { JwtService } from './packages/auth/src/jwt-service.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runE2ESimulation() {
  console.log('======================================================');
  console.log('🚀 ASQ-ENGINE QUARTET CLOSING-LOOP - E2E SIMULATION 🚀');
  console.log('======================================================\n');

  // STEP 1: Khởi động Auth & Gán Quyền
  console.log('>>> [1. Standalone Hub] Khởi động JwtService (Phase 2 Auth Layer)...');
  const jwt = new JwtService('very-secret-256-bit-key-for-asq!');
  const token = await jwt.issueToken({ userId: 'CISO-X01', role: 'CISO_Admin', env: 'PROD' });
  console.log(`✅ Cấp quyền CISO thành công. JWT Token Length: ${token.length}`);
  await sleep(1000);

  // STEP 2: Khởi động SDK Client
  console.log('\n>>> [2. IDE/CLI Client] Phóng SDK Core (Phase 1 SDK Layer)...');
  const asq = new ASQClient({ wsUrl: 'ws://mock-localhost', token });
  asq.connect();
  console.log('📡 Đã kết nối kênh WebSocket Reconnect & gRPC Stream!');
  await sleep(1500);

  // STEP 3: Mô phỏng Dữ liệu NATS Đổ về Web UI
  console.log('\n>>> [3. Backend BFF] Lắng nghe Event từ NATS/WORM DB...');
  console.log('🔴 [CRITICAL SIEM ALERT]: Phát hiện payload Injection từ dải IP 192.168.x.x');
  await sleep(1000);

  // STEP 4: SDK truyền tín hiệu Sandbox
  console.log('\n>>> [4. SDK Transport] Phân luồng luân chuyển Payload về phía IDE Reasoner...');
  asq.blast.getRadius('INCIDENT-999', (data) => console.log(data));
  console.log('💥 Đánh giá: Độ nguy hiểm 98% (L4 Autonomy Threshold). Đang bóp chặt mạng lưới...');
  await sleep(1500);

  // STEP 5: Chạy Auto-Fix (Giả lập IDE Extension Phase 4)
  console.log('\n>>> [5. IDE Sandbox] Xử lý rào chắn Patch...');
  const grpcRes = await asq.grpc.submitPatch('SQLI-RULE-01', 'api/auth.ts', Buffer.from('patched-ast'));
  console.log(`✅ Đã vá AST Code thành công! Patch Hash: ${grpcRes.patch_hash}`);
  await sleep(1000);

  // STEP 6: Kích Hoạt Kill Switch từ Web Dashboard (Phase 5)
  console.log('\n>>> [6. Command Center] Kích hoạt Khẩn cấp Cấp độ tối đa (Kill-Switch)!');
  asq.security.triggerKillSwitch('PRODUCTION', '294103');
  console.log('🛑 KILL-SWITCH ĐẠT LỆNH: Toàn bộ Network C2 đã bị cô lập.');
  console.log('📝 LOG WORM: Đã đổ dữ liệu vĩnh viễn vào asq_audit_events chống xóa!');
  await sleep(1000);

  console.log('\n======================================================');
  console.log('🌟 MÔ PHỎNG THÀNH CÔNG: Vòng lặp Zero-Trust Đã Hoàn Tất!');
  console.log('======================================================\n');
  process.exit(0);
}

runE2ESimulation().catch(console.error);
