export type ModelTier = 'gpt-6-astra' | 'gpt-5.6-terra' | 'gpt-5.6-luna';

export class FinOpsGuardrail {
    // Layer 1: Token Bucket (Tốc độ tức thời RPM/TPM)
    private rpmCapacity: number;
    private rpmTokens: number;
    private fillRatePerSec: number;
    private lastFilled: number;

    // Layer 2: 5 Hour Budget Cap
    private fiveHourBudget: number;
    private consumedIn5Hours: number = 0;
    private budgetWindowStart: number;

    constructor(rpmCapacity: number = 60, fillRatePerSec: number = 1.0, fiveHourBudget: number = 10000) {
        this.rpmCapacity = rpmCapacity;
        this.rpmTokens = rpmCapacity;
        this.fillRatePerSec = fillRatePerSec;
        this.lastFilled = Date.now();
        this.fiveHourBudget = fiveHourBudget;
        this.budgetWindowStart = Date.now();
    }

    private refillRPM(): void {
        const now = Date.now();
        const timePassedSec = Math.max(0, (now - this.lastFilled) / 1000);
        const newTokens = timePassedSec * this.fillRatePerSec;
        this.rpmTokens = Math.min(this.rpmCapacity, this.rpmTokens + newTokens);
        this.lastFilled = now;
    }

    private checkBudgetCycle(): void {
        const now = Date.now();
        const fiveHoursMs = 5 * 60 * 60 * 1000;
        if (now - this.budgetWindowStart >= fiveHoursMs) {
            this.budgetWindowStart = now;
            this.consumedIn5Hours = 0; // Reset budget
        }
    }

    /**
     * Cơ chế Auto-Fallback quyết định model phù hợp nhằm cứu ngân sách
     */
    public suggestModelTier(): ModelTier {
        this.refillRPM();
        this.checkBudgetCycle();
        const budgetUsedRatio = this.consumedIn5Hours / this.fiveHourBudget;
        
        // Nếu dùng hơn 90% budget hoặc bị rate limit nghiêm trọng (TPM thấp)
        if (budgetUsedRatio >= 0.90 || this.rpmTokens < 10) {
            return 'gpt-5.6-luna';
        }
        // Nếu dùng hơn 70% budget hoặc có nguy cơ hết RPM
        if (budgetUsedRatio >= 0.70 || this.rpmTokens < 30) {
            return 'gpt-5.6-terra';
        }
        return 'gpt-6-astra';
    }

    /**
     * @param amount Số Token dự kiến dùng
     * @returns Nếu True -> cho đi tiếp, nếu False -> block thẳng tay chặn nghẽn.
     */
    public consume(amount: number = 1): boolean {
        if (!Number.isFinite(amount) || amount <= 0) return false;
        this.refillRPM();
        this.checkBudgetCycle();

        if (this.rpmTokens >= amount && (this.consumedIn5Hours + amount) <= this.fiveHourBudget) {
            this.rpmTokens -= amount;
            this.consumedIn5Hours += amount;
            return true;
        }
        return false;
    }
}
