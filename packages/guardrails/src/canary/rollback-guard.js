export class CanaryRollbackGuard {
    totalRequests = 0;
    errorRequests = 0;
    // Ngưỡng 2% tự động thu hồi
    errorThresholdRate;
    currentStage = '5%';
    /**
     * @param errorThresholdRate Tỷ lệ mặc định 0.02 (2%)
     */
    constructor(errorThresholdRate = 0.02) {
        this.errorThresholdRate = errorThresholdRate;
    }
    advanceStage() {
        if (this.currentStage === '5%')
            this.currentStage = '25%';
        else if (this.currentStage === '25%')
            this.currentStage = '100%';
        // Reset metrics bộ đếm khi đổi Stage
        this.totalRequests = 0;
        this.errorRequests = 0;
        console.log(`[CanaryRollbackGuard] Scale up: Tỷ lệ phân phối bản vá nâng mức ${this.currentStage}`);
    }
    recordRequest(isError) {
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
    reset() {
        this.totalRequests = 0;
        this.errorRequests = 0;
        this.currentStage = '5%';
    }
    triggerZeroSecondRollback(reason) {
        console.error(`[CanaryRollbackGuard] LỆNH TỐI CAO: Kích hoạt Zero-Second Automated Rollback! Lý do: ${reason}`);
        // Cơ chế ném ngoại lệ hệ thống báo cho Standalone Hub
        throw new Error(`SYSTEM_ROLLBACK_ACTIVATED: ${reason}`);
    }
}
//# sourceMappingURL=rollback-guard.js.map