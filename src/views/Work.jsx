// =====================================================================
// Work — the one screen where comments get closed (Phase 4, mockup option C
// with option A's headline sentence).
//
//   strip:  the headline sentence · progress · target · import
//   left:   queues — the five Do-next blockers (ranked), then All and Closed
//   middle: the comments of the chosen queue (search, filters, bulk edit, add, export)
//   right:  the selected comment (DetailPanel, docked) — photos, status, fields, history
//
// Every queue count opens exactly the rows it counts (lib/queues.js). Keys:
// J/K move, 1–9 set the status, Ctrl/⌘+Enter next, Ctrl+V pastes a photo.
// Below ~1100 px of width the queues become a row and the detail a drawer.
// =====================================================================
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { useData } from '../data/index.js';
import { statusLabels, openLabel } from '../lib/status.js';
import { DISCIPLINES } from '../lib/parser.js';
import { computeOverview, parseDay, parseTs, startOfDay } from '../lib/overview.js';
import { workQueues, queueFor, firstQueue, filterRecords, toFilter, EMPTY_FILTER } from '../lib/queues.js';
import { headline } from '../lib/headline.js';
import { exportToExcel } from '../lib/excel.js';
import { exportLogSheet } from '../lib/logsheet.js';
import { Icon, Button, Select, StatusBadge, DisciplineBadge, discOptions } from '../components/ui.jsx';
import { Pane, PaneHeader, QueueItem, Kbd, Field } from '../components/primitives.jsx';
import { TipProvider, StatusBar } from '../components/OverviewCharts.jsx';
import DetailPanel from '../components/DetailPanel.jsx';
import ExportButton from '../components/ExportButton.jsx';
import AddCommentDialog from '../components/AddCommentDialog.jsx';
import { useImport } from '../components/ImportAction.jsx';
import { TargetChip } from './Dashboard.jsx';

const NARROW = 1100; // px of Work width below which the panes stack

function fmtDate(raw) {
  const t = parseTs(raw);
  return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : raw || '—';
}

// Width of the Work area and the height left below a pane's top edge.
function useLayout(rootRef, panesRef) {
  const [width, setWidth] = useState(1440);
  const [height, setHeight] = useState(600);
  useLayoutEffect(() => {
    const measure = () => {
      if (rootRef.current) setWidth(rootRef.current.clientWidth);
      if (panesRef.current) setHeight(Math.max(480, window.innerHeight - panesRef.current.getBoundingClientRect().top - 16));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [rootRef, panesRef]);
  return { width, height };
}

export default function Work(props) {
  return <TipProvider><WorkScreen {...props} /></TipProvider>;
}

function WorkScreen({ detailId, setDetailId, initialFilter, goSettings }) {
  const { status, records, meta, notify, removeRecords, bulkUpdate, addRecord, putBack } = useStore();
  const { settings, update } = useSettings();
  const { caps } = useData();
  const canEdit = caps.canReview; // edit / bulk-edit comments
  const canAdmin = caps.canAdmin; // import, add / delete comments, target
  const statuses = settings.statuses;
  const loading = status === 'loading';

  const target = parseDay(settings.reviewTarget);
  const ov = useMemo(() => computeOverview(records, statuses, { target }), [records, statuses, target]);
  const queues = useMemo(() => workQueues(ov, statuses), [ov, statuses]);
  const head = headline(ov);

  // ---- the filter (a queue is just a named filter) ----
  const [filter, setFilterState] = useState(EMPTY_FILTER);
  const started = useRef(false);
  const setFilter = (patch) => setFilterState((f) => toFilter({ ...f, ...patch }));
  const pickQueue = (q) => { setFilterState(toFilter(q.filter)); started.current = true; selectFirst.current = true; };
  // A filter handed in from Insights (or a record opened from there).
  useEffect(() => {
    if (!initialFilter) return;
    setFilterState(toFilter(initialFilter));
    started.current = true;
    selectFirst.current = !initialFilter.keepSelection;
  }, [initialFilter]);
  // A new dataset (first load, an import, Undo, reset): start over on the
  // first queue with work in it. (A refresh from the server keeps `meta`.)
  const lastMeta = useRef(meta);
  useEffect(() => {
    if (lastMeta.current === meta) return;
    lastMeta.current = meta;
    started.current = false;
    setDetailId(null);
  }, [meta, setDetailId]);
  // First load: start on the first queue with work in it.
  useEffect(() => {
    if (started.current || loading || !records.length) return;
    started.current = true;
    if (detailId == null) { setFilterState(toFilter(firstQueue(queues).filter)); selectFirst.current = true; }
  }, [loading, records.length, queues, detailId]);

  const today = startOfDay(Date.now());
  const filtered = useMemo(() => filterRecords(records, filter, statuses, today), [records, filter, statuses, today]);
  const queue = queueFor(queues, filter);
  const commenters = useMemo(() => [...new Set(records.map((r) => r.commenter).filter(Boolean))].sort(), [records]);

  // ---- layout ----
  const rootRef = useRef(null);
  const panesRef = useRef(null);
  const { width, height } = useLayout(rootRef, panesRef);
  const narrow = width < NARROW;

  // ---- selection and moving through the list ----
  // A comment that leaves the queue while open (e.g. it was just closed in
  // "Verify") stays in the detail; next/previous continue from where it was.
  const active = detailId != null ? records.find((r) => r.ID === detailId) || null : null;
  const index = active ? filtered.findIndex((r) => r.ID === active.ID) : -1;
  const anchor = useRef(0);
  if (index >= 0) anchor.current = index;
  const nextRec = index >= 0 ? filtered[index + 1] : filtered[Math.min(anchor.current, filtered.length - 1)];
  const prevRec = index >= 0 ? filtered[index - 1] : filtered[Math.min(anchor.current, filtered.length) - 1];
  const go = useCallback((rec) => { if (rec) setDetailId(rec.ID); }, [setDetailId]);
  const goNext = () => go(nextRec);
  const goPrev = () => go(prevRec);
  const navRef = useRef(null);
  navRef.current = { goNext };

  // Docked: always show a comment — the first of a newly picked queue, or the
  // one that took the place of a deleted comment.
  const selectFirst = useRef(false);
  useEffect(() => {
    if (narrow || loading) return;
    if (selectFirst.current) {
      selectFirst.current = false;
      if (filtered[0]) setDetailId(filtered[0].ID);
      else setDetailId(null);
      anchor.current = 0;
      return;
    }
    if (detailId != null && !active) {
      const n = filtered[Math.min(anchor.current, filtered.length - 1)];
      setDetailId(n ? n.ID : null);
    } else if (detailId == null && filtered[0]) {
      setDetailId(filtered[0].ID);
    }
  }, [filter, filtered, detailId, active, narrow, loading, setDetailId]);

  const [autoNext, setAutoNextState] = useState(() => { try { return localStorage.getItem('tabelin.autoNext') !== '0'; } catch { return true; } });
  const setAutoNext = (v) => { setAutoNextState(v); try { localStorage.setItem('tabelin.autoNext', v ? '1' : '0'); } catch { /* ignore */ } };
  const onClosedOut = () => { if (autoNext) setTimeout(() => navRef.current?.goNext(), 450); };

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"][aria-modal="true"]')) return;
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); goNext(); }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (detailId == null) return;
    document.querySelector(`.wb-row[data-id="${detailId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [detailId]);

  // ---- bulk edit ----
  const [picked, setPicked] = useState(() => new Set());
  useEffect(() => { setPicked(new Set()); }, [filter]);
  const visiblePicked = filtered.filter((r) => picked.has(r.ID));
  const allPicked = filtered.length > 0 && visiblePicked.length === filtered.length;
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(filtered.map((r) => r.ID)));
  const applyBulk = (field, value, label) => {
    if (!value || !visiblePicked.length) return;
    bulkUpdate(visiblePicked.map((r) => r.ID), { [field]: value === '__none' ? '' : value });
    notify(`${label} set on ${visiblePicked.length} comment${visiblePicked.length === 1 ? '' : 's'}.`, 'success');
  };

  // ---- add / delete / export / import ----
  const importer = useImport();
  const [adding, setAdding] = useState(false);
  const addOne = async (rec) => {
    try {
      const r = await addRecord(rec);
      setAdding(false);
      setFilterState(toFilter({}));
      setDetailId(r.ID);
      notify('Comment added.', 'success');
    } catch (e) {
      notify(`Could not add the comment: ${e.message}`, 'error');
    }
  };
  const deleteOne = async (id) => {
    const n = nextRec || prevRec;
    setDetailId(n && n.ID !== id ? n.ID : null);
    try {
      await removeRecords([id]);
      if (!caps.trash) { notify('Comment deleted.', 'success'); return; }
      notify('Comment moved to the Trash.', 'success', {
        label: 'Undo',
        onClick: async () => {
          try { const r = await putBack(id); if (r) setDetailId(r.ID); notify('Comment restored.', 'success'); } catch { notify('Couldn’t restore it. Try the Trash.', 'error'); }
        },
      });
    } catch { /* the store reports it */ }
  };
  const quickExport = async () => {
    if (!filtered.length) return;
    try { await exportToExcel(filtered); notify(`Exported ${filtered.length} comments.`, 'success'); } catch (e) { notify(`Export failed: ${e.message}`, 'error'); }
  };
  const logSheet = async () => {
    try {
      const st = await exportLogSheet(filtered, settings.templateExport);
      notify(`Log sheet ready: ${st.logRows} rows · ${st.images} photo${st.images === 1 ? '' : 's'}.`, 'success');
    } catch (e) {
      if (e.code === 'no-template') notify(e.message, 'info', { label: 'Set up', onClick: () => goSettings?.('template') });
      else notify(`Export failed: ${e.message}`, 'error');
    }
  };

  const filtersOn = filter.query || filter.discipline !== 'all' || filter.status !== 'all' || filter.commenter !== 'all';
  const toneColor = { good: 'var(--tabelin-good)', warn: 'var(--tabelin-warn)', bad: 'var(--tabelin-bad)' }[head.tone];

  // ---------------- pieces ----------------
  const strip = (
    <Pane as="div" className="wb-strip relative z-20 !flex-row !overflow-visible">
      <div className="min-w-0 flex-[999_1_360px]">
        <div className="wb-headline" style={toneColor ? { color: toneColor } : undefined}>{head.main}</div>
        <div className="wb-headline-sub">{head.sub}</div>
      </div>
      <div className="flex min-w-[260px] flex-[1_1_320px] flex-col gap-2">
        <div className="flex items-baseline gap-3 tabular-nums">
          <b className="text-[length:var(--wb-text-2xl)] font-bold leading-none tracking-[-0.02em]">{ov.pct}%</b>
          <span className="text-[length:var(--wb-text-sm)] text-on-surface-variant"><b className="text-on-surface">{ov.done}</b> of {ov.total} {ov.doneL.toLowerCase()}
            {ov.target != null && ov.remaining > 0 && ov.daysLeft > 0 ? <> · <b className="text-on-surface">{ov.daysLeft}</b> days left</> : null}</span>
        </div>
        <StatusBar statuses={statuses} counts={ov.counts} total={ov.total} height={10}
          onPick={(label) => { setFilterState(toFilter({ status: label })); selectFirst.current = true; }} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <TargetChip value={settings.reviewTarget} onChange={(v) => update({ reviewTarget: v })} readOnly={!canAdmin} />
        {canAdmin && <Button variant="text" icon="upload_file" onClick={importer.pick} title="Import a Navisworks report">Import</Button>}
      </div>
    </Pane>
  );

  const queueItems = (row) => (
    <>
      {queues.doNext.map((q, i) => (
        <QueueItem key={q.id} rank={i + 1} label={q.short} title={q.title} n={q.n} on={queue?.id === q.id} onClick={() => pickQueue(q)} />
      ))}
      {!row && <div className="my-2 border-t border-outline-variant/50" />}
      {queues.rest.map((q) => (
        <QueueItem key={q.id} icon={q.icon} label={q.short} title={q.title} n={q.n} on={queue?.id === q.id} onClick={() => pickQueue(q)} />
      ))}
    </>
  );

  const queuePane = narrow ? (
    <Pane as="nav" label="Queues" className="!overflow-visible"><div className="wb-queues-row">{queueItems(true)}</div></Pane>
  ) : (
    <Pane as="nav" label="Queues" style={{ height }}>
      <div className="wb-pane-body flex flex-col gap-1 p-3">
        <div className="wb-label px-2 pb-1 pt-1">Do next</div>
        {queueItems(false)}
        <div className="mt-auto space-y-1.5 px-2 pt-4 text-[length:var(--wb-text-xs)] text-on-surface-variant">
          <div><Kbd>J</Kbd> <Kbd>K</Kbd> move</div>
          <div><Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> status</div>
          <div><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> next</div>
          <div><Kbd>Ctrl</Kbd> <Kbd>V</Kbd> paste a photo</div>
        </div>
      </div>
    </Pane>
  );

  const listPane = (
    <Pane label="Comments in this queue" style={narrow ? { height: Math.max(480, height - 72) } : { height }}>
      <PaneHeader
        title={queue ? queue.title : 'Filtered comments'}
        count={loading ? null : `${filtered.length} comment${filtered.length === 1 ? '' : 's'}`}
        sub={queue ? queue.why : 'Your search and filters. Pick a queue on the left to start over.'}
        right={<>
          {canAdmin && <Button variant="text" icon="add" onClick={() => setAdding(true)} disabled={loading}>Add</Button>}
          <ExportButton quiet onLogSheet={logSheet} onQuick={quickExport} quickNote="The comments shown here" disabled={!filtered.length} />
        </>}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-[1_1_220px]">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
            <Field value={filter.query} onChange={(e) => setFilter({ query: e.target.value })} placeholder="Search comments, viewpoints, commenters…" aria-label="Search comments" className="!pl-9" />
          </div>
          <Select aria-label="Filter by discipline" className="dd-compact" value={filter.discipline} onChange={(v) => setFilter({ discipline: v })}
            options={[{ value: 'all', label: 'All disciplines' }, ...discOptions(DISCIPLINES)]} />
          <Select aria-label="Filter by status" className="dd-compact" value={filter.status} onChange={(v) => setFilter({ status: v })}
            options={[{ value: 'all', label: 'All statuses' }, { value: '!done', label: `Not ${ov.doneL.toLowerCase()}` }, ...(filter.status === '~middle' ? [{ value: '~middle', label: 'Fixed, not verified' }] : []), ...statusLabels(statuses).map((s) => ({ value: s, label: s }))]} />
          <Select aria-label="Filter by commenter" className="dd-compact" value={filter.commenter} onChange={(v) => setFilter({ commenter: v })}
            options={[{ value: 'all', label: 'Any commenter' }, ...commenters.map((c) => ({ value: c, label: c }))]} />
          {filtersOn && <Button variant="text" icon="filter_alt_off" onClick={() => setFilter({ query: '', discipline: 'all', status: queue ? filter.status : 'all', commenter: 'all' })}>Reset</Button>}
        </div>
      </PaneHeader>

      {canEdit && filtered.length > 0 && (
        <label className="flex items-center gap-3 border-b border-outline-variant/40 px-5 py-2 text-[length:var(--wb-text-xs)] text-on-surface-variant">
          <input type="checkbox" aria-label="Select all shown" checked={allPicked}
            ref={(el) => { if (el) el.indeterminate = visiblePicked.length > 0 && !allPicked; }}
            onChange={toggleAll} className="h-4 w-4 cursor-pointer accent-[var(--md-sys-color-primary)]" />
          Select all shown
        </label>
      )}

      <div className="wb-pane-body">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-14 w-full rounded" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-on-surface-variant">
            <Icon name={records.length ? 'check_circle' : 'upload_file'} className="text-[32px] text-primary" />
            <div className="text-[length:var(--wb-text-lg)] font-semibold text-on-surface">{records.length ? (queue ? 'Nothing left in this queue' : 'No matches') : 'No comments yet'}</div>
            <div className="text-[length:var(--wb-text-md)]">{records.length ? (queue ? 'Pick the next queue on the left.' : 'Loosen the search or filters.') : 'Import a Navisworks report to begin.'}</div>
            {!records.length && canAdmin && <Button variant="tonal" icon="upload_file" onClick={importer.pick} className="mt-2">Import a Navisworks report</Button>}
          </div>
        ) : (
          <ol aria-label="Comments">
            {filtered.map((r, i) => (
              <li key={r.ID} data-id={r.ID} data-selected={r.ID === detailId} className="wb-row" style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                onClick={() => setDetailId(r.ID)}>
                {canEdit ? (
                  <input type="checkbox" aria-label={`Select ${r.viewpoint}`} checked={picked.has(r.ID)} onChange={() => toggle(r.ID)} onClick={(e) => e.stopPropagation()}
                    className="mt-1 h-4 w-4 cursor-pointer accent-[var(--md-sys-color-primary)]" />
                ) : <span />}
                <button type="button" className="min-w-0 text-left focus:outline-none" aria-current={r.ID === detailId ? 'true' : undefined}
                  onClick={(e) => { e.stopPropagation(); setDetailId(r.ID); }}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="wb-row-vp">{r.viewpoint}</span>
                    <DisciplineBadge discipline={r.discipline} />
                    <span className="wb-row-meta" title={r.commentDate}>{fmtDate(r.commentDate)}</span>
                  </span>
                  <span className="wb-row-text mt-1">{r.commentText}</span>
                </button>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </Pane>
  );

  const emptyDetail = (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-on-surface-variant">
      <Icon name="fact_check" className="text-[32px] text-primary" />
      <div className="text-[length:var(--wb-text-lg)] font-semibold text-on-surface">No comment selected</div>
      <div className="text-[length:var(--wb-text-md)]">Pick one from the list.</div>
    </div>
  );
  const nav = {
    index: index >= 0 ? index : -1, total: filtered.length, prev: goPrev, next: goNext,
    hasPrev: !!prevRec, hasNext: !!nextRec && nextRec.ID !== detailId, autoNext, setAutoNext,
  };
  const detail = (
    <DetailPanel record={active} docked={!narrow} empty={emptyDetail} onClose={() => setDetailId(null)} onClosedOut={onClosedOut}
      onDelete={canAdmin ? deleteOne : undefined} nav={nav} />
  );

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-[var(--wb-pane-gap)]">
      {strip}
      <div ref={panesRef} className={`wb-panes ${narrow ? 'is-narrow' : ''}`}>
        {queuePane}
        {listPane}
        {narrow ? null : <div style={{ height }} className="min-w-0">{detail}</div>}
      </div>
      {narrow && detail}

      {canEdit && (
        <div className={`t-bulk ${visiblePicked.length ? 'show' : ''}`} role="toolbar" aria-label="Edit selected comments">
          <b className="whitespace-nowrap pl-2 tabular-nums">{visiblePicked.length} selected</b>
          <span className="mx-1 h-5 w-px bg-current opacity-25" />
          <Select className="dd-bar" aria-label="Set discipline" value="" onChange={(v) => applyBulk('discipline', v, 'Discipline')}
            options={[{ value: '', label: 'Discipline' }, ...discOptions(DISCIPLINES)]} />
          <Select className="dd-bar" aria-label="Set status" value="" onChange={(v) => applyBulk('status', v, 'Status')}
            options={[{ value: '', label: 'Status' }, ...statusLabels(statuses).map((x) => ({ value: x, label: x }))]} />
          <Select className="dd-bar" aria-label="Set commenter" value="" onChange={(v) => applyBulk('commenter', v, 'Commenter')}
            options={[{ value: '', label: 'Commenter' }, { value: '__none', label: '— Unassigned —' }, ...commenters.map((c) => ({ value: c, label: c }))]} />
          <button type="button" onClick={() => setPicked(new Set())} className="t-press rounded-full px-3 py-1.5 font-medium text-inverse-primary hover:bg-white/10">Clear</button>
        </div>
      )}

      <AddCommentDialog open={adding} onClose={() => setAdding(false)} onAdd={addOne} records={records}
        customCommenters={settings.customCommenters} openStatus={openLabel(statuses)} />
      {importer.ui}
    </div>
  );
}
