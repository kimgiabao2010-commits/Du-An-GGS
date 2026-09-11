import { ModelTier } from '@asq/guardrails';
export declare class ModelTieringRouter {
    private finops;
    constructor();
    /**
     * Dựa trên Severity gốc, định hướng phiên bản AI (Tier) xử lý.
     * Liên thông với FinOps API để Fall-back (Hạ cấp) khi nghẽn tín hiệu.
     */
    routeToModel(severity: string): ModelTier;
}
//# sourceMappingURL=model-router.d.ts.map