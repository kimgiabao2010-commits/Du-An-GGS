'use client';

import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function LoginForm() {
  const router = useRouter(), search = useSearchParams();
  const [username, setUsername] = useState('BaoNVG'), [password, setPassword] = useState('');
  const [status, setStatus] = useState('Use the local operator credential printed by Ctrl+Shift+B.');
  const [busy, setBusy] = useState(false);
  const login = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const payload = await response.json() as { error?: string }; setPassword('');
      if (!response.ok) return setStatus(payload.error ?? 'Authentication failed');
      const next = search.get('next'); router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/standalone'); router.refresh();
    } catch { setStatus('Authentication service is unavailable'); } finally { setBusy(false); }
  };
  return <main className="login-page"><section className="login-card panel">
    <div className="login-mark"><ShieldCheck size={24} /><span>GSS</span></div><p className="eyebrow">Protected workspace</p>
    <h1>Sign in to continue.</h1><p>Standalone investigations and Control Plane operations are separated by server-side role checks.</p>
    <div className="login-fields"><label className="field-group"><span>Username</span><input className="field" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
      <label className="field-group"><span>Password</span><input className="field" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void login(); }} /></label>
      <button className="button primary" disabled={busy || !username || !password} onClick={() => void login()}><LockKeyhole size={15} />{busy ? 'Signing in…' : 'Sign in'}</button></div>
    <p className="auth-help" role="status">{status}</p></section></main>;
}
