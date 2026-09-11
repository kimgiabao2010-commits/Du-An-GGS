import { ASQWebSocketClient } from '../transport/ws-client.js';
export declare class RuleSyncModule {
    private ws;
    constructor(ws: ASQWebSocketClient);
    update(ruleId: string, rulePayload: any): void;
    list(): void;
    onListReceived(callback: (rules: any[]) => void): void;
}
//# sourceMappingURL=rule-sync.d.ts.map