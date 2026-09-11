import { Request, Response, NextFunction } from 'express';
import { JwtService, ASQJwtPayload } from '../jwt-service.js';
import { ASQRole, ASQAction, hasPermission } from '../rbac-matrix.js';

// Extend Express Request object
declare global {
  namespace Express {
    interface Request {
      user?: ASQJwtPayload;
    }
  }
}

export const AuthGuard = (jwtService: JwtService, requiredAction?: ASQAction) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or Invalid Authorization Header' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decodedUser = await jwtService.verifyToken(token);
      req.user = decodedUser;

      if (requiredAction) {
        const role = req.user.role as ASQRole;
        if (!hasPermission(role, requiredAction)) {
          return res.status(403).json({ 
            error: `RBAC Violation: Role [${role}] lacks permission for [${requiredAction}]` 
          });
        }
      }

      next();
    } catch (e: any) {
      return res.status(401).json({ error: e.message || 'Token verification failed' });
    }
  };
};
