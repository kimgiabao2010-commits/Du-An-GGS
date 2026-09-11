export const RbacMatrix = {
    VIEW_DASHBOARD: ['Viewer', 'Analyst', 'SecOps', 'SecOps_Lead', 'CISO_Admin'],
    VIEW_AUDIT_LOG: ['SecOps', 'SecOps_Lead', 'CISO_Admin'],
    ACKNOWLEDGE_ALERT: ['Analyst', 'SecOps', 'SecOps_Lead', 'CISO_Admin'],
    APPROVE_PATCH: ['SecOps', 'SecOps_Lead', 'CISO_Admin'],
    MANAGE_RULES: ['SecOps', 'SecOps_Lead', 'CISO_Admin'],
    SET_AUTONOMY_L0_L2: ['SecOps', 'SecOps_Lead', 'CISO_Admin'],
    TRIGGER_KILLSWITCH: ['SecOps', 'SecOps_Lead', 'CISO_Admin'],
    SET_AUTONOMY_L3_L4: ['SecOps_Lead', 'CISO_Admin'], // Cần check thêm Dual Approval nếu là Lead
    CONFIG_RBAC: ['CISO_Admin'],
    DELETE_AUDIT_LOG: [] // Chuẩn WORM: KHÔNG AI ĐƯỢC XÓA
};
export const hasPermission = (role, action) => {
    const allowedRoles = RbacMatrix[action] || [];
    return allowedRoles.includes(role);
};
//# sourceMappingURL=rbac-matrix.js.map