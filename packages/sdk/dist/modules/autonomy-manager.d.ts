import { ASQWebSocketClient } from '../transport/ws-client.js';
export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
export declare class AutonomyManagerModule {
    private ws;
    constructor(ws: ASQWebSocketClient);
    setLevel(level: AutonomyLevel, approvers: string[]): void;
    getLevel(callback: (levelInfo: {
        level: AutonomyLevel;
    }) => void): void;
    onLevelChange(callback: (event: {
        newLevel: AutonomyLevel;
        user: string;
    }) => void): void;
}
//# sourceMappingURL=autonomy-manager.d.ts.map