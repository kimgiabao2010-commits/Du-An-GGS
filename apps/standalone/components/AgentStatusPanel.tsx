'use client';
import { useEffect, useState } from 'react';

/** Observer only: browser panels never impersonate execution workers. */
export default function AgentStatusPanel({ title }: { title: string }) {
  const [connection, setConnection] = useState('Chưa kết nối');
  const [logs, setLogs] = useState<string[]>([]);
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:4000');
    ws.onopen = () => setConnection('Đã kết nối kênh quan sát; không chứng minh worker online');
    ws.onclose = () => setConnection('Mất kết nối. Đăng nhập ở trang Chỉ huy rồi tải lại trang này.');
    ws.onerror = () => setConnection('Không thể kết nối backend');
    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'STATUS' && typeof data.payload?.message === 'string') {
          setLogs(previous => [...previous, `[${data.incident_id}] ${data.payload.source}: ${data.payload.message}`].slice(-50));
        }
      } catch { /* Never synthesize evidence from malformed messages. */ }
    };
    return () => ws.close();
  }, []);
  return <section style={{ padding: 20, overflow: 'auto', maxHeight: 500 }}>
    <h2>{title}</h2><p role="status">{connection}</p>
    <p>Luồng trạng thái chung từ backend. Gửi yêu cầu tại trang Chỉ huy.</p>
    {logs.length === 0 && <p>Chưa nhận dữ liệu thực thi.</p>}
    {logs.map((log, index) => <pre key={index} style={{ whiteSpace: 'pre-wrap' }}>{log}</pre>)}
  </section>;
}
