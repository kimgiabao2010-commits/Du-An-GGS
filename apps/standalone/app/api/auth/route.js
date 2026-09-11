"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const jwt_service_js_1 = require("@asq/auth/src/jwt-service.js");
async function POST(request) {
    // Giả lập BFF Auth Endpoint (Lớp ngoài cho trình duyệt, nối sang Auth Token provider)
    const body = await request.json();
    if (body.username === 'admin' && body.password === '123') {
        const jwtSvc = new jwt_service_js_1.JwtService('super-secret-key-32-chars-at-least!!');
        const token = await jwtSvc.issueToken({
            userId: 'admin-01',
            role: 'CISO_Admin',
            env: 'PRODUCTION'
        });
        // Đẩy JWT này vào Server-only HTTP Cookie để bảo mật (BFF Pattern)
        const response = server_1.NextResponse.json({ success: true });
        response.cookies.set('asq-sso-token', token, { httpOnly: true, secure: true });
        return response;
    }
    return server_1.NextResponse.json({ error: 'Auth failed' }, { status: 401 });
}
//# sourceMappingURL=route.js.map