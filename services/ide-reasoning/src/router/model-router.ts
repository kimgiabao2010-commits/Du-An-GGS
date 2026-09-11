import { FinOpsGuardrail, ModelTier } from '@asq/guardrails';

export class ModelTieringRouter {
    private finops: FinOpsGuardrail;

    constructor() {
        // Cấp quỹ cho Ide Engine (ví dụ: Budget 5h = 10,000 Token)
        this.finops = new FinOpsGuardrail(100, 2.0, 10000);
    }

    /**
     * Dựa trên Severity gốc, định hướng phiên bản AI (Tier) xử lý.
     * Liên thông với FinOps API để Fall-back (Hạ cấp) khi nghẽn tín hiệu.
     */
    public routeToModel(severity: string): ModelTier {
        let suggestedTier: ModelTier = 'Gemini Flash-Lite';
        if (severity === 'CRITICAL' || severity === 'HIGH') {
            suggestedTier = 'Gemini Pro'; // Lỗ hổng sâu cần Pro soi
        } else if (severity === 'MEDIUM') {
            suggestedTier = 'Gemini Flash';
        }

        // Xin ý kiến chốt chặn FinOps
        const finopsTier = this.finops.suggestModelTier();
        
        const tierRank = { 'Gemini Flash-Lite': 1, 'Gemini Flash': 2, 'Gemini Pro': 3 };
        
        // Chọn cấp độ thấp nhất giữa "Điều mức độ cần" và "Quy định tài chính"
        const finalTier = tierRank[finopsTier] < tierRank[suggestedTier] ? finopsTier : suggestedTier;
        
        console.log(`[ModelTieringRouter] Request: ${severity} | Nguyện vọng: ${suggestedTier} | FinOps Chốt hạn: ${finopsTier} | => Model Chạy Cuối: ${finalTier}`);
        
        // Trừ token giả lập
        this.finops.consume(1);
        return finalTier;
    }
}
