import * as OTPAuth from 'otpauth';

export class MfaService {
  private issuer = 'ASQ-Engine';

  public generateSecret(userId: string): { secret: string; uri: string } {
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

  public verifyMfaOTP(secret: string, token: string): boolean {
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
