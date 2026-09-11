export type ASQRole = 'Viewer' | 'Analyst' | 'SecOps' | 'SecOps_Lead' | 'CISO_Admin';
export type ASQAction = 'VIEW_DASHBOARD' | 'ACKNOWLEDGE_ALERT' | 'SET_AUTONOMY_L0_L2' | 'SET_AUTONOMY_L3_L4' | 'APPROVE_PATCH' | 'TRIGGER_KILLSWITCH' | 'MANAGE_RULES' | 'VIEW_AUDIT_LOG' | 'DELETE_AUDIT_LOG' | 'CONFIG_RBAC';
export declare const RbacMatrix: Record<ASQAction, ASQRole[]>;
export declare const hasPermission: (role: ASQRole, action: ASQAction) => boolean;
//# sourceMappingURL=rbac-matrix.d.ts.map