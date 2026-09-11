import { ASQWebSocketClient } from '../transport/ws-client.js';
export declare class SecurityOpsModule {
    private ws;
    constructor(ws: ASQWebSocketClient);
    triggerKillSwitch(environment: string, otpToken: string): void;
    onKillSwitch(callback: (event: any) => void): void;
}
//# sourceMappingURL=security-ops.d.ts.map