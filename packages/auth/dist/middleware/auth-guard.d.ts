import { Request, Response, NextFunction } from 'express';
import { JwtService, ASQJwtPayload } from '../jwt-service.js';
import { ASQAction } from '../rbac-matrix.js';
declare global {
    namespace Express {
        interface Request {
            user?: ASQJwtPayload;
        }
    }
}
export declare const AuthGuard: (jwtService: JwtService, requiredAction?: ASQAction) => (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=auth-guard.d.ts.map