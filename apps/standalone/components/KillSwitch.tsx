'use client';
import { useState } from 'react';

export default function KillSwitch() {
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const halt = () => {
    if (!window.confirm('Dừng worker và chặn task mới? Không cách ly toàn bộ mạng.')) return;
    setPending(true);
    setStatus('Đang chờ backend xác nhận…');
    const ws = new WebSocket('ws://localhost:4000');
    let acknowledged = false;
    const timeout = setTimeout(() => ws.close(), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'COMMAND', message_id: crypto.randomUUID(),
      incident_id: crypto.randomUUID(), timestamp: Date.now(), payload: { action: 'trigger_killswitch' } }));
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'STATUS' && message.payload?.source === 'HALTED') {
          acknowledged = true;
          setStatus('Backend đã chặn task mới và yêu cầu dừng worker; chưa xác nhận mọi worker đã dừng.');
          ws.close();
        }
      } catch { /* Ignore unrelated malformed status. */ }
    };
    ws.onclose = () => {
      clearTimeout(timeout); setPending(false);
      if (!acknowledged) setStatus('Chưa xác nhận dừng. Kiểm tra đăng nhập và backend.');
    };
    ws.onerror = () => setStatus('Không kết nối được backend.');
  };
  return <section>
    <button disabled={pending} onClick={halt} style={{ background: '#d32f2f', color: 'white', padding: 12, borderRadius: 8 }}>
      {pending ? 'Đang gửi…' : 'Trigger Kill-Switch'}
    </button>
    <p role="status">{status}</p>
    <small>Yêu cầu phiên quản trị. Chưa tích hợp xác thực bước hai.</small>
  </section>;
}
