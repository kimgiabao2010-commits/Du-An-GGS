import * as OTPAuth from 'otpauth';
export class MfaService {
    issuer = 'ASQ-Engine';
    generateSecret(userId) {
        let totp = new OTPAuth.TOTP({
            issuer: this.issuer,
            label: userId,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: new OTPAuth.Secret({ size: 20 })
        });
        return {
            secret: totp.secret.base32,
            uri: totp.toString()
        };
    }
    verifyMfaOTP(secret, token) {
        let totp = new OTPAuth.TOTP({
            issuer: this.issuer,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: OTPAuth.Secret.fromBase32(secret)
        });
        // Validates a sliding window of +/- 1 period
        let delta = totp.validate({ token, window: 1 });
        return delta !== null;
    }
}
//# sourceMappingURL=mfa-service.js.map