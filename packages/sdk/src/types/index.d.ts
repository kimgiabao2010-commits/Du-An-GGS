export interface UDMEvent {
    id: string;
    timestamp: number;
    type: 'SIEM_ALERT' | 'NMAP_SCAN' | 'TRIVY_SCAN' | 'STABILITY_ALERT' | 'SYSTEM_ROLLBACK';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    source: string;
    details: Record<string, any>;
}
export interface SecurityContext {
    actor: string;
    isAuthenticated: boolean;
    tokenId?: string;
}
export interface VerificationResult {
    passed: boolean;
    reason?: string;
    confidence: number;
}
export interface RemediationProposal {
    codeDiff: string;
    yaraLRule?: string;
    targetFiles: string[];
    suggestedAutonomyLevel: 'Level 1: Zero-Touch' | 'Level 2: 1-Click Approve' | 'Level 3: Human Intervention';
}
export interface BlastRadiusReport {
    score: number;
    affectedServices: string[];
    isSafeForAutoDeploy: boolean;
}
export interface SandboxVerificationResult {
    buildStatus: 'SUCCESS' | 'FAILED';
    unitTestsPassed: boolean;
    pullRequestUrl?: string;
}
export declare enum NodeRole {
    SIEM = "SIEM",
    STANDALONE = "STANDALONE",
    IDE_AGENT = "IDE_AGENT",
    CLI_DAEMON = "CLI_DAEMON",
    BROADCAST = "BROADCAST"
}
export interface ASQMessage<T = any> {
    message_id: string;
    incident_id: string;
    source: NodeRole | string;
    target: NodeRole | string;
    type: 'EVENT' | 'TASK' | 'RESULT' | 'EVIDENCE' | 'COMMAND' | 'STATUS' | 'AUDIT';
    permission: string[];
    signature: string;
    timestamp: number;
    payload: T;
}
//# sourceMappingURL=index.d.ts.map