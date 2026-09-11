import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';
export class JwtService {
    secretKey;
    constructor(secretStr) {
        this.secretKey = new TextEncoder().encode(secretStr);
    }
    async issueToken(payload, expiresIn = '24h') {
        return new SignJWT(payload)
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(expiresIn)
            .sign(this.secretKey);
    }
    async verifyToken(token) {
        try {
            const { payload } = await jwtVerify(token, this.secretKey);
            return payload;
        }
        catch (error) {
            throw new Error('Invalid or Expired JWT Token');
        }
    }
    static generateStrongSecret() {
        return crypto.randomBytes(32).toString('hex');
    }
}
//# sourceMappingURL=jwt-service.js.map