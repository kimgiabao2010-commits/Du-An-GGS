export interface PendingRequest {
  id: string;
  action: string;
  payload: any;
  requestedBy: string;
  approvals: Set<string>;
  createdAt: number;
}

export class DualApprovalStore {
  // In-memory stub. Cho Production sẽ dùng Redis.
  private store: Map<string, PendingRequest> = new Map();
  private EXPIRY_TIME_MS = 15 * 60 * 1000; // 15 phút

  public createRequest(id: string, action: string, requestedBy: string, payload: any): void {
    this.store.set(id, {
      id,
      action,
      payload,
      requestedBy,
      approvals: new Set([requestedBy]),
      createdAt: Date.now()
    });
  }

  public approveRequest(id: string, approvedBy: string): { status: 'PENDING' | 'APPROVED' | 'EXPIRED' | 'NOT_FOUND', payload?: any } {
    const req = this.store.get(id);
    if (!req) return { status: 'NOT_FOUND' };

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
