import { useEffect, useRef, useState } from 'react';
import { api, undoImportRemote } from '../lib/server.js';
import { Icon, Card, Button, Dialog } from './ui.jsx';

// After sign-in: choose Project › Review. Everyone signed in sees every project
// that isn't restricted (and the restricted ones they were given); only admins
// create, rename, delete projects and reviews, and choose who can open a project.
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

  // Admin actions from the row menu: undo the last import, delete.
  const [confirm, setConfirm] = useState(null); // { kind: 'delete'|'undo', row, undo? }
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const askUndo = async (row) => {
    try {
      const cfg = await api.getReviewConfig(row.id);
      if (!cfg.lastImport) { setErr(`Nothing to undo in “${row.name}”.`); return; }
      setConfirm({ kind: 'undo', row, undo: cfg.lastImport });
    } catch { setErr('Could not read the last import.'); }
  };
  const askDelete = (row) => { setTyped(''); setConfirm({ kind: 'delete', row }); };
  const runConfirm = async () => {
    const { kind, row, undo } = confirm;
    setWorking(true);
    try {
      if (kind === 'undo') await undoImportRemote(row.id, undo);
      else if (project) await api.deleteReview(row.id);
      else await api.deleteProject(row.id);
      setConfirm(null);
      await load(project);
    } catch (e) {
      setErr(kind === 'undo' ? 'Could not undo the import.' : e?.code === 409 ? `Could not delete it: ${e.message}.` : `Could not delete the ${project ? 'review' : 'project'}.`);
    } finally {
      setWorking(false);
    }
  };

  // Who can open a project (admin): everyone, or only chosen people.
  const [access, setAccess] = useState(null); // the project row
  const saveAccess = async (row, value) => {
    await api.putProjectAccess(row.id, value);
    await load(project);
  };

  const noun = project ? 'review' : 'project';
  const meta = (row) =>
    project
      ? `${row.comments} comment${row.comments === 1 ? '' : 's'}`
      : `${row.reviews} review${row.reviews === 1 ? '' : 's'}`;
  const lock = (row) => (!project && row.restricted
    ? (isAdmin ? `${row.members} ${row.members === 1 ? 'person' : 'people'}` : 'Restricted')
    : null);

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
                onUndo={project ? () => askUndo(row) : null}
                onDelete={() => askDelete(row)}
                deleteBlocked={!project && row.reviews > 0}
                lock={lock(row)}
                onAccess={!project && isAdmin ? () => setAccess(row) : null}
              />
            ))}
          </ul>
        )}

        {isAdmin && <NewItem key={project?.id ?? 'root'} noun={noun} onCreate={create} />}
        {err && <p className="mt-3 text-xs text-error">{err}</p>}
        <ConfirmDialog confirm={confirm} noun={noun} typed={typed} setTyped={setTyped} working={working}
          onCancel={() => setConfirm(null)} onConfirm={runConfirm} />
        <AccessDialog row={access} me={user} onClose={() => setAccess(null)} onSave={saveAccess} />
      </Card>
    </div>
  );
}

