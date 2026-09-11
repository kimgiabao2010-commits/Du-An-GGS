export interface PendingRequest {
    id: string;
    action: string;
    payload: any;
    requestedBy: string;
    approvals: Set<string>;
    createdAt: number;
}
export declare class DualApprovalStore {
    private store;
    private EXPIRY_TIME_MS;
    createRequest(id: string, action: string, requestedBy: string, payload: any): void;
    approveRequest(id: string, approvedBy: string): {
        status: 'PENDING' | 'APPROVED' | 'EXPIRED' | 'NOT_FOUND';
        payload?: any;
    };
}
//# sourceMappingURL=dual-approval.d.ts.map