import { NextResponse } from 'next/server';
import { JwtService } from '@asq/auth/src/jwt-service.js';

export async function POST(request: Request) {
  // Giả lập BFF Auth Endpoint (Lớp ngoài cho trình duyệt, nối sang Auth Token provider)
  const body = await request.json();
  
  if (body.username === 'admin' && body.password === '123') {
    const jwtSvc = new JwtService('super-secret-key-32-chars-at-least!!');
    const token = await jwtSvc.issueToken({
      userId: 'admin-01',
      role: 'CISO_Admin',
      env: 'PRODUCTION'
    });
    
    // Đẩy JWT này vào Server-only HTTP Cookie để bảo mật (BFF Pattern)
    const response = NextResponse.json({ success: true });
    response.cookies.set('asq-sso-token', token, { httpOnly: true, secure: true });
    return response;
  }
  
  return NextResponse.json({ error: 'Auth failed' }, { status: 401 });
}
