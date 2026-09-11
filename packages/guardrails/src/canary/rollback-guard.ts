export type RolloutStage = '5%' | '25%' | '100%';

export class CanaryRollbackGuard {
    private totalRequests: number = 0;
    private errorRequests: number = 0;
    
    // Ngưỡng 2% tự động thu hồi
    private errorThresholdRate: number; 
    public currentStage: RolloutStage = '5%';

    /**
     * @param errorThresholdRate Tỷ lệ mặc định 0.02 (2%)
     */
    constructor(errorThresholdRate: number = 0.02) {
        this.errorThresholdRate = errorThresholdRate;
    }

    public advanceStage(): void {
        if (this.currentStage === '5%') this.currentStage = '25%';
        else if (this.currentStage === '25%') this.currentStage = '100%';
        
        // Reset metrics bộ đếm khi đổi Stage
        this.totalRequests = 0;
        this.errorRequests = 0;
        console.log(`[CanaryRollbackGuard] Scale up: Tỷ lệ phân phối bản vá nâng mức ${this.currentStage}`);
    }

    public recordRequest(isError: boolean): void {
        this.totalRequests++;
        if (isError) {
            this.errorRequests++;
        }

        // Smoothing: Đợi ít nhất 50 requests ở lượng mẫu hiện hành để tránh giật cục tỷ lệ
        if (this.totalRequests >= 50) {
            const errorRate = this.errorRequests / this.totalRequests;
            if (errorRate > this.errorThresholdRate) {
                this.triggerZeroSecondRollback(`Ngưỡng lỗi APM chạm ${(errorRate * 100).toFixed(2)}% (Mức tối đa: ${this.errorThresholdRate * 100}%)`);
            }
        }
    }

    public reset(): void {
        this.totalRequests = 0;
        this.errorRequests = 0;
        this.currentStage = '5%';
    }

    private triggerZeroSecondRollback(reason: string): void {
        console.error(`[CanaryRollbackGuard] LỆNH TỐI CAO: Kích hoạt Zero-Second Automated Rollback! Lý do: ${reason}`);
        // Cơ chế ném ngoại lệ hệ thống báo cho Standalone Hub
        throw new Error(`SYSTEM_ROLLBACK_ACTIVATED: ${reason}`);
    }
}
