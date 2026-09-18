import crypto from 'node:crypto';

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

export class TokenSigner {
    private readonly secret: string;

    constructor(secret = process.env.ASQ_JWT_SECRET) {
        if (!secret || secret.length < 32) throw new Error('ASQ_JWT_SECRET must contain at least 32 characters');
        this.secret = secret;
    }

    sign(payload: TokenPayload): string {
        if (!this.validClaims(payload)) throw new Error('Invalid token claims');
        const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return data + '.' + crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
    }

    verify(token: string): TokenPayload | null {
        try {
            if (typeof token !== 'string' || token.length > 16384) return null;
            const parts = token.split('.');
            if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
            const [data, signature] = parts;
            const expected = crypto.createHmac('sha256', this.secret).update(data).digest();
            const received = Buffer.from(signature, 'base64url');
            if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
            const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
            return this.validClaims(payload) ? payload : null;
        } catch {
            return null;
        }
    }

    private validClaims(p: any): p is TokenPayload {
        const now = Date.now();
        return !!p && typeof p.agentId === 'string' && p.agentId.length > 0 &&
            typeof p.role === 'string' && p.role.length > 0 &&
            Array.isArray(p.permissions) && p.permissions.every((v: unknown) => typeof v === 'string') &&
            Number.isSafeInteger(p.timestamp) && Number.isSafeInteger(p.expiresAt) &&
            p.timestamp <= now + 5000 && p.expiresAt > now &&
            p.expiresAt > p.timestamp && p.expiresAt - p.timestamp <= 24 * 60 * 60 * 1000;
    }
}
