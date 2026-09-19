'use client';
import { Radio } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function AgentStatusPanel({ title }: { title: string }) {
  const [connection, setConnection] = useState('Not connected');
  const [logs, setLogs] = useState<string[]>([]);
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:4000');
    ws.onopen = () => setConnection('Observer connected · worker presence not proven');
    ws.onclose = () => setConnection('Command Center disconnected');
    ws.onerror = () => setConnection('Backend connection failed');
    ws.onmessage = event => {
      try { const data = JSON.parse(event.data); if (data.type === 'STATUS' && typeof data.payload?.message === 'string') setLogs(previous => [...previous, `[${data.incident_id}] ${data.payload.source}: ${data.payload.message}`].slice(-50)); }
      catch { /* Never turn malformed frames into evidence. */ }
    };
    return () => ws.close();
  }, []);
  return <section className="agent-card">
    <div className="control-heading"><h2>{title}</h2><span className="badge"><Radio size={12} aria-hidden="true" />Observer</span></div>
    <p role="status" className="observer-status"><span className="status-dot info" />{connection}</p><p>Displays backend status frames only. Submit orchestrator requests from Command Center.</p>
    <div className="agent-log">{logs.length ? logs.map((log, index) => <pre key={index}>{log}</pre>) : <div className="empty-state">No runtime status to display.</div>}</div>
  </section>;
}
