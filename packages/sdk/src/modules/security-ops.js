export class SecurityOpsModule {
    ws;
    constructor(ws) {
        this.ws = ws;
    }
    triggerKillSwitch(environment, otpToken) {
        this.ws.publish('security:kill-switch', { environment, otp: otpToken });
    }
    onKillSwitch(callback) {
        this.ws.subscribe('security:kill-switch:activated', callback);
    }
}
//# sourceMappingURL=security-ops.js.map