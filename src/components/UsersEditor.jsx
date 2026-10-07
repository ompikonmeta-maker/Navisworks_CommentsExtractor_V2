import { useEffect, useState } from 'react';
import { api } from '../lib/server.js';
import { Icon, Button, Select, InfoTip } from './ui.jsx';

const ROLE_OPTS = [
  { value: 'admin', label: 'Admin' },
  { value: 'reviewer', label: 'Reviewer' },
];
const ROLE_HELP = 'Admin sets up and manages everything · Reviewer works the comments (status, resolution, photos) and exports.';

// Admin-only: manage who can sign in and what they can do. Shown as a Settings
// section in remote mode. Accounts are the office (AD) usernames.
export default function UsersEditor({ me }) {
  const [users, setUsers] = useState(null);
  const [uname, setUname] = useState('');
  const [dname, setDname] = useState('');
  const [role, setRole] = useState('reviewer');
  const [err, setErr] = useState('');

  const load = async () => {
    try { setUsers(await api.listUsers()); setErr(''); }
    catch { setErr('Could not load users.'); }
  };
  // Where colleagues open Tabelin (the server's office-network address).
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    load();
    api.serverInfo().then((i) => setUrls(i.urls || [])).catch(() => setUrls([]));
  }, []);
  const address = urls[0] || window.location.origin;
  const [inviteFor, setInviteFor] = useState(null);
  const others = (users || []).filter((u) => u.id !== me?.id && u.active);
  const target = others.find((u) => u.id === inviteFor) || others.find((u) => !u.signedIn) || others[0] || null;
  const messageFor = (u) => {
    const name = (u.displayName || u.username).split(/\s+/)[0];
    return u.signedIn
      ? `Hi ${name}, Tabelin is at ${address}. Sign in as ${u.username} with your PIN.`
      : `Hi ${name}, you have access to Tabelin.\nOpen ${address} and sign in as ${u.username}. The PIN you type the first time becomes your PIN.`;
  };
  const [copied, setCopied] = useState('');
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ }
      t.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(''), 1600);
  };

  const guard = async (fn) => {
    try { await fn(); await load(); }
    catch (e) { setErr(e.message || 'Action failed.'); }
  };

  const add = () => guard(async () => {
    const u = uname.trim();
    if (!u) return;
    await api.createUser(u, dname.trim(), role);
    setUname(''); setDname(''); setRole('reviewer');
  });

  return (
    <div>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="person" className="text-[20px] text-primary" /> Users
        </h2>
        <p className="mt-1 text-xs text-on-surface-variant">Who can sign in, and what they can do. {ROLE_HELP}</p>
      </div>

      {/* Invite: the address to open + a message ready to send */}
      <div className="mb-5 grid gap-4 rounded-[20px] bg-surface-container/60 p-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
            Tabelin address
            <InfoTip label="About the address">Works for anyone on the office network or VPN. If this PC has more than one network, the other addresses are listed below it.</InfoTip>
          </div>
          <div className="flex h-10 items-center gap-2 rounded-control bg-surface px-3">
            <Icon name="link" className="shrink-0 text-[18px] text-on-surface-variant" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{address}</span>
            <button type="button" onClick={() => copy(address, 'address')} className="t-press inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-primary hover:bg-surface-container">
              <Icon name={copied === 'address' ? 'check' : 'content_copy'} className="text-[15px]" />{copied === 'address' ? 'Copied' : 'Copy'}
            </button>
          </div>
          {urls.length > 1 && <div className="mt-1.5 truncate text-[11.5px] text-on-surface-variant">Also: {urls.slice(1).join(' · ')}</div>}
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
            {target ? `Message for ${target.displayName || target.username}` : 'Message'}
          </div>
          {target ? (
            <>
              <p className="whitespace-pre-line rounded-control bg-surface px-3 py-2.5 text-[13px] leading-relaxed">{messageFor(target)}</p>
              <Button variant="tonal" icon={copied === 'msg' ? 'check' : 'content_copy'} className="mt-2 h-9" onClick={() => copy(messageFor(target), 'msg')}>
                {copied === 'msg' ? 'Copied' : 'Copy message'}
              </Button>
            </>
          ) : <p className="text-[13px] text-on-surface-variant">Add a colleague below to get a message to send them.</p>}
        </div>
      </div>

      {/* Add a user */}
      <div className="mb-5 flex flex-wrap items-end gap-2 rounded-control bg-surface-container/60 p-3">
        <label className="flex-1 min-w-[180px] text-xs font-medium text-on-surface-variant">
          Account (office login)
          <input
            value={uname}
            onChange={(e) => setUname(e.target.value)}
            placeholder="e.g. DOMAIN\jdoe"
            className="mt-1 block w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <label className="flex-1 min-w-[140px] text-xs font-medium text-on-surface-variant">
          Name (optional)
          <input
            value={dname}
            onChange={(e) => setDname(e.target.value)}
            placeholder="e.g. Jane Doe"
            className="mt-1 block w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <label className="text-xs font-medium text-on-surface-variant">
          Role
          <div className="mt-1"><Select value={role} onChange={setRole} options={ROLE_OPTS} /></div>
        </label>
        <Button variant="tonal" icon="check_circle" onClick={add} disabled={!uname.trim()}>Add user</Button>
      </div>

      {err && <p className="mb-3 text-xs text-error">{err}</p>}

      {/* User list */}
      {users === null ? (
        <p className="py-4 text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-on-surface-variant">
                <th className="py-2 pr-3 font-semibold">User</th>
                <th className="py-2 pr-3 font-semibold">Role</th>
                <th className="py-2 pr-3 font-semibold">Active</th>
                <th className="py-2 pr-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-t border-outline-variant/40">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{u.displayName || u.username}{self && <span className="ml-2 text-[10px] uppercase text-primary">you</span>}</div>
                      <div className="text-xs text-on-surface-variant">
                        {u.username} · <span style={{ color: u.signedIn ? 'var(--tabelin-good)' : undefined }}>{u.signedIn ? 'signed in' : 'not signed in yet'}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="w-[120px]">
                        <Select
                          value={u.role}
                          onChange={(r) => guard(() => api.updateUser(u.id, { role: r }))}
                          options={ROLE_OPTS}
                          disabled={self}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <button
                        onClick={() => !self && guard(() => api.updateUser(u.id, { active: !u.active }))}
                        disabled={self}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                          u.active ? 'bg-status-closed/15 text-status-closed' : 'bg-surface-container text-on-surface-variant'
                        } ${self ? 'opacity-60' : 'hover:brightness-95'}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${u.active ? 'bg-status-closed' : 'bg-on-surface-variant'}`} />
                        {u.active ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td className="py-2.5 pr-1 text-right">
                      {!self && (
                        <button
                          onClick={() => { setInviteFor(u.id); copy(messageFor(u), `row${u.id}`); }}
                          className="mr-1 rounded-control px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container hover:text-primary"
                          title="Copy an invite message for this person"
                        >
                          {copied === `row${u.id}` ? 'Copied' : 'Copy invite'}
                        </button>
                      )}
                      <button
                        onClick={() => guard(() => api.resetPin(u.id))}
                        className="mr-1 rounded-control px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container hover:text-primary"
                        title="Clear the PIN so they set a new one next sign-in"
                      >
                        Reset PIN
                      </button>
                      {!self && (
                        <button
                          onClick={() => window.confirm(`Remove ${u.username}?`) && guard(() => api.deleteUser(u.id))}
                          className="rounded-control px-2 py-1 text-xs text-on-surface-variant hover:bg-error-container hover:text-error"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
