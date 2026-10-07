import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/server.js';
import { Icon, Card, Button } from './ui.jsx';

// After sign-in: choose Project › Review. Everyone signed in sees every project;
// only admins create or rename projects and reviews.
export default function ProjectPicker({ user, initialProject = null, onPick, onSignOut }) {
  const [project, setProject] = useState(initialProject); // null = project list
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const isAdmin = user.role === 'admin';

  const load = async (p = project) => {
    setItems(null);
    setErr('');
    try {
      setItems(p ? await api.listReviews(p.id) : await api.listProjects());
    } catch (e) {
      if (p && e.code === 404) {
        setProject(null); // project was removed — back to the list
        return;
      }
      setErr(p ? 'Could not load reviews.' : 'Could not load projects.');
      setItems([]);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(project); }, [project?.id]);

  const open = (row) => {
    if (project) onPick({ project, review: { id: row.id, name: row.name } });
    else setProject({ id: row.id, name: row.name });
  };

  const create = async (name) => {
    try {
      if (project) {
        const r = await api.createReview(project.id, name);
        onPick({ project, review: { id: r.id, name: r.name } });
      } else {
        const p = await api.createProject(name);
        setProject({ id: p.id, name: p.name });
      }
      return true;
    } catch {
      setErr(project ? 'Could not create the review.' : 'Could not create the project.');
      return false;
    }
  };

  const rename = async (row, name) => {
    try {
      if (project) await api.renameReview(row.id, name);
      else await api.renameProject(row.id, name);
      setItems((list) => list.map((x) => (x.id === row.id ? { ...x, name } : x)));
    } catch {
      setErr('Could not rename.');
    }
  };

  const noun = project ? 'review' : 'project';
  const meta = (row) =>
    project
      ? `${row.comments} comment${row.comments === 1 ? '' : 's'}`
      : `${row.reviews} review${row.reviews === 1 ? '' : 's'}`;

  return (
    <div className="flex min-h-screen items-start justify-center bg-background p-4 pt-[8vh] text-on-surface">
      <Card className="w-full max-w-lg p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {project ? (
              <button
                onClick={() => setProject(null)}
                aria-label="All projects"
                title="All projects"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-on-surface-variant hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name="arrow_back" className="text-[24px]" />
              </button>
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary">
                <Icon name="table_view" className="text-[24px]" />
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight">{project ? project.name : 'Projects'}</div>
              <div className="truncate text-xs text-on-surface-variant">
                {user.displayName || user.username} · {user.role}
              </div>
            </div>
          </div>
          <Button variant="text" onClick={onSignOut}>Sign out</Button>
        </div>

        {items === null ? (
          <p className="py-6 text-center text-sm text-on-surface-variant">Loading…</p>
        ) : items.length === 0 ? (
          <p className="rounded-control bg-surface-container px-4 py-6 text-center text-sm text-on-surface-variant">
            No {noun}s yet.{isAdmin ? ` Create the first one below.` : ' Ask an admin to create one.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((row) => (
              <Row
                key={row.id}
                row={row}
                icon={project ? 'description' : 'folder'}
                meta={meta(row)}
                canEdit={isAdmin}
                onOpen={() => open(row)}
                onRename={(n) => rename(row, n)}
              />
            ))}
          </ul>
        )}

        {isAdmin && <NewItem key={project?.id ?? 'root'} noun={noun} onCreate={create} />}
        {err && <p className="mt-3 text-xs text-error">{err}</p>}
      </Card>
    </div>
  );
}

function Row({ row, icon, meta, canEdit, onOpen, onRename }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(row.name);
  const inputRef = useRef(null);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    const n = val.trim();
    setEditing(false);
    if (n && n !== row.name) onRename(n);
    else setVal(row.name);
  };

  if (editing) {
    return (
      <li className="flex items-center gap-3 rounded-control bg-surface-container px-4 py-2">
        <Icon name={icon} className="text-[22px] text-primary" />
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setVal(row.name); setEditing(false); }
          }}
          aria-label="Name"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm font-medium text-on-surface focus:outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-control border border-outline-variant/50 bg-surface px-4 py-3 text-left hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Icon name={icon} className="text-[22px] text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
        <span className={`text-xs tabular-nums text-on-surface-variant ${canEdit ? 'mr-9' : ''}`}>{meta}</span>
        <Icon name="chevron_right" className="text-[20px] text-on-surface-variant" />
      </button>
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          aria-label={`Rename ${row.name}`}
          title="Rename"
          className="absolute right-11 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant opacity-0 hover:bg-surface-high focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
        >
          <Icon name="edit" className="text-[18px]" />
        </button>
      )}
    </li>
  );
}

function NewItem({ noun, onCreate }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    if (await onCreate(n)) setName('');
    setBusy(false);
  };
  return (
    <div className="mt-5 flex items-end gap-2 border-t border-outline-variant/50 pt-5">
      <label className="flex-1 text-xs font-medium text-on-surface-variant">
        New {noun}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={noun === 'project' ? 'e.g. Tower A' : 'e.g. 90% Model Review'}
          className="mt-1 block w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2.5 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>
      <Button variant="tonal" icon="add" onClick={submit} disabled={busy || !name.trim()}>Create</Button>
    </div>
  );
}
