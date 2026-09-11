import { NextResponse } from 'next/server';
// import { AuthGuard } from '@asq/auth'; // Will be integrated

export async function GET(request: Request) {
  // Bản chất của file này là ngụy trang Token API Auth Header
  // Trước khi gọi sang Grafana Host trên Docker
  const grafanaEndpoint = 'http://localhost:3000/api/dashboards/uid/asq-main';
  
  // Mock Response
  return NextResponse.json({
    status: 'BFF Proxy Ready',
    target: grafanaEndpoint,
    data: [] // Chuỗi biểu đồ thời gian thực sẽ đẩy về Frontend
  });
}
