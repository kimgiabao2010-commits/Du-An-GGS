import crypto from 'crypto';

export interface TokenPayload {
    agentId: string;
    role: string;
    permissions: string[];
    timestamp: number;
    expiresAt: number;
}

export class TokenSigner {
    private secret: string;

    constructor(secret: string = process.env.ASQ_JWT_SECRET || 'default-secret-key-change-me-v4') {
        this.secret = secret;
    }

    sign(payload: TokenPayload): string {
        const data = Buffer.from(JSON.stringify(payload)).toString('base64');
        const signature = crypto.createHmac('sha256', this.secret).update(data).digest('base64');
        return `${data}.${signature}`;
    }

    verify(token: string): TokenPayload | null {
        try {
            const parts = token.split('.');
            if (parts.length !== 2) return null;
            
            const [data, signature] = parts;
            const expectedSignature = crypto.createHmac('sha256', this.secret).update(data).digest('base64');
            
            if (signature !== expectedSignature) return null;
            
            const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as TokenPayload;
            
            // Khuyến nghị 1: Kiểm tra thời hạn sống của Token (TTL - Thwart Replay Attack)
            if (Date.now() > payload.expiresAt) {
                console.warn('[TokenSigner] Security Guard: Token đã hết hạn!');
                return null;
            }
            
            return payload;
        } catch (error) {
            return null;
        }
    }
}
