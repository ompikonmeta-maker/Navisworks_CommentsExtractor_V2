import { useEffect, useState } from 'react';
import { api } from '../lib/server.js';
import { Icon, Card, Button } from './ui.jsx';

// After sign-in: choose which shared review to open (or start a new one).
export default function ProjectPicker({ user, onPick, onSignOut }) {
  const [projects, setProjects] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      setProjects(await api.listProjects());
    } catch {
      setErr('Could not load reviews.');
    }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const p = await api.createProject(n);
      onPick({ id: p.id, name: p.name });
    } catch {
      setErr('Could not create the review.');
      setBusy(false);
    }
  };

  const canCreate = user.role === 'admin' || user.role === 'editor';

  return (
    <div className="flex min-h-screen items-start justify-center bg-background p-4 pt-[8vh] text-on-surface">
      <Card className="w-full max-w-lg p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-control bg-primary text-on-primary">
              <Icon name="table_view" className="text-[24px]" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">Choose a review</div>
              <div className="text-xs text-on-surface-variant">
                Signed in as {user.displayName || user.username} · {user.role}
              </div>
            </div>
          </div>
          <Button variant="text" onClick={onSignOut}>Sign out</Button>
        </div>

        {projects === null ? (
          <p className="py-6 text-center text-sm text-on-surface-variant">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="rounded-control bg-surface-container px-4 py-6 text-center text-sm text-on-surface-variant">
            No reviews yet.{canCreate ? ' Create the first one below.' : ' Ask an editor to create one.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onPick({ id: p.id, name: p.name })}
                  className="flex w-full items-center gap-3 rounded-control border border-outline-variant/50 bg-surface px-4 py-3 text-left hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Icon name="folder_open" className="text-[22px] text-primary" />
                  <span className="flex-1 text-sm font-medium">{p.name}</span>
                  <Icon name="chevron_right" className="text-[20px] text-on-surface-variant" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {canCreate && (
          <div className="mt-5 flex items-end gap-2 border-t border-outline-variant/50 pt-5">
            <label className="flex-1 text-xs font-medium text-on-surface-variant">
              New review
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                placeholder="e.g. Tower A — Round 2"
                className="mt-1 block w-full rounded-control border border-outline bg-surface-container px-3 py-2.5 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
            <Button variant="tonal" icon="upload_file" onClick={create} disabled={busy || !name.trim()}>Create</Button>
          </div>
        )}
        {err && <p className="mt-3 text-xs text-error">{err}</p>}
      </Card>
    </div>
  );
}
