import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import crypto from 'crypto';

export interface ASQJwtPayload extends JWTPayload {
  userId: string;
  role: string;
  env: string;
}

export class JwtService {
  private secretKey: Uint8Array;

  constructor(secretStr: string) {
    this.secretKey = new TextEncoder().encode(secretStr);
  }

  public async issueToken(payload: ASQJwtPayload, expiresIn = '24h'): Promise<string> {
    return new SignJWT(payload as any)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secretKey);
  }

  public async verifyToken(token: string): Promise<ASQJwtPayload> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey);
      return payload as ASQJwtPayload;
    } catch (error) {
      throw new Error('Invalid or Expired JWT Token');
    }
  }

  public static generateStrongSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
