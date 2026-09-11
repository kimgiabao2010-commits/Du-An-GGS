export interface BlastRadiusResult {
    score: number;
    isSafeForAutoDeploy: boolean;
    criticalServicesAffected: string[];
}

export class BlastRadiusAssessmentEngine {
    
    /**
     * Đo lường phạm vi sát thương nếu áp dụng Patch lên hệ thống sống.
     */
    public calculateRiskScore(targetFiles: string[]): BlastRadiusResult {
        let score = 10;
        let isSafeForAutoDeploy = true;
        const criticalServicesAffected: string[] = [];
        
        console.log(`[BlastRadius Engine] ☢️ Khảo sát Khu vực bị tác động...`);

        for (const file of targetFiles) {
            // Rủi ro Cao (Database, Code Core, Core Auth)
            if (file.includes('db/') || file.includes('database') || file.includes('auth')) {
                score += 65;
                isSafeForAutoDeploy = false;
                criticalServicesAffected.push(file);
                console.warn(`[BlastRadius Engine] ⚠️ CHÚ Ý CAO ĐỘ: Mã vá đụng tới Hệ Thống Core Lõi: ${file}`);
            } 
            // Rủi ro Thấp (Cấu hình IaC độc lập, Static Web...)
            else if (file.includes('infra/') || file.includes('acl')) {
                score += 15; 
            }
        }

        // Chặn ngưỡng 100
        score = Math.min(score, 100);
        console.log(`[BlastRadius Engine] Trả về Điểm Rủi ro (RCA Score): ${score}/100 | Zero-Touch Safety: ${isSafeForAutoDeploy}`);

        return { score, isSafeForAutoDeploy, criticalServicesAffected };
    }
}
