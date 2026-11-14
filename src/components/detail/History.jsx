// Comment history (sources with caps.hasHistory: the server) — who changed
// what, newest first; repeats by the same person within 10 minutes fold.
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../store/settings.jsx';
import { statusColor } from '../../lib/status.js';
import { Icon, discLabel } from '../ui.jsx';
import { useData } from '../../data/index.js';

// "2024-10-07T…" → "2 hours ago" (falls back to a date after a week).
function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- History (server only): who changed what, newest first ----
const SOURCE_KEYS = ['commentRaw', 'commentText', 'viewpoint', 'commentDate', 'authorCode', 'cameraPosition', 'imageRef'];
function describe(ev) {
  const d = ev.detail || {};
  if (ev.action === 'import') return d.source === 'manual' ? 'added this comment' : `imported it${d.source ? ` from ${d.source}` : ''}`;
  if (ev.action === 'photo') return `${d.op === 'remove' ? 'removed' : 'added'} the ${d.kind === 'after' ? 'after' : 'before'}-photo`;
  const f = d.fields || [];
  const parts = [];
  if (f.includes('status')) parts.push(`set status to ${d.status || '—'}`);
  if (f.includes('discipline')) parts.push(`set discipline to ${discLabel(d.discipline)}`);
  if (f.includes('commenter')) parts.push(d.commenter ? `set commenter to ${d.commenter}` : 'cleared the commenter');
  if (f.includes('resolution')) parts.push('wrote the resolution');
  if (f.includes('closedAt') && !f.includes('status')) parts.push('changed the close date');
  if (f.includes('extra')) parts.push('filled in custom fields');
  if (f.some((k) => SOURCE_KEYS.includes(k))) parts.push('updated it from a new report');
  return parts.join(', ') || 'edited it';
}
export default function History({ rec }) {
  const source = useData();
  const { settings } = useSettings();
  const [items, setItems] = useState(null);
  const [all, setAll] = useState(false);
  const lastId = useRef(null);
  const id = rec?.ID;
  useEffect(() => { setItems(null); setAll(false); }, [id]);
  useEffect(() => {
    if (!source.caps.hasHistory || id == null) return undefined;
    let live = true;
    // Wait a moment after an edit so the batched save has reached the server.
    const sameRecord = lastId.current === id;
    lastId.current = id;
    const t = setTimeout(() => { source.history(id).then((x) => live && setItems(x)).catch(() => live && setItems([])); }, sameRecord ? 1500 : 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rec?.changedAt, rec?.imageData, rec?.afterImageData]);
  if (!source.caps.hasHistory) return null;
  // Typing is saved in bursts: fold repeats by the same person within 10 minutes.
  const rows = [];
  for (const ev of items || []) {
    const text = describe(ev);
    const prev = rows[rows.length - 1];
    if (prev && prev.user === ev.user && prev.text === text && Math.abs(Date.parse(prev.at) - Date.parse(ev.at)) < 600000) continue;
    rows.push({ ...ev, text });
  }
  const shown = all ? rows : rows.slice(0, 5);
  const dot = (ev) => (ev.action === 'import' ? 'var(--md-sys-color-outline)' : ev.detail?.status ? statusColor(settings.statuses, ev.detail.status) : 'var(--md-sys-color-primary)');
  return (
    <section aria-label="History">
      <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><Icon name="history" className="text-[18px] text-on-surface-variant" />History</h3>
      {items == null ? <div className="skeleton h-12 w-full rounded-control" /> : rows.length === 0 ? (
        <p className="text-[13px] text-on-surface-variant">No changes recorded yet.</p>
      ) : (
        <ol className="hist space-y-2.5">
          {shown.map((ev, i) => (
            <li key={i} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-2.5 text-[13px]">
              <span className="h-2 w-2 translate-y-[1px] rounded-full" style={{ background: dot(ev) }} />
              <span className="min-w-0"><b className="font-semibold">{ev.user || 'Someone'}</b> {ev.text}</span>
              <span className="whitespace-nowrap text-on-surface-variant" title={new Date(ev.at).toLocaleString()}>{timeAgo(ev.at)}</span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 5 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 rounded-full px-2 py-1 text-[13px] font-medium text-primary hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {all ? 'Show less' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
