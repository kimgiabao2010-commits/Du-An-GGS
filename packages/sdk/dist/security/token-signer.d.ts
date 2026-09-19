export interface TokenPayload {
    agentId: string;
    role: string;
    permissions: string[];
    timestamp: number;
    expiresAt: number;
    taskId?: string;
    incidentId?: string;
    instructionHash?: string;
}
export declare class TokenSigner {
    private readonly secret;
    constructor(secret?: string | undefined);
    sign(payload: TokenPayload): string;
    verify(token: string): TokenPayload | null;
    private validClaims;
}
//# sourceMappingURL=token-signer.d.ts.map