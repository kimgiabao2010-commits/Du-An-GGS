'use client';
import { OctagonX } from 'lucide-react';
import { useState } from 'react';

export default function KillSwitch() {
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const halt = () => {
    if (!window.confirm('Stop workers and block new tasks? This does not isolate the entire network.')) return;
    setPending(true); setStatus('Waiting for backend acknowledgement.');
    const ws = new WebSocket('ws://localhost:4000'); let acknowledged = false;
    const timeout = setTimeout(() => ws.close(), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'COMMAND', message_id: crypto.randomUUID(), incident_id: crypto.randomUUID(), timestamp: Date.now(), payload: { action: 'trigger_killswitch' } }));
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'STATUS' && message.payload?.source === 'HALTED') { acknowledged = true; setStatus('Backend blocked new tasks and requested worker shutdown.'); ws.close(); }
      } catch { /* Ignore invalid status frames. */ }
    };
    ws.onerror = () => setStatus('Unable to reach the backend.');
    ws.onclose = () => { clearTimeout(timeout); setPending(false); if (!acknowledged) setStatus('Stop is not acknowledged. Check authentication and backend status.'); };
  };
  return <section className="control-card">
    <div className="control-heading"><h3><OctagonX size={15} aria-hidden="true" />Emergency stop</h3><span className="badge badge-danger">Restricted</span></div>
    <p className="control-copy">Block new tasks in Command Center and request cancellation of active worker jobs.</p>
    <button className="button-danger" disabled={pending} onClick={halt}>{pending ? 'Requesting stop…' : 'Activate kill switch'}</button>
    <p className="danger-status" role="status">{status}</p>
    <p className="control-note">Requires an administrator session. Distributed acknowledgement and production MFA are not connected.</p>
  </section>;
}
