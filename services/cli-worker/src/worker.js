import { EventBus, TokenSigner } from '@asq/sdk';
import { NetworkReconScanner } from './scanners/network-recon.js';
import { PrDispatcher } from './gitops/pr-dispatcher.js';
export class CliWorkerDaemon {
    eventBus;
    signer;
    reconScanner;
    prDispatcher;
    constructor() {
        // Tích hợp Node-wide EventBus từ Giai đoạn 1 làm Mạch máu
        this.eventBus = EventBus.getInstance();
        this.signer = new TokenSigner();
        this.reconScanner = new NetworkReconScanner();
        this.prDispatcher = new PrDispatcher();
        this.initializeListeners();
    }
    initializeListeners() {
        console.log(`[CLI Daemon] Đang Boot... Kênh Inter-Process UDMEvent sẵn sàng nghe lệnh.`);
        // 1. Phục vụ Chiến dịch quét mạng
        this.eventBus.subscribe('worker:recon_request', async (payload) => {
            const tokenData = this.signer.verify(payload.token);
            // Xác minh Zero-Trust Token và quyền mở rộng (Quy định ở Giai đoạn 1)
            if (!tokenData || !tokenData.permissions.includes('EXECUTE_RECON')) {
                console.error(`[CLI Daemon] 🛑 TỪ CHỐI THỰC THI (Unauthorized): Agent thiếu quyền \`EXECUTE_RECON\`. Lệnh Drop.`);
                return;
            }
            console.log(`[CLI Daemon] ✅ Token V4 Hợp lệ. Cho phép Sandbox Reconnissance.`);
            const results = await this.reconScanner.scanTarget(payload.targetIp);
            this.eventBus.publish('worker:recon_completed', results);
        });
        // 2. Phục vụ Triển khai Bản vá (Test + GitOps)
        this.eventBus.subscribe('worker:patch_dispatch', async (payload) => {
            const tokenData = this.signer.verify(payload.token);
            if (!tokenData || !tokenData.permissions.includes('EXECUTE_SANDBOX_BUILD')) {
                console.error(`[CLI Daemon] 🛑 TỪ CHỐI THỰC THI (Unauthorized): Agent thiếu quyền \`EXECUTE_SANDBOX_BUILD\`. Lệnh Drop.`);
                return;
            }
            console.log(`[CLI Daemon] ✅ Token V4 Hợp lệ. Đang nạp bản vá vào Lò phản ứng Sandbox.`);
            const results = await this.prDispatcher.testAndDispatch(payload.patch);
            this.eventBus.publish('worker:patch_verification_done', results);
        });
    }
    run() {
        console.log(`[CLI Daemon] 🛡️ Worker V4 (Mock Shell Execution Mode) ĐÃ LÊN HÌNH TẠI GIAI ĐOẠN 3! Hỗ trợ RBAC & EventBus.`);
    }
}
// Khởi chạy tự động
const daemon = new CliWorkerDaemon();
daemon.run();
//# sourceMappingURL=worker.js.map