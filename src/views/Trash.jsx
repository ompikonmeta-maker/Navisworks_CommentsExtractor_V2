// =====================================================================
// Trash (Phase 5) — admins on the server. Deleted comments and reviews stay
// here for 30 days (the server purges them after that): restore them, or
// delete them for good. A comment of a deleted review comes back with its
// review, so it is listed under Reviews only.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useData } from '../data/index.js';
import { fmtStamp } from '../lib/overview.js';
import { Icon, Button, Card, Dialog, SegmentedButtons } from '../components/ui.jsx';

const DAY = 86400000;
const daysLeft = (iso) => {
  const t = Date.parse(iso);
  return t ? Math.max(0, Math.ceil((t - Date.now()) / DAY)) : null;
};
const ago = (iso) => {
  const t = Date.parse(iso);
  if (!t) return '';
  const d = Math.floor((Date.now() - t) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
};

export default function Trash() {
  const source = useData();
  const { notify, putBack } = useStore();
  const [data, setData] = useState(null); // { reviews, records, days }
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('records');
  const [picked, setPicked] = useState(() => new Set());
  const [ask, setAsk] = useState(null); // ids to delete for good
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try { setData(await source.trash()); } catch { setErr('Couldn’t load the Trash.'); setData({ reviews: [], records: [], days: 30 }); }
  }, [source]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPicked(new Set()); }, [tab]);

  const rows = useMemo(() => (data ? (tab === 'records' ? data.records : data.reviews) : []), [data, tab]);
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pick = (ids) => (tab === 'records' ? { records: ids } : { reviews: ids });
  const what = (n) => (tab === 'records' ? `${n} comment${n === 1 ? '' : 's'}` : `${n} review${n === 1 ? '' : 's'}`);

  const restore = async (ids) => {
    setBusy(true);
    try {
      // Comments of the open review come straight back into Work; others on the next refresh.
      const here = source.place?.review?.id;
      const local = tab === 'records' ? data.records.filter((r) => ids.includes(r.id) && r.reviewId === here).map((r) => r.id) : [];
      const elsewhere = ids.filter((id) => !local.includes(id));
      for (const id of local) await putBack(id);
      if (elsewhere.length) await source.restore(pick(elsewhere));
      notify(`Restored ${what(ids.length)}.`, 'success');
      setPicked(new Set());
      await load();
    } catch { notify('Couldn’t restore. Try again.', 'error'); } finally { setBusy(false); }
  };
  const purge = async () => {
    const ids = ask;
    setAsk(null);
    setBusy(true);
    try {
      await source.purge(pick(ids));
      notify(`Deleted ${what(ids.length)} for good.`, 'success');
      setPicked(new Set());
      await load();
    } catch { notify('Couldn’t delete. Try again.', 'error'); } finally { setBusy(false); }
  };

  const nRec = data?.records.length ?? 0;
  const nRev = data?.reviews.length ?? 0;
  const sel = rows.filter((r) => picked.has(r.id)).map((r) => r.id);

  return (
    <div className="canvas-w space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-[999_1_320px]">
            <h2 className="text-[17px] font-semibold">Deleted in the last {data?.days || 30} days</h2>
            <p className="mt-1 text-sm text-on-surface-variant">Restore what was deleted by mistake. After {data?.days || 30} days it is gone for good.</p>
          </div>
          <SegmentedButtons aria-label="Show" value={tab} onChange={setTab}
            options={[{ value: 'records', label: `Comments ${nRec}` }, { value: 'reviews', label: `Reviews ${nRev}` }]} />
        </div>

        {data === null ? (
          <div className="mt-5 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 w-full rounded" />)}</div>
        ) : rows.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-2 rounded-control bg-surface-container px-6 py-10 text-center text-on-surface-variant">
            <Icon name="check_circle" className="text-[28px]" style={{ color: 'var(--tabelin-good)' }} />
            <div className="text-[15px] font-semibold text-on-surface">The Trash is empty</div>
            <div className="text-sm">{tab === 'records' ? 'No deleted comments.' : 'No deleted reviews.'}</div>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" aria-label={tab === 'records' ? 'Deleted comments' : 'Deleted reviews'}>
              <thead>
                <tr className="border-b border-outline-variant/60 text-left text-xs uppercase tracking-wide text-on-surface-variant">
                  <th className="w-10 py-2.5 pl-1"><input type="checkbox" aria-label="Select all" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))} className="h-4 w-4 accent-[var(--md-sys-color-primary)]" /></th>
                  <th className="py-2.5 font-medium">{tab === 'records' ? 'Comment' : 'Review'}</th>
                  <th className="py-2.5 font-medium">Deleted</th>
                  <th className="py-2.5 font-medium">Left</th>
                  <th className="py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const left = daysLeft(r.purgeAt);
                  return (
                    <tr key={r.id} className="border-b border-outline-variant/40 align-top">
                      <td className="py-3 pl-1"><input type="checkbox" aria-label={`Select ${r.viewpoint || r.name}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="mt-0.5 h-4 w-4 accent-[var(--md-sys-color-primary)]" /></td>
                      <td className="max-w-[520px] py-3 pr-4">
                        {tab === 'records' ? (
                          <>
                            <div className="font-semibold">{r.viewpoint || 'Comment'} <span className="font-normal text-on-surface-variant">· {r.projectName} › {r.reviewName}</span></div>
                            <div className="mt-0.5 truncate text-on-surface-variant">{r.commentText}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-semibold">{r.name} <span className="font-normal text-on-surface-variant">· {r.projectName}</span></div>
                            <div className="mt-0.5 text-on-surface-variant">{r.comments} comment{r.comments === 1 ? '' : 's'}</div>
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-[13px] text-on-surface-variant" title={fmtStamp(r.deletedAt)}>{ago(r.deletedAt)}<br />by {r.deletedBy || 'someone'}</td>
                      <td className="whitespace-nowrap py-3 pr-4 text-[13px] font-semibold" style={{ color: left != null && left <= 7 ? 'var(--tabelin-warn)' : 'var(--md-sys-color-on-surface-variant)' }}>
                        {left == null ? '—' : `${left} day${left === 1 ? '' : 's'}`}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right">
                        <Button variant="text" className="!h-9 !px-3" disabled={busy} onClick={() => restore([r.id])}>Restore</Button>
                        <button type="button" disabled={busy} onClick={() => setAsk([r.id])}
                          className="t-press h-9 rounded-control px-3 text-sm font-medium text-on-surface-variant hover:bg-surface-container hover:text-error disabled:opacity-40">Delete for good</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-on-surface-variant">
            <span>{sel.length ? `${sel.length} selected` : 'Tick rows to restore or delete several at once.'}</span>
            <span className="flex-1" />
            <Button variant="text" className="!h-9" disabled={busy || !sel.length} onClick={() => restore(sel)}>Restore selected</Button>
            <button type="button" disabled={busy || !sel.length} onClick={() => setAsk(sel)}
              className="t-press h-9 rounded-control px-3 text-sm font-medium text-error hover:bg-error/10 disabled:opacity-40">Delete selected for good</button>
          </div>
        )}
        {err && <p className="mt-3 text-xs text-error">{err}</p>}
      </Card>

      <Dialog open={!!ask} onClose={() => setAsk(null)} labelledBy="purge-title" width={440}>
        <h2 id="purge-title" className="text-lg font-semibold">Delete {ask ? what(ask.length) : ''} for good?</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          {tab === 'reviews' ? 'The reviews, all their comments and photos are removed.' : 'The comments and their photos are removed.'} This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="text" onClick={() => setAsk(null)}>Cancel</Button>
          <Button variant="danger" onClick={purge}>Delete for good</Button>
        </div>
      </Dialog>
    </div>
  );
}
