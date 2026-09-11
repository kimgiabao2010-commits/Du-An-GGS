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
//# sourceMappingURL=index.d.ts.map