export type RolloutStage = '5%' | '25%' | '100%';
export declare class CanaryRollbackGuard {
    private totalRequests;
    private errorRequests;
    private errorThresholdRate;
    currentStage: RolloutStage;
    /**
     * @param errorThresholdRate Tỷ lệ mặc định 0.02 (2%)
     */
    constructor(errorThresholdRate?: number);
    advanceStage(): void;
    recordRequest(isError: boolean): void;
    reset(): void;
    private triggerZeroSecondRollback;
}
//# sourceMappingURL=rollback-guard.d.ts.map