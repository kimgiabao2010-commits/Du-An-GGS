import { EventBus, TokenSigner } from '@asq/sdk';
import { AdversarialRedTeamVerifier } from '@asq/guardrails';
import { ModelTieringRouter } from './router/model-router.js';
import { AstSemanticParser } from './ast/ast-parser.js';
import { PatchGenerator } from './remediation/patch-generator.js';
export class IdeReasoningMasterEngine {
    eventBus;
    signer;
    // Khởi tạo các cỗ máy lý luận vi mô
    modelRouter;
    astParser;
    generator;
    redTeamVerifier;
    constructor() {
        this.eventBus = EventBus.getInstance();
        this.signer = new TokenSigner(); // Bí mật hệ thống (Secret Root)
        this.modelRouter = new ModelTieringRouter();
        this.astParser = new AstSemanticParser();
        this.generator = new PatchGenerator();
        this.redTeamVerifier = new AdversarialRedTeamVerifier();
        this.initializeWorkflow();
    }
    initializeWorkflow() {
        console.log(`[IDE Master] 📡 Đang kết nối màng lưới EventBus... Chờ dữ liệu Recon.`);
        // 1. Phản ứng với sự kiện Reconnissance
        this.eventBus.subscribe('worker:recon_completed', async (reconData) => {
            console.log(`\n[IDE Master] 🔴 Nhận dữ liệu Trinh sát CVE. Kích hoạt Chuỗi suy luận AI đa tầng...`);
            await this.executeReasoningPipeline(reconData);
        });
    }
    async executeReasoningPipeline(reconData) {
        // Tầng 1: Đánh giá Model xử lý
        const severity = reconData?.vulnerabilities?.[0]?.severity || 'MEDIUM';
        this.modelRouter.routeToModel(severity);
        // Tầng 2: Thu hoạch lỗi bằng AST Decoder
        const defect = this.astParser.parseIaC('mock_vuln_code_placeholder');
        // Tầng 3 & 4 (Red Team Counter-Verification Loop)
        // AI CHỐT CAO CẤP: Chống Vòng Lặp Vô Hạn gây cạn Token. Hủy diệt luồng nếu AI mù lòa.
        let attempt = 1;
        let passed = false;
        let finalPatch = null;
        const maxRetries = 3;
        while (attempt <= maxRetries) {
            console.log(`[IDE Master] (Lần duyệt Patch ${attempt}/${maxRetries}) Đang soi bản vá...`);
            const proposal = this.generator.generateRemediation(defect);
            // Đối kháng (Chặn 0.0.0.0/0, Mật khẩu hardcode...)
            const audit = await this.redTeamVerifier.verifyPatch(proposal.codeDiff);
            if (audit.passed) {
                console.log(`[IDE Master] ✅ Audit Thành Công tuyệt đối. Mã an toàn cấp Enterprise!`);
                passed = true;
                finalPatch = proposal;
                break;
            }
            else {
                console.warn(`[IDE Master] ❌ Red-Team Bác bỏ: ${audit.reason}. Từ chối bản vá này.`);
                attempt++;
            }
        }
        // Tầng 5: Chống Lỗi kẹt mạng
        if (!passed || !finalPatch) {
            console.error(`[IDE Master] 🛑 INFINITE LOOP BREAKER: Hết lượt ngâm cứu (${maxRetries}). Bắn luồng EscalateToHuman! Giữ mạng cho an toàn.`);
            this.eventBus.publish('incident:escalate', { reason: 'LLM Hallucination Blindspot' });
            return;
        }
        // Tầng 6: Phân phối & Ký Ủy nhiệm Thư RBAC
        console.log(`[IDE Master] ✍️ Ấn định con dấu Hoàng gia HMAC... Truyền lệnh EXECUTE_SANDBOX_BUILD xuống CLI...`);
        const signedToken = this.signer.sign({
            agentId: 'ide-engine-core',
            role: 'orchestrator',
            permissions: ['EXECUTE_SANDBOX_BUILD'],
            timestamp: Date.now(),
            expiresAt: Date.now() + (5 * 60 * 1000) // Ủy nhiệm có sinh mệnh 5 phút
        });
        // Đẩy đi vào mạng pub-sub
        this.eventBus.publish('worker:patch_dispatch', {
            token: signedToken,
            patch: finalPatch.codeDiff
        });
    }
    boot() {
        console.log(`[IDE Master] 🧠 Trụ sở Reasoning Đầu não (Giai đoạn 4) ĐÃ BOOT THÀNH CÔNG.`);
    }
}
// Khởi chạy module nếu làm tác nhân Standalone Process độc lập
const engine = new IdeReasoningMasterEngine();
engine.boot();
//# sourceMappingURL=engine.js.map