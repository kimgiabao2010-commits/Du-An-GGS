export interface TokenPayload {
    agentId: string;
    role: string;
    permissions: string[];
    timestamp: number;
    expiresAt: number;
}
export declare class TokenSigner {
    private secret;
    constructor(secret?: string);
    sign(payload: TokenPayload): string;
    verify(token: string): TokenPayload | null;
}
//# sourceMappingURL=token-signer.d.ts.map