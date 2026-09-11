import { ASQWebSocketClient } from '../transport/ws-client.js';
export declare class BlastRadiusModule {
    private ws;
    constructor(ws: ASQWebSocketClient);
    getRadius(incidentId: string, callback: (radiusData: any) => void): void;
    onRadiusAlert(callback: (alertData: any) => void): void;
}
//# sourceMappingURL=blast-radius.d.ts.map