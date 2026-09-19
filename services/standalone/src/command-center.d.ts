import { EmergencyKillSwitch } from './killswitch/emergency-switch.js';
export declare class CentralCommandOrchestrator {
    private wsServer;
    private llmRouter;
    private eventBus;
    private signer;
    private siemReceiver;
    private blastRadius;
    private autonomy;
    killSwitch: EmergencyKillSwitch;
    constructor(port: number);
    private initializeCommandCenter;
    private triggerPipelineFlow;
    private broadcastToUI;
}
//# sourceMappingURL=command-center.d.ts.map