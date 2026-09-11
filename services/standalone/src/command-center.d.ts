import { EmergencyKillSwitch } from './killswitch/emergency-switch.js';
export declare class CentralCommandOrchestrator {
    private eventBus;
    private signer;
    private siemReceiver;
    private blastRadius;
    private autonomy;
    killSwitch: EmergencyKillSwitch;
    constructor();
    private initializeCommandCenter;
    /**
     * Mồi lửa Chu trình. SIEM bắn còi báo động vào CommandCenter
     */
    triggerPipelineFlow(rawPayload: string): void;
}
//# sourceMappingURL=command-center.d.ts.map