'use client';

import { Bot, Circle, Plus, Send, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Message = { id: string; source: string; text: string; timestamp: string; user?: boolean; taskId?: string };

export default function OrchestratorPrompt() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loginStatus, setLoginStatus] = useState('Opening authenticated control channel');
  const [connected, setConnected] = useState(false);
  const [caseId, setCaseId] = useState('');
  const [caseState, setCaseState] = useState('NEW');
  const [connectionGeneration, setConnectionGeneration] = useState(0);
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
  useEffect(() => { newCase(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (!caseId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let disposed = false, retries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (disposed) return;
      setConnected(false);
      setLoginStatus(retries ? 'Reconnecting authenticated control channel' : 'Opening authenticated control channel');
      const socket = new WebSocket(`${protocol}://${window.location.hostname}:4000`);
      ws.current = socket;
      const current = () => !disposed && ws.current === socket;
      socket.onopen = () => {
        if (current()) { setConnected(true); setLoginStatus('Authenticated operator - control channel online'); }
      };
      socket.onmessage = event => {
        if (!current()) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'STATUS' || data.payload?.action !== 'ui_flash') return;
          if (data.payload.caseId && data.payload.caseId !== caseId) return;
          if (data.payload.caseState) setCaseState(data.payload.caseState);
          addMessage(data.payload.source, data.payload.message, false, data.payload.taskId);
        } catch { /* Unverified malformed frames never become displayed evidence. */ }
      };
      socket.onclose = event => {
        if (!current()) return;
        setConnected(false);
        if (event.code === 1008) {
          setLoginStatus('Control session ended or permission denied. Sign in again; your draft is retained.');
          return;
        }
        if (retries < 3) {
          retries++;
          setLoginStatus('Control channel disconnected. Retrying safely; your draft is retained.');
          timer = setTimeout(connect, 1000 * 2 ** (retries - 1));
        } else setLoginStatus('Control channel unavailable. Check the launcher, then reconnect or sign in again. Your draft is retained.');
      };
      socket.onerror = () => { if (current()) setConnected(false); };
    };
    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      const socket = ws.current;
      if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close(); }
      ws.current = null;
    };
  }, [caseId, connectionGeneration]);

  const send = () => {
    const command = inputValue.trim();
    if (!command || !caseId || ws.current?.readyState !== WebSocket.OPEN) return;
    addMessage('You', command, true);
    ws.current.send(JSON.stringify({ message_id: crypto.randomUUID(), incident_id: caseId, timestamp: Date.now(), type: 'COMMAND', payload: { action: 'commander_prompt', content: command } }));
    setInputValue('');
  };

  return <section className="command-panel panel">
    <div className="command-status"><div><span className={`status-dot ${connected ? 'success' : 'neutral'}`} /><strong>Standalone case</strong><span>{caseId ? caseId.slice(0, 8) : 'creating'}</span></div><div className="case-status-actions"><span className="subtle-label">{caseState}</span><button className="button secondary compact" onClick={newCase}><Plus size={14} />New case</button></div></div>
    <div className="auth-panel"><p className="auth-help" id="control-channel-status" role="status">{loginStatus}</p>{!connected && <button className="button secondary compact" onClick={() => setConnectionGeneration(n => n + 1)}>Reconnect control channel</button>}</div>
    <div className="message-feed" aria-live="polite">{messages.map(message => <article className={`message${message.user ? ' user' : ''}`} key={message.id}><div className="message-avatar" aria-hidden="true">{message.user ? <UserRound size={15} /> : <Bot size={16} />}</div><div className="message-bubble"><div className="message-meta">{message.source}<Circle size={3} fill="currentColor" />{message.timestamp}{message.taskId && <><Circle size={3} fill="currentColor" />{message.taskId.slice(0, 8)}</>}</div><div className="message-body">{message.text}</div></div></article>)}<div ref={messagesEndRef} /></div>
    <div className="composer-wrap"><div className="composer"><textarea rows={2} className="composer-input" aria-label="SOC investigation request" aria-describedby="control-channel-status" value={inputValue} onChange={event => setInputValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Describe an alert, ask a SOC question, or request read-only evidence..." /><button className="send-button" aria-label="Send request" aria-describedby="control-channel-status" disabled={!inputValue.trim() || !connected} onClick={send}><Send size={17} /></button></div><p className="composer-hint">Enter to send - Shift + Enter for a new line - execution remains policy-bound and read-only.</p></div>
  </section>;
}
