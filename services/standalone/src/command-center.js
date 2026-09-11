import { EventBus, TokenSigner } from '@asq/sdk';
import { SiemReceiver } from './ingestion/siem-receiver.js';
import { EmergencyKillSwitch } from './killswitch/emergency-switch.js';
import { BlastRadiusAssessmentEngine } from './assessment/blast-radius.js';
import { ProgressiveAutonomyController } from './autonomy/progressive-controller.js';
export class CentralCommandOrchestrator {
    eventBus;
    signer;
    siemReceiver;
    blastRadius;
    autonomy;
    killSwitch;
    constructor() {
        this.eventBus = EventBus.getInstance();
        this.signer = new TokenSigner();
        this.siemReceiver = new SiemReceiver();
        this.blastRadius = new BlastRadiusAssessmentEngine();
        this.autonomy = new ProgressiveAutonomyController();
        this.killSwitch = new EmergencyKillSwitch();
        this.initializeCommandCenter();
    }
    initializeCommandCenter() {
        console.log(`[Central Command] 👑 TRỤ SỞ VĨ MÔ KẾT NỐI TOÀN TẬP. Lắng nghe hồi báo 5 Châu...`);
        // Thu hoạch Thành quả từ Pipeline V4 (Từ SDK -> Guardrails -> CLI -> IDE)
        this.eventBus.subscribe('worker:patch_verification_done', async (sandboxReport) => {
            if (this.killSwitch.isHalted())
                return;
            console.log(`\n[Central Command] 📬 Nhận hồ sơ Nghiệm thu Sandbox. Chuyển cấp Đánh giá Blast Radius.`);
            // Giả lập đọc Target File từ chuỗi Report (Bình thường Patch Gen sẽ cấp list)
            const targetFiles = ['infra/aws.tf', 'src/db/core-auth.ts'];
            const blastAssess = this.blastRadius.calculateRiskScore(targetFiles);
            const finalVerdict = await this.autonomy.coordinateDeployment(blastAssess, 'dummy_patch_data_string');
            console.log(`\n[Central Command] 🏁 CHU KỲ KIỂM TOÁN ASQ-V4 ĐÃ ĐÓNG KÍN MẠCH (Closed-Loop). \nBáo cáo tóm tắt: ${finalVerdict}\n`);
        });
        // Ứng cứu nếu hệ thống có cờ Escalate
        this.eventBus.subscribe('incident:escalate', (payload) => {
            console.log(`[Central Command] 🆘 NHẬN LỆNH CẤU CỨU TỪ TIỀN TUYẾN: ${payload.reason}. Chuyển giao đội Incident Response 24/7.`);
        });
    }
    /**
     * Mồi lửa Chu trình. SIEM bắn còi báo động vào CommandCenter
     */
    triggerPipelineFlow(rawPayload) {
        if (this.killSwitch.isHalted()) {
            console.error('[Central Command] Hệ thống đang bị Kéo Phanh (Halted). Hủy bỏ nạp Log.');
            return;
        }
        console.log(`\n======================================================`);
        console.log(`  🚀 BẮT ĐẦU CHU TRÌNH TỰ CHỮA LÀNH ĐA TẦNG ASQ-V4    `);
        console.log(`======================================================\n`);
        const udm = this.siemReceiver.ingestRawLog(rawPayload);
        console.log(`[Central Command] ✍️ Thảo chiếu chỉ Token Mệnh lệnh (Quyền: EXECUTE_RECON)`);
        const signedReconToken = this.signer.sign({
            agentId: 'cmd-hq-001',
            role: 'orchestrator-king',
            permissions: ['EXECUTE_RECON'],
            timestamp: Date.now(),
            expiresAt: Date.now() + 180000
        });
        // Nã pháo ra chiến trường ngầm (CLI Sandbox Recon Agent sẽ dính bẫy và bóp cò chạy scan)
        this.eventBus.publish('worker:recon_request', { token: signedReconToken, targetIp: udm.details.targetIp });
    }
}
// KHỞI KÍCH HOẠT HỆ THỐNG
const hq = new CentralCommandOrchestrator();
// (Mock) Bắn mô phỏng Cảnh báo từ Google Chronicle hoặc Datadog
setTimeout(() => {
    hq.triggerPipelineFlow("ALERT: User Root executed bash script downloaded from 13.54.21.1 to S3 ACL.");
}, 500);
//# sourceMappingURL=command-center.js.map