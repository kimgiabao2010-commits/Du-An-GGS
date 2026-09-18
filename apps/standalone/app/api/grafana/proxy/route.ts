import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ status: 'UNAVAILABLE', error: 'Grafana adapter is not configured; no telemetry available' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
