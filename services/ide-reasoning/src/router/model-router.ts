import { FinOpsGuardrail, ModelTier } from '@asq/guardrails';

export class ModelTieringRouter {
    private finops: FinOpsGuardrail;

    constructor(finops?: FinOpsGuardrail) {
        // Cấp quỹ cho Ide Engine (ví dụ: Budget 5h = 10,000 Token)
        this.finops = finops ?? new FinOpsGuardrail(100, 2.0, 10000);
    }

    /**
     * Dựa trên Severity gốc, định hướng phiên bản AI (Tier) xử lý.
     * Liên thông với FinOps API để Fall-back (Hạ cấp) khi nghẽn tín hiệu.
     */
    public routeToModel(severity: string): ModelTier {
        severity = severity.toUpperCase();
        if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity)) {
            throw new Error('Unknown severity: human triage required');
        }
        let suggestedTier: ModelTier = 'gpt-5.6-luna';
        if (severity === 'CRITICAL' || severity === 'HIGH') {
            suggestedTier = 'gpt-6-astra'; // Lỗ hổng sâu cần Astra soi
        } else if (severity === 'MEDIUM') {
            suggestedTier = 'gpt-5.6-terra';
        }

        // Xin ý kiến chốt chặn FinOps
        const finopsTier = this.finops.suggestModelTier();
        
        const tierRank = { 'gpt-5.6-luna': 1, 'gpt-5.6-terra': 2, 'gpt-6-astra': 3 };
        if (tierRank[finopsTier] < tierRank[suggestedTier]) {
            throw new Error('Insufficient budget for required reasoning tier: defer or escalate');
        }
        
        // Chọn cấp độ thấp nhất giữa "Điều mức độ cần" và "Quy định tài chính"
        const finalTier = tierRank[finopsTier] < tierRank[suggestedTier] ? finopsTier : suggestedTier;
        
        console.log(`[ModelTieringRouter] Request: ${severity} | Nguyện vọng: ${suggestedTier} | FinOps Chốt hạn: ${finopsTier} | => Model Chạy Cuối: ${finalTier}`);
        
        // Trừ token giả lập
        if (!this.finops.consume(1)) throw new Error('FinOps quota exhausted');
        return finalTier;
    }
}
