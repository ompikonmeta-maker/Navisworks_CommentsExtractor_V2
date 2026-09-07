import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { DISCIPLINES, STATUSES } from '../lib/parser.js';
import { exportToExcel } from '../lib/excel.js';
import { Icon, Button, Card, Select, StatusBadge, DisciplineBadge, EmptyState } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import DetailPanel from '../components/DetailPanel.jsx';

export default function Comments({ detailId, setDetailId }) {
  const { status, records, toast } = useStore();
  const loading = status === 'loading';

  const [query, setQuery] = useState('');
  const [discipline, setDiscipline] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (discipline !== 'all' && r.discipline !== discipline) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q) {
        const hay = `${r.commentText} ${r.viewpoint} ${r.authorCode} ${r.resolution} ${r.commentId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, query, discipline, statusFilter]);

  const active = detailId != null ? records.find((r) => r.ID === detailId) : null;

  const handleExport = async () => {
    if (!filtered.length) return;
    try {
      await exportToExcel(filtered);
      toast(`Exported ${filtered.length} comments.`, 'success');
    } catch (e) {
      toast(`Export failed: ${e.message}`, 'error');
    }
  };

  const resetFilters = () => {
    setQuery('');
    setDiscipline('all');
    setStatusFilter('all');
  };
  const hasFilters = query || discipline !== 'all' || statusFilter !== 'all';

  return (
    <div className="mx-auto max-w-6xl">
      <Reveal className="space-y-4" deps={[]}>
        {/* Toolbar */}
        <Card className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search comments, viewpoints, authors…"
                aria-label="Search comments"
                className="h-10 w-full rounded-control border border-outline bg-surface-container pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
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
                options={[{ value: 'all', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
              />
              {hasFilters && (
                <Button variant="text" icon="filter_alt_off" onClick={resetFilters}>
                  Reset
                </Button>
              )}
              <Button variant="tonal" icon="download" onClick={handleExport} disabled={!filtered.length}>
                Excel
              </Button>
            </div>
          </div>
          <div className="mt-2 text-xs text-on-surface-variant">
            {loading ? 'Loading…' : `${filtered.length} of ${records.length}`}
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
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-container text-left text-xs uppercase tracking-wide text-on-surface-variant">
                    <th className="px-4 py-3 font-medium">Viewpoint</th>
                    <th className="px-3 py-3 font-medium">Discipline</th>
                    <th className="px-3 py-3 font-medium">Comment</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium whitespace-nowrap">Date</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/50">
                  {filtered.map((r) => (
                    <tr
                      key={r.ID}
                      className="cursor-pointer align-top hover:bg-surface-container/60"
                      onClick={() => setDetailId(r.ID)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {r.imageData ? (
                            <img src={r.imageData} alt="" className="h-9 w-9 rounded-control object-cover" />
                          ) : (
                            <span className="flex h-9 w-9 items-center justify-center rounded-control bg-surface-variant text-on-surface-variant">
                              <Icon name="image_not_supported" className="text-[18px]" />
                            </span>
                          )}
                          <span className="font-medium">{r.viewpoint}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3"><DisciplineBadge discipline={r.discipline} /></td>
                      <td className="px-3 py-3 max-w-md">
                        <span className="line-clamp-2 text-on-surface-variant">{r.commentText}</span>
                      </td>
                      <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-on-surface-variant">{r.commentDate}</td>
                      <td className="px-3 py-3 text-right">
                        <Icon name="chevron_right" className="text-on-surface-variant" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Reveal>

      {active && <DetailPanel record={active} onClose={() => setDetailId(null)} />}
    </div>
  );
}
