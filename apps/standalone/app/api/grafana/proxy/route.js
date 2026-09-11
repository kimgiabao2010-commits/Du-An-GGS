"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
// import { AuthGuard } from '@asq/auth'; // Will be integrated
async function GET(request) {
    // Bản chất của file này là ngụy trang Token API Auth Header
    // Trước khi gọi sang Grafana Host trên Docker
    const grafanaEndpoint = 'http://localhost:3000/api/dashboards/uid/asq-main';
    // Mock Response
    return server_1.NextResponse.json({
        status: 'BFF Proxy Ready',
        target: grafanaEndpoint,
        data: [] // Chuỗi biểu đồ thời gian thực sẽ đẩy về Frontend
    });
}
//# sourceMappingURL=route.js.map