import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { statusLabels, doneLabel } from '../lib/status.js';
import { DISCIPLINES } from '../lib/parser.js';
import { exportToExcel } from '../lib/excel.js';
import { Icon, Button, Card, Select, StatusBadge, DisciplineBadge, EmptyState } from '../components/ui.jsx';
import DetailPanel from '../components/DetailPanel.jsx';
import ExportButton from '../components/ExportButton.jsx';
import { isReadOnly } from '../lib/server.js';
import { exportLogSheet } from '../lib/logsheet.js';
import { parseTs } from '../lib/overview.js';

// "2024/12/9 04:0:23" → "9 Dec 2024"; the raw stamp stays in the tooltip.
function fmtCommentDate(raw) {
  const t = parseTs(raw);
  return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : raw || '—';
}

function FilterChip({ on, onClick, icon, label, count }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`t-press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container text-on-surface-variant hover:text-on-surface'}`}>
      <Icon name={on ? 'check' : icon} className="text-[16px]" />{label}<b className="tabular-nums">{count}</b>
    </button>
  );
}

export default function Comments({ detailId, setDetailId, initialFilter, goSettings }) {
  const { status, records, notify, removeRecords, bulkUpdate } = useStore();
  const canEdit = !isReadOnly();
  const { settings } = useSettings();
  const loading = status === 'loading';

  const [query, setQuery] = useState('');
  const [discipline, setDiscipline] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); // a label, 'all' or '!done'
  const [commenter, setCommenter] = useState('all');
  const [noPhoto, setNoPhoto] = useState(false);
  const [noRes, setNoRes] = useState(false);
  const [old, setOld] = useState(false);
  const doneL = doneLabel(settings.statuses);

  // Apply a filter handed in from Overview. Anything it doesn't name is
  // cleared, so the list shows exactly the counted set. The object carries a
  // nonce so re-clicking the same target re-applies.
  useEffect(() => {
    if (!initialFilter) return;
    setQuery('');
    setStatusFilter(initialFilter.status ?? 'all');
    setDiscipline(initialFilter.discipline ?? 'all');
    setCommenter(initialFilter.commenter ?? 'all');
    setNoPhoto(!!initialFilter.noPhoto);
    setNoRes(!!initialFilter.noRes);
    setOld(!!initialFilter.old);
  }, [initialFilter]);

  // Search + dropdowns first; the chips then narrow that (their counts are
  // taken from this base so each chip says what it would show).
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (discipline !== 'all' && r.discipline !== discipline) return false;
      if (statusFilter === '!done' ? r.status === doneL : statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (commenter !== 'all' && (r.commenter || '') !== commenter) return false;
      if (q) {
        const hay = `${r.commentText} ${r.viewpoint} ${r.authorCode} ${r.commenter || ''} ${r.resolution} ${r.commentId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, query, discipline, statusFilter, commenter, doneL]);
  const lacksPhoto = (r) => !r.afterImageData;
  const lacksRes = (r) => !String(r.resolution || '').trim();
  const isOld = (r) => {
    if (r.status === doneL) return false;
    const t = parseTs(r.commentDate);
    return t != null && Date.now() - t > 90 * 86400000;
  };
  const filtered = useMemo(() => base.filter((r) => {
    // the two evidence chips widen each other: missing either one
    if ((noPhoto || noRes) && !((noPhoto && lacksPhoto(r)) || (noRes && lacksRes(r)))) return false;
    if (old && !isOld(r)) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [base, noPhoto, noRes, old, doneL]);
  const chipCount = useMemo(() => ({
    noPhoto: base.filter(lacksPhoto).length,
    noRes: base.filter(lacksRes).length,
    old: base.filter(isOld).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [base, doneL]);
  const commenters = useMemo(() => [...new Set(records.map((r) => r.commenter).filter(Boolean))].sort(), [records]);

  const active = detailId != null ? records.find((r) => r.ID === detailId) : null;

  // Move through the filtered list from the drawer: buttons, J/K, and
  // optionally the next comment after one is closed.
  const index = active ? filtered.findIndex((r) => r.ID === active.ID) : -1;
  const go = (d) => { const n = filtered[index + d]; if (n) setDetailId(n.ID); };
  const [autoNext, setAutoNextState] = useState(() => { try { return localStorage.getItem('tabelin.autoNext') !== '0'; } catch { return true; } });
  const setAutoNext = (v) => { setAutoNextState(v); try { localStorage.setItem('tabelin.autoNext', v ? '1' : '0'); } catch { /* ignore */ } };
  const onClosedOut = (id) => {
    if (!autoNext) return;
    const i = filtered.findIndex((r) => r.ID === id);
    const n = filtered[i + 1];
    if (n) setTimeout(() => setDetailId(n.ID), 450);
  };
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"][aria-modal="true"]')) return;
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); go(1); }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Keep the open row in view while stepping through.
  useEffect(() => {
    if (detailId == null) return;
    document.querySelector(`tr[data-id="${detailId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [detailId]);
  // Bulk edit: tick rows, then set a field for all of them from the bar.
  const [picked, setPicked] = useState(() => new Set());
  useEffect(() => { setPicked(new Set()); }, [query, discipline, statusFilter, commenter, noPhoto, noRes, old]);
  const visiblePicked = filtered.filter((r) => picked.has(r.ID));
  const allPicked = filtered.length > 0 && visiblePicked.length === filtered.length;
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(filtered.map((r) => r.ID)));
  const applyBulk = (field, value, label) => {
    if (!value || !visiblePicked.length) return;
    bulkUpdate(visiblePicked.map((r) => r.ID), { [field]: value === '__none' ? '' : value });
    notify(`${label} set on ${visiblePicked.length} comment${visiblePicked.length === 1 ? '' : 's'}.`, 'success');
  };

  const deleteOne = async (id) => {
    const n = filtered[index + 1] || filtered[index - 1];
    setDetailId(n && n.ID !== id ? n.ID : null);
    try { await removeRecords([id]); notify('Comment deleted.', 'success'); } catch { /* store reports it */ }
  };

  const handleExport = async () => {
    if (!filtered.length) return;
    try {
      await exportToExcel(filtered);
      notify(`Exported ${filtered.length} comments.`, 'success');
    } catch (e) {
      notify(`Export failed: ${e.message}`, 'error');
    }
  };

  const logSheet = async () => {
    try {
      const st = await exportLogSheet(filtered, settings.templateExport);
      notify(`Log sheet ready: ${st.logRows} rows · ${st.images} photos.`, 'success');
    } catch (e) {
      if (e.code === 'no-template') notify(e.message, 'info', { label: 'Set up', onClick: () => goSettings?.('template') });
      else notify(`Export failed: ${e.message}`, 'error');
    }
  };

  const resetFilters = () => {
    setQuery('');
    setDiscipline('all');
    setStatusFilter('all');
    setCommenter('all');
    setNoPhoto(false);
    setNoRes(false);
    setOld(false);
  };
  const hasFilters = query || discipline !== 'all' || statusFilter !== 'all' || commenter !== 'all' || noPhoto || noRes || old;

  return (
    <div className="canvas-w space-y-4">
      {/* Toolbar */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search comments, viewpoints, commenters…"
              aria-label="Search comments"
              className="h-10 w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline pl-10 pr-24 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums text-on-surface-variant" aria-live="polite">
              {loading ? '' : filtered.length === records.length ? records.length : `${filtered.length} / ${records.length}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Filter by discipline"
              value={discipline}
              onChange={setDiscipline}
              options={[{ value: 'all', label: 'All disciplines' }, ...DISCIPLINES.map((d) => ({ value: d, label: d }))]}
            />
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[{ value: 'all', label: 'All statuses' }, { value: '!done', label: `Not ${doneL.toLowerCase()}` }, ...statusLabels(settings.statuses).map((s) => ({ value: s, label: s }))]}
            />
            {hasFilters && (
              <Button variant="text" icon="filter_alt_off" onClick={resetFilters}>
                Reset
              </Button>
            )}
            <ExportButton onLogSheet={logSheet} onQuick={handleExport} quickNote="The comments shown here" disabled={!filtered.length} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilterChip on={noPhoto} onClick={() => setNoPhoto((v) => !v)} icon="no_photography" label="No after-photo" count={chipCount.noPhoto} />
          <FilterChip on={noRes} onClick={() => setNoRes((v) => !v)} icon="description" label="No resolution" count={chipCount.noRes} />
          <FilterChip on={old} onClick={() => setOld((v) => !v)} icon="hourglass_bottom" label={`Not ${doneL.toLowerCase()} > 3 months`} count={chipCount.old} />
          <Select
            className={`dd-chip ${commenter !== 'all' ? 'is-on' : ''}`}
            aria-label="Filter by commenter"
            value={commenter}
            onChange={setCommenter}
            options={[{ value: 'all', label: 'Any commenter' }, ...commenters.map((c) => ({ value: c, label: c }))]}
          />
        </div>
      </Card>

      {/* Table */}
      {loading ? (
        <Card className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-11 w-full rounded" />
          ))}
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="search_off"
          title="No matches"
          action={hasFilters ? <Button variant="tonal" onClick={resetFilters}>Reset filters</Button> : null}
        >
          {hasFilters ? 'Loosen the query or filters to see more.' : 'Import a Navisworks HTML report to begin.'}
        </EmptyState>
      ) : (
        <Card className="table-fade overflow-hidden">
          {/* Internal scroll region → the header row stays frozen while rows scroll */}
          <div className="max-h-[calc(100vh_-_14rem)] overflow-auto">
            <table className="vp-table text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-on-surface-variant">
                  {canEdit && (
                    <th className="w-10 py-3 pl-4 pr-0">
                      <input type="checkbox" aria-label="Select all shown" checked={allPicked}
                        ref={(el) => { if (el) el.indeterminate = visiblePicked.length > 0 && !allPicked; }}
                        onChange={toggleAll} className="h-4 w-4 cursor-pointer accent-[var(--md-sys-color-primary)]" />
                    </th>
                  )}
                  <th className="px-4 py-3 font-medium">Viewpoint</th>
                  <th className="px-3 py-3 font-medium">Discipline</th>
                  <th className="px-3 py-3 font-medium">Comment</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 pr-5 font-medium whitespace-nowrap">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.ID}
                    data-id={r.ID}
                    className={`vp-row ${r.ID === detailId ? 'selected' : ''}`}
                    onClick={() => setDetailId(r.ID)}
                  >
                    {canEdit && (
                      <td className="w-10 py-3 pl-4 pr-0" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${r.viewpoint}`} checked={picked.has(r.ID)} onChange={() => toggle(r.ID)}
                          className="h-4 w-4 cursor-pointer accent-[var(--md-sys-color-primary)]" />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.imageData ? (
                          <img src={r.imageData} alt="" className="h-9 w-12 shrink-0 rounded-[10px] object-cover" />
                        ) : (
                          <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-[10px] bg-surface-container text-on-surface-variant/70">
                            <Icon name="image_not_supported" className="text-[17px]" />
                          </span>
                        )}
                        <span className="whitespace-nowrap font-medium">{r.viewpoint}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3"><DisciplineBadge discipline={r.discipline} /></td>
                    <td className="px-3 py-3 max-w-md">
                      <span className="line-clamp-2 text-on-surface-variant">{r.commentText}</span>
                    </td>
                    <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-3 pr-5 whitespace-nowrap text-[13px] tabular-nums text-on-surface-variant" title={r.commentDate}>{fmtCommentDate(r.commentDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canEdit && (
        <div className={`t-bulk ${visiblePicked.length ? 'show' : ''}`} role="toolbar" aria-label="Edit selected comments">
          <b className="whitespace-nowrap pl-2 tabular-nums">{visiblePicked.length} selected</b>
          <span className="mx-1 h-5 w-px bg-current opacity-25" />
          <Select className="dd-bar" aria-label="Set discipline" value="" onChange={(v) => applyBulk('discipline', v, 'Discipline')}
            options={[{ value: '', label: 'Discipline' }, ...DISCIPLINES.map((d) => ({ value: d, label: d }))]} />
          <Select className="dd-bar" aria-label="Set status" value="" onChange={(v) => applyBulk('status', v, 'Status')}
            options={[{ value: '', label: 'Status' }, ...statusLabels(settings.statuses).map((x) => ({ value: x, label: x }))]} />
          <Select className="dd-bar" aria-label="Set commenter" value="" onChange={(v) => applyBulk('commenter', v, 'Commenter')}
            options={[{ value: '', label: 'Commenter' }, { value: '__none', label: '— Unassigned —' }, ...commenters.map((c) => ({ value: c, label: c }))]} />
          <button type="button" onClick={() => setPicked(new Set())} className="t-press rounded-full px-3 py-1.5 font-medium text-inverse-primary hover:bg-white/10">Clear</button>
        </div>
      )}

      <DetailPanel record={active} onClose={() => setDetailId(null)} onClosedOut={onClosedOut} onDelete={deleteOne}
        nav={{ index, total: filtered.length, prev: () => go(-1), next: () => go(1), autoNext, setAutoNext }} />
    </div>
  );
}
