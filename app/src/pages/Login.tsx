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

  if (user) return <Navigate to={user.role === 'band' ? '/moonlight' : '/'} replace />;

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
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-bold mb-1">Account Manager</h1>
        <p className="text-sm text-slate-400 mb-6">ניהול חשבונות, חשבוניות ו-Moonlight Finance</p>
        <form onSubmit={submit} className="space-y-4">
          <Input label="אימייל" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" />
          <Input label="סיסמה" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required dir="ltr" />
          {error && <div className="text-sm text-rose-400">{error}</div>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'מתחבר…' : 'התחברות'}</Button>
        </form>
      </Card>
    </div>
  );
}
