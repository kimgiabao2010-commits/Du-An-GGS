'use client';

import { Bot, Circle, LockKeyhole, Plus, Send, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Message = { id: string; source: string; text: string; timestamp: string; user?: boolean; taskId?: string };

export default function OrchestratorPrompt() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginStatus, setLoginStatus] = useState('Not authenticated');
  const [sessionVersion, setSessionVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [caseId, setCaseId] = useState('');
  const [caseState, setCaseState] = useState('NEW');
  const ws = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const addMessage = (source: string, text: string, user = false, taskId?: string) => setMessages(previous => [
    ...previous,
    { id: crypto.randomUUID(), source, text, user, taskId, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
  ]);
  const newCase = () => {
    setCaseId(crypto.randomUUID());
    setCaseState('NEW');
    setMessages([{ id: crypto.randomUUID(), source: 'GSS Standalone', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: 'New case created locally. Describe the alert, question, or evidence you want to investigate.' }]);
  };
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

  useEffect(() => { newCase(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const socket = new WebSocket('ws://localhost:4000');
    ws.current = socket;
    socket.onopen = () => { setConnected(true); setLoginStatus(previous => previous.startsWith('Administrator') ? `${previous} - control plane online` : 'Observer connected - sign in to operate'); };
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'STATUS' || data.payload?.action !== 'ui_flash') return;
        if (data.payload.caseId && data.payload.caseId !== caseId) return;
        if (data.payload.caseState) setCaseState(data.payload.caseState);
        addMessage(data.payload.source, data.payload.message, false, data.payload.taskId);
      } catch { /* Malformed frames are never rendered as evidence. */ }
    };
    socket.onclose = () => { setConnected(false); setLoginStatus('Control plane disconnected'); };
    socket.onerror = () => setConnected(false);
    return () => socket.close();
  }, [sessionVersion, caseId]);

  const send = () => {
    const command = inputValue.trim();
    if (!command || !caseId || ws.current?.readyState !== WebSocket.OPEN) return;
    addMessage('You', command, true);
    ws.current.send(JSON.stringify({ message_id: crypto.randomUUID(), incident_id: caseId, timestamp: Date.now(), type: 'COMMAND', payload: { action: 'commander_prompt', content: command } }));
    setInputValue('');
  };

  return <section className="command-panel panel">
    <div className="command-status"><div><span className={`status-dot ${connected ? 'success' : 'neutral'}`} /><strong>Standalone case</strong><span>{caseId ? caseId.slice(0, 8) : 'creating'}</span></div><div className="case-status-actions"><span className="subtle-label">{caseState}</span><button className="button secondary compact" onClick={newCase}><Plus size={14} />New case</button></div></div>
    <div className="auth-panel"><div className="auth-title"><LockKeyhole size={16} aria-hidden="true" /><span>Local operator session</span></div><div className="auth-row"><label className="field-group"><span>Username</span><input className="field" autoComplete="username" placeholder="Operator ID" value={username} onChange={event => setUsername(event.target.value)} /></label><label className="field-group"><span>Password</span><input className="field" autoComplete="current-password" type="password" placeholder="Session password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') login(); }} /></label><button className="button primary" onClick={login}>Sign in</button></div><p className="auth-help" role="status">{loginStatus}</p></div>
    <div className="message-feed" aria-live="polite">{messages.map(message => <article className={`message${message.user ? ' user' : ''}`} key={message.id}><div className="message-avatar" aria-hidden="true">{message.user ? <UserRound size={15} /> : <Bot size={16} />}</div><div className="message-bubble"><div className="message-meta">{message.source}<Circle size={3} fill="currentColor" />{message.timestamp}{message.taskId && <><Circle size={3} fill="currentColor" />{message.taskId.slice(0, 8)}</>}</div><div className="message-body">{message.text}</div></div></article>)}<div ref={messagesEndRef} /></div>
    <div className="composer-wrap"><div className="composer"><textarea rows={2} className="composer-input" aria-label="SOC investigation request" value={inputValue} onChange={event => setInputValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Describe an alert, ask a SOC question, or request read-only evidence..." /><button className="send-button" aria-label="Send request" disabled={!inputValue.trim() || !connected} onClick={send}><Send size={17} /></button></div><p className="composer-hint">Enter to send - Shift + Enter for a new line - execution remains policy-bound and read-only.</p></div>
  </section>;
}