function ConfirmDialog({ confirm, noun, typed, setTyped, working, onCancel, onConfirm }) {
  const row = confirm?.row;
  const isUndo = confirm?.kind === 'undo';
  const u = confirm?.undo;
  const needsName = !isUndo && noun === 'review' && row?.comments > 0;
  const ok = !needsName || typed.trim() === row?.name;
  return (
    <Dialog open={!!confirm} onClose={working ? undefined : onCancel} labelledBy="cf-title" width={460}>
      {row && (
        <>
          <h2 id="cf-title" className="text-lg font-semibold">{isUndo ? `Undo the last import into “${row.name}”?` : noun === 'review' ? `Move “${row.name}” to the Trash?` : `Delete “${row.name}”?`}</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            {isUndo
              ? `Removes the ${u.added?.length || 0} comments it added and puts back what it changed on ${u.restore?.length || 0}. Work done on the added comments is lost.`
              : noun === 'review'
                ? `It and its ${row.comments} comment${row.comments === 1 ? '' : 's'} disappear for everyone. An admin can restore it from the Trash within 30 days.${row.comments > 0 ? ' Type the review name to confirm.' : ''}`
                : 'The empty project is removed for everyone.'}
          </p>
          {needsName && (
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the review name to confirm" placeholder="Type the review name to confirm" data-autofocus
              className="mt-4 block w-full rounded-control border border-outline-variant bg-surface-low px-3 py-2.5 text-sm hover:border-outline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="text" onClick={onCancel} disabled={working}>Cancel</Button>
            <Button variant={isUndo ? 'filled' : 'danger'} onClick={onConfirm} disabled={working || !ok}>
              {working ? 'Working…' : isUndo ? 'Undo import' : noun === 'review' ? 'Move to Trash' : 'Delete project'}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function Row({ row, icon, meta, canEdit, onOpen, onRename, onUndo, onDelete, deleteBlocked, lock, onAccess }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(row.name);
  const inputRef = useRef(null);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const off = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    const esc = (e) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const pick = (fn) => () => { setMenu(false); fn(); };

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
        {lock && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-[12px] font-semibold text-on-surface-variant" title="Only chosen people can open this project">
            <Icon name="lock" className="text-[14px]" />{lock}
          </span>
        )}
        <span className={`text-xs tabular-nums text-on-surface-variant ${canEdit ? 'mr-9' : ''}`}>{meta}</span>
        <Icon name="chevron_right" className="text-[20px] text-on-surface-variant" />
      </button>
      {canEdit && (
        <div ref={menuRef} className="absolute right-11 top-1/2 -translate-y-1/2">
          <button
            onClick={() => setMenu((m) => !m)}
            aria-label={`More for ${row.name}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            title="More"
            className={`t-press flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-high focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 ${menu ? 'bg-surface-high opacity-100' : 'opacity-0'}`}
          >
            <Icon name="more_horiz" className="text-[20px]" />
          </button>
          <div role="menu" className={`t-pop absolute right-0 top-10 z-20 w-56 rounded-[16px] bg-surface p-1.5 ${menu ? 'show' : ''}`}>
            <button role="menuitem" className="t-menuitem" onClick={pick(() => setEditing(true))}><Icon name="edit" className="text-[18px]" />Rename</button>
            {onUndo && <button role="menuitem" className="t-menuitem" onClick={pick(onUndo)}><Icon name="undo" className="text-[18px]" />Undo last import</button>}
            {onAccess && <button role="menuitem" className="t-menuitem" onClick={pick(onAccess)}><Icon name="lock" className="text-[18px]" />Who can open…</button>}
            <button role="menuitem" className="t-menuitem disabled:opacity-50" style={{ color: 'var(--md-sys-color-error)' }} disabled={deleteBlocked} onClick={pick(onDelete)}
              title={deleteBlocked ? 'Delete its reviews (and empty them from the Trash) first' : undefined}>
              <Icon name="delete" className="text-[18px]" />{deleteBlocked ? 'Delete (empty it first)' : 'Delete…'}
            </button>
          </div>
        </div>
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

// Who can open a project: everyone on the server (the default) or only the
// people ticked here. Admins can always open every project.
function AccessDialog({ row, me, onClose, onSave }) {
  const [users, setUsers] = useState(null);
  const [restricted, setRestricted] = useState(false);
  const [members, setMembers] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!row) return;
    setUsers(null); setErr('');
    Promise.all([api.listUsers(), api.getProjectAccess(row.id)])
      .then(([u, a]) => { setUsers(u); setRestricted(a.restricted); setMembers(new Set(a.members)); })
      .catch(() => { setErr('Could not load the people on this server.'); setUsers([]); });
  }, [row]);
  const toggle = (id) => setMembers((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    try { await onSave(row, { restricted, members: restricted ? [...members] : [] }); onClose(); }
    catch { setErr('Could not save who can open it.'); }
    finally { setBusy(false); }
  };
  const option = (value, title, sub) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-control border-[1.5px] px-4 py-3 ${restricted === value ? 'border-primary bg-primary-container/40' : 'border-outline-variant'}`}>
      <input type="radio" name="who" checked={restricted === value} onChange={() => setRestricted(value)} className="mt-1 accent-[var(--md-sys-color-primary)]" />
      <span><span className="block text-sm font-semibold">{title}</span><span className="block text-[13px] text-on-surface-variant">{sub}</span></span>
    </label>
  );
  return (
    <Dialog open={!!row} onClose={busy ? undefined : onClose} labelledBy="who-title" width={480}>
      {row && (
        <>
          <h2 id="who-title" className="text-lg font-semibold">Who can open {row.name}?</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Admins can always open every project.</p>
          <div role="radiogroup" aria-label="Access" className="mt-4 flex flex-col gap-2">
            {option(false, 'Everyone on this server', 'Every signed-in reviewer sees the project.')}
            {option(true, 'Only these people', 'Others won’t see it in their list.')}
          </div>
          {restricted && (
            <div className="mt-3 max-h-64 overflow-auto rounded-control border border-outline-variant">
              {users === null ? <p className="p-4 text-sm text-on-surface-variant">Loading…</p> : users.map((u) => {
                const admin = u.role === 'admin';
                return (
                  <label key={u.id} className={`flex items-center gap-3 border-b border-outline-variant/40 px-4 py-2.5 text-sm last:border-0 ${admin ? 'text-on-surface-variant' : ''}`}>
                    <input type="checkbox" checked={admin || members.has(u.id)} disabled={admin} onChange={() => toggle(u.id)} className="h-4 w-4 accent-[var(--md-sys-color-primary)]" />
                    <span className="min-w-0 flex-1 truncate">{u.displayName || u.username} <span className="text-on-surface-variant">· {u.username}{u.id === me?.id ? ' (you)' : ''}</span></span>
                    <span className="text-[12px] text-on-surface-variant">{admin ? 'Admin · always' : 'Reviewer'}</span>
                  </label>
                );
              })}
            </div>
          )}
          {err && <p className="mt-3 text-xs text-error">{err}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="filled" onClick={save} disabled={busy || users === null}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
