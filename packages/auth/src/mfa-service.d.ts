export declare class MfaService {
    private issuer;
    generateSecret(userId: string): {
        secret: string;
        uri: string;
    };
    verifyMfaOTP(secret: string, token: string): boolean;
}
//# sourceMappingURL=mfa-service.d.ts.map