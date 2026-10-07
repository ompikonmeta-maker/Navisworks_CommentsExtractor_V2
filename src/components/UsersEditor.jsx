import { useEffect, useState } from 'react';
import { api } from '../lib/server.js';
import { Icon, Button, Select } from './ui.jsx';

const ROLE_OPTS = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];
const ROLE_HELP = 'Admin manages users & everything · Editor imports and edits · Viewer read-only.';

// Admin-only: manage who can sign in and what they can do. Shown as a Settings
// section in remote mode. Accounts are the office (AD) usernames.
export default function UsersEditor({ me }) {
  const [users, setUsers] = useState(null);
  const [uname, setUname] = useState('');
  const [dname, setDname] = useState('');
  const [role, setRole] = useState('editor');
  const [err, setErr] = useState('');

  const load = async () => {
    try { setUsers(await api.listUsers()); setErr(''); }
    catch { setErr('Could not load users.'); }
  };
  useEffect(() => { load(); }, []);

  const guard = async (fn) => {
    try { await fn(); await load(); }
    catch (e) { setErr(e.message || 'Action failed.'); }
  };

  const add = () => guard(async () => {
    const u = uname.trim();
    if (!u) return;
    await api.createUser(u, dname.trim(), role);
    setUname(''); setDname(''); setRole('editor');
  });

  return (
    <div>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="person" className="text-[20px] text-primary" /> Users
        </h2>
        <p className="mt-1 text-xs text-on-surface-variant">Who can sign in, and what they can do. {ROLE_HELP}</p>
      </div>

      {/* Add a user */}
      <div className="mb-5 flex flex-wrap items-end gap-2 rounded-control bg-surface-container/60 p-3">
        <label className="flex-1 min-w-[180px] text-xs font-medium text-on-surface-variant">
          Account (office login)
          <input
            value={uname}
            onChange={(e) => setUname(e.target.value)}
            placeholder="e.g. DOMAIN\jdoe"
            className="mt-1 block w-full rounded-control border border-outline bg-surface px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <label className="flex-1 min-w-[140px] text-xs font-medium text-on-surface-variant">
          Name (optional)
          <input
            value={dname}
            onChange={(e) => setDname(e.target.value)}
            placeholder="e.g. Jane Doe"
            className="mt-1 block w-full rounded-control border border-outline bg-surface px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                      <div className="text-xs text-on-surface-variant">{u.username}</div>
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
      <p className="mt-4 text-[11px] leading-relaxed text-on-surface-variant">
        New users sign in with their account and set a PIN on first sign-in. On
        the office network, sign-in will become automatic from the Windows
        account (coming next).
      </p>
    </div>
  );
}
