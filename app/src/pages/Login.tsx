import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { Button, Input, Card } from '../ui';

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'band' ? '/moonlight/summary' : '/'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm md:p-7">
        <div className="flex items-center gap-2.5 mb-4">
          <svg viewBox="0 0 32 32" className="w-9 h-9 shrink-0" aria-hidden>
            <g stroke="currentColor" strokeWidth="3.1" strokeLinecap="round" className="text-ink">
              <path d="M6 16v0" /><path d="M11 13v6" /><path d="M16 10v12" /><path d="M21 12.5v7" /><path d="M26 16v0" />
            </g>
            <rect x="6" y="25" width="20" height="3.2" rx="1.6" className="fill-accent" />
          </svg>
          <h1 className="ser text-xl">Account&nbsp;Manager</h1>
        </div>
        <p className="text-sm text-muted mb-6">ניהול חשבונות, חשבוניות ו-Moonlight Finance</p>
        <form onSubmit={submit} className="space-y-4">
          <Input label="אימייל" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" />
          <Input label="סיסמה" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required dir="ltr" />
          {error && <div className="text-sm text-neg">{error}</div>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'מתחבר…' : 'התחברות'}</Button>
        </form>
      </Card>
    </div>
  );
}
