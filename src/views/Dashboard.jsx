import { useMemo } from 'react';
import { useStore, computeKpis } from '../store/store.jsx';
import { exportToExcel } from '../lib/excel.js';
import { Icon, Button, Card, StatusBadge, DisciplineBadge } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';

const KPI_META = [
  { key: 'total', label: 'Total', icon: 'forum', accent: 'text-primary' },
  { key: 'Open', label: 'Open', icon: 'radio_button_unchecked', accent: 'text-status-open' },
  { key: 'In Review', label: 'In Review', icon: 'hourglass_top', accent: 'text-status-review' },
  { key: 'Closed', label: 'Closed', icon: 'check_circle', accent: 'text-status-closed' },
];

export default function Dashboard({ openDetail, go }) {
  const { status, records, meta, notify } = useStore();
  const loading = status === 'loading';

  const kpis = useMemo(() => computeKpis(records), [records]);
  const topDisciplines = useMemo(() => {
    const m = {};
    for (const r of records) m[r.discipline] = (m[r.discipline] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [records]);
  const recent = useMemo(() => records.slice(0, 6), [records]);

  const handleExport = async () => {
    if (!records.length) return;
    try {
      await exportToExcel(records);
      notify(`Exported ${records.length} comments.`, 'success');
    } catch (e) {
      notify(`Export failed: ${e.message}`, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Action bar */}
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-on-surface-variant">
          {loading ? 'Loading…' : `${records.length} review comments · ${meta.source === 'sample' ? 'sample data' : 'imported'}`}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="tonal" icon="upload_file" onClick={() => go('import')}>
            Import
          </Button>
          <Button icon="download" onClick={handleExport} disabled={!records.length}>
            Excel
          </Button>
        </div>
      </Card>

      {/* KPI */}
      <Reveal className="grid grid-cols-2 gap-4 lg:grid-cols-4" deps={[status]}>
        {KPI_META.map((k) => (
          <Card key={k.key} className="p-5">
            {loading ? (
              <div className="space-y-2">
                <div className="skeleton h-4 w-20 rounded" />
                <div className="skeleton h-8 w-16 rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-on-surface-variant">{k.label}</span>
                  <Icon name={k.icon} className={`text-[20px] ${k.accent}`} />
                </div>
                <div className="mt-2 text-3xl font-semibold tabular-nums">{kpis[k.key] ?? 0}</div>
              </>
            )}
          </Card>
        ))}
      </Reveal>

      <Reveal className="grid gap-6 lg:grid-cols-2" deps={[status]}>
        {/* Discipline load */}
        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold">By discipline</h3>
          {loading ? (
            <SkeletonRows />
          ) : (
            <ul className="space-y-3">
              {topDisciplines.map(([disc, count]) => {
                const pct = kpis.total ? Math.round((count / kpis.total) * 100) : 0;
                return (
                  <li key={disc}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <DisciplineBadge discipline={disc} /> <span className="text-on-surface-variant tabular-nums">{count}</span>
                      </span>
                      <span className="text-xs text-on-surface-variant tabular-nums">{pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-variant">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Recent comments */}
        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold">Recent</h3>
          {loading ? (
            <SkeletonRows />
          ) : (
            <ul className="divide-y divide-outline-variant/50">
              {recent.map((r) => (
                <li key={r.ID}>
                  <button
                    onClick={() => openDetail(r.ID)}
                    className="flex w-full items-start gap-3 rounded-control px-2 -mx-2 py-2.5 text-left hover:bg-surface-container"
                  >
                    <DisciplineBadge discipline={r.discipline} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm">{r.commentText}</span>
                      <span className="text-xs text-on-surface-variant">{r.viewpoint} · {r.commentDate}</span>
                    </span>
                    <StatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Reveal>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton h-8 w-full rounded" />
      ))}
    </div>
  );
}
