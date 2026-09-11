import { JWTPayload } from 'jose';
export interface ASQJwtPayload extends JWTPayload {
    userId: string;
    role: string;
    env: string;
}
export declare class JwtService {
    private secretKey;
    constructor(secretStr: string);
    issueToken(payload: ASQJwtPayload, expiresIn?: string): Promise<string>;
    verifyToken(token: string): Promise<ASQJwtPayload>;
    static generateStrongSecret(): string;
}
//# sourceMappingURL=jwt-service.d.ts.map