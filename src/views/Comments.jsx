import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { statusLabels, doneLabel } from '../lib/status.js';
import { DISCIPLINES } from '../lib/parser.js';
import { exportToExcel } from '../lib/excel.js';
import { Icon, Button, Card, Select, StatusBadge, DisciplineBadge, EmptyState } from '../components/ui.jsx';
import DetailPanel from '../components/DetailPanel.jsx';
import ExportButton from '../components/ExportButton.jsx';
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
  const { status, records, notify } = useStore();
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
                    className={`vp-row ${r.ID === detailId ? 'selected' : ''}`}
                    onClick={() => setDetailId(r.ID)}
                  >
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

      <DetailPanel record={active} onClose={() => setDetailId(null)} />
    </div>
  );
}
