export interface BlastRadiusResult {
    score: number;
    isSafeForAutoDeploy: boolean;
    criticalServicesAffected: string[];
}
export declare class BlastRadiusAssessmentEngine {
    /**
     * Đo lường phạm vi sát thương nếu áp dụng Patch lên hệ thống sống.
     */
    calculateRiskScore(targetFiles: string[]): BlastRadiusResult;
}
//# sourceMappingURL=blast-radius.d.ts.map