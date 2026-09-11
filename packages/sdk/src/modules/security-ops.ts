import { ASQWebSocketClient } from '../transport/ws-client.js';

export class SecurityOpsModule {
  constructor(private ws: ASQWebSocketClient) {}

  public triggerKillSwitch(environment: string, otpToken: string): void {
    this.ws.publish('security:kill-switch', { environment, otp: otpToken });
  }

  public onKillSwitch(callback: (event: any) => void): void {
    this.ws.subscribe('security:kill-switch:activated', callback);
  }
}
