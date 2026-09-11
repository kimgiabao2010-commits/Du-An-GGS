import { hasPermission } from '../rbac-matrix.js';
export const AuthGuard = (jwtService, requiredAction) => {
    return async (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or Invalid Authorization Header' });
        }
        const token = authHeader.split(' ')[1];
        try {
            const decodedUser = await jwtService.verifyToken(token);
            req.user = decodedUser;
            if (requiredAction) {
                const role = req.user.role;
                if (!hasPermission(role, requiredAction)) {
                    return res.status(403).json({
                        error: `RBAC Violation: Role [${role}] lacks permission for [${requiredAction}]`
                    });
                }
            }
            next();
        }
        catch (e) {
            return res.status(401).json({ error: e.message || 'Token verification failed' });
        }
    };
};
//# sourceMappingURL=auth-guard.js.map