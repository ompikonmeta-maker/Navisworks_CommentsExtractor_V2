import { useState } from 'react';
import { api } from '../lib/server.js';
import { Icon, Card, Button } from './ui.jsx';

// Browser login for off-domain use. On the office network the server identifies
// the user from their Windows account and this screen is skipped entirely.
export default function Login({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const u = await api.login(username.trim(), pin);
      onSuccess(u);
    } catch (e2) {
      setErr(e2.code === 401 ? 'Account or PIN is not correct.' : e2.code === 429 ? e2.message : 'Could not sign in. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-on-surface">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-control bg-primary text-on-primary">
            <Icon name="table_view" className="text-[24px]" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">Tabelin</div>
            <div className="text-xs text-on-surface-variant">Sign in to your review workspace</div>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-xs font-medium text-on-surface-variant">
            Account
            <input
              id="login-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="e.g. DOMAIN\yourname"
              className="mt-1 block w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2.5 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <label className="text-xs font-medium text-on-surface-variant">
            PIN
            <input
              id="login-pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="current-password"
              placeholder="Your PIN"
              className="mt-1 block w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2.5 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          {err && <p className="text-xs text-error">{err}</p>}
          <Button type="submit" variant="filled" icon="check_circle" disabled={busy || !username.trim() || !pin}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="mt-1 text-[12px] leading-relaxed text-on-surface-variant">
            First time signing in sets your PIN. Ask your administrator if your
            account is not set up yet.
          </p>
        </form>
      </Card>
    </div>
  );
}
