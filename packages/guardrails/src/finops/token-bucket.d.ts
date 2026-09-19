export type ModelTier = 'gpt-6-astra' | 'gpt-5.6-terra' | 'gpt-5.6-luna';
export declare class FinOpsGuardrail {
    private rpmCapacity;
    private rpmTokens;
    private fillRatePerSec;
    private lastFilled;
    private fiveHourBudget;
    private consumedIn5Hours;
    private budgetWindowStart;
    constructor(rpmCapacity?: number, fillRatePerSec?: number, fiveHourBudget?: number);
    private refillRPM;
    private checkBudgetCycle;
    /**
     * Cơ chế Auto-Fallback quyết định model phù hợp nhằm cứu ngân sách
     */
    suggestModelTier(): ModelTier;
    /**
     * @param amount Số Token dự kiến dùng
     * @returns Nếu True -> cho đi tiếp, nếu False -> block thẳng tay chặn nghẽn.
     */
    consume(amount?: number): boolean;
}
//# sourceMappingURL=token-bucket.d.ts.map