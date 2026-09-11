import { VerificationResult } from '@asq/sdk';
export declare class AdversarialRedTeamVerifier {
    /**
     * Phân tích độc lập bản vá (Code Diff/IaC) trước khi đưa về Sandbox.
     * Kiểm tra chặt chẽ 4 lỗi chí mạng.
     * @param patch Nội dung code vá
     */
    verifyPatch(patch: string): Promise<VerificationResult>;
}
//# sourceMappingURL=red-team-verifier.d.ts.map