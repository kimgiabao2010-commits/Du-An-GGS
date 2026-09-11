export class DualApprovalStore {
    // In-memory stub. Cho Production sẽ dùng Redis.
    store = new Map();
    EXPIRY_TIME_MS = 15 * 60 * 1000; // 15 phút
    createRequest(id, action, requestedBy, payload) {
        this.store.set(id, {
            id,
            action,
            payload,
            requestedBy,
            approvals: new Set([requestedBy]),
            createdAt: Date.now()
        });
    }
    approveRequest(id, approvedBy) {
        const req = this.store.get(id);
        if (!req)
            return { status: 'NOT_FOUND' };
        if (Date.now() - req.createdAt > this.EXPIRY_TIME_MS) {
            this.store.delete(id);
            return { status: 'EXPIRED' };
        }
        req.approvals.add(approvedBy);
        if (req.approvals.size >= 2) {
            this.store.delete(id);
            return { status: 'APPROVED', payload: req.payload };
        }
        return { status: 'PENDING' };
    }
}
//# sourceMappingURL=dual-approval.js.map