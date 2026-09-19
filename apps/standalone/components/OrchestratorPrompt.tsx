'use client';

import { Bot, Circle, LockKeyhole, Send, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Message = { id: string; source: string; text: string; timestamp: string; user?: boolean };

export default function OrchestratorPrompt() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginStatus, setLoginStatus] = useState('Not authenticated');
  const [sessionVersion, setSessionVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const addMessage = (source: string, text: string, user = false) => setMessages(previous => [...previous, { id: crypto.randomUUID(), source, text, user, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
  const login = async () => {
    try {
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const body = await response.json();
      setPassword('');
      if (!response.ok) return setLoginStatus(body.error || 'Authentication failed');
      setLoginStatus('Administrator session authenticated');
      setSessionVersion(version => version + 1);
    } catch { setLoginStatus('Authentication server is unavailable'); }
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    setMessages([{ id: crypto.randomUUID(), source: 'GSS System', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: 'Ready for a bounded request. Results are only considered evidence when the backend links them to a task and incident.' }]);
    const socket = new WebSocket('ws://localhost:4000');
    ws.current = socket;
    socket.onopen = () => { setConnected(true); setLoginStatus(previous => previous.startsWith('Administrator') ? `${previous} · Command Center online` : 'Observer connected · sign in to operate'); };
    socket.onmessage = event => { try { const data = JSON.parse(event.data); if (data.type === 'STATUS' && data.payload?.action === 'ui_flash') addMessage(data.payload.source, data.payload.message); } catch { /* Never render malformed frames as evidence. */ } };
    socket.onclose = () => { setConnected(false); setLoginStatus('Command Center disconnected'); };
    socket.onerror = () => setConnected(false);
    return () => socket.close();
  }, [sessionVersion]);

  const send = () => {
    const command = inputValue.trim();
    if (!command || ws.current?.readyState !== WebSocket.OPEN) return;
    addMessage('You', command, true);
    ws.current.send(JSON.stringify({ message_id: crypto.randomUUID(), incident_id: crypto.randomUUID(), timestamp: Date.now(), type: 'COMMAND', payload: { action: 'commander_prompt', content: command } }));
    setInputValue('');
  };

  return <section className="command-panel panel">
    <div className="command-status"><div><span className={`status-dot ${connected ? 'success' : 'neutral'}`} /><strong>Orchestrator channel</strong><span>{connected ? 'Connected' : 'Offline'}</span></div><span className="subtle-label">WebSocket · localhost:4000</span></div>
    <div className="auth-panel"><div className="auth-title"><LockKeyhole size={16} /><span>Administrator session</span></div><div className="auth-row"><input className="field" aria-label="Username" autoComplete="username" placeholder="Username" value={username} onChange={event => setUsername(event.target.value)} /><input className="field" aria-label="Password" autoComplete="current-password" type="password" placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') login(); }} /><button className="button primary" onClick={login}>Sign in</button></div><p className="auth-help" role="status">{loginStatus}</p></div>
    <div className="message-feed" aria-live="polite">{messages.map(message => <article className={`message${message.user ? ' user' : ''}`} key={message.id}><div className="message-avatar" aria-hidden="true">{message.user ? <UserRound size={15} /> : <Bot size={16} />}</div><div className="message-bubble"><div className="message-meta">{message.source}<Circle size={3} fill="currentColor" />{message.timestamp}</div><div className="message-body">{message.text}</div></div></article>)}<div ref={messagesEndRef} /></div>
    <div className="composer-wrap"><div className="composer"><textarea rows={2} className="composer-input" aria-label="Orchestration request" value={inputValue} onChange={event => setInputValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Describe a bounded, read-only task…" /><button className="send-button" aria-label="Send request" disabled={!inputValue.trim() || !connected} onClick={send}><Send size={17} /></button></div><p className="composer-hint">Enter to send · Shift + Enter for a new line · Model output never grants permission.</p></div>
  </section>;
}
