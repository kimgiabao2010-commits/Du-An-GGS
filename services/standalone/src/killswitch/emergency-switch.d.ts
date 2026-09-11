export declare class EmergencyKillSwitch {
    private revokedNonces;
    private isSystemHalted;
    private eventBus;
    constructor();
    triggerGlobalKillSwitch(reason: string): void;
    resetKillSwitch(): void;
    revokeNonce(nonce: string): void;
    isNonceRevoked(nonce: string): boolean;
    isHalted(): boolean;
}
//# sourceMappingURL=emergency-switch.d.ts.map