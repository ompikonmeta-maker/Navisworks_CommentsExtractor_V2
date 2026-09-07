import { useMemo } from 'react';
import { useStore, computeKpis } from '../store/store.jsx';
import { exportToExcel } from '../lib/excel.js';
import { Icon, Button, Card, StatusBadge, DisciplineBadge } from '../components/ui.jsx';

const KPI_META = [
  { key: 'total', label: 'Total Komentar', icon: 'forum', accent: 'text-primary' },
  { key: 'Open', label: 'Open', icon: 'radio_button_unchecked', accent: 'text-status-open' },
  { key: 'In Review', label: 'In Review', icon: 'hourglass_top', accent: 'text-status-review' },
  { key: 'Closed', label: 'Closed', icon: 'check_circle', accent: 'text-status-closed' },
];

export default function Dashboard({ openDetail, go }) {
  const { status, records, meta, toast } = useStore();
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
      toast(`Excel diekspor · ${records.length} komentar.`, 'success');
    } catch (e) {
      toast(`Gagal mengekspor Excel: ${e.message}`, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hero */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-xl font-semibold">Ringkasan review koordinasi</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Komentar review model Navisworks dinormalisasi menjadi daftar yang dapat dicari,
              difilter, dan diekspor. Semua diproses di browser—tidak ada data yang diunggah.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="tonal" icon="upload_file" onClick={() => go('import')}>
              Impor berkas
            </Button>
            <Button icon="download" onClick={handleExport} disabled={!records.length}>
              Export Excel
            </Button>
          </div>
        </div>
      </Card>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {KPI_META.map((k) => (
          <Card key={k.key} className="p-4">
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
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Discipline load */}
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold">Beban per disiplin</h3>
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
                        <DisciplineBadge discipline={disc} /> <span className="text-on-surface-variant">{count}</span>
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
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold">Komentar terbaru</h3>
          {loading ? (
            <SkeletonRows />
          ) : (
            <ul className="divide-y divide-outline-variant/50">
              {recent.map((r) => (
                <li key={r.ID}>
                  <button
                    onClick={() => openDetail(r.ID)}
                    className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-surface-container rounded-md px-2 -mx-2"
                  >
                    <DisciplineBadge discipline={r.discipline} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm">{r.commentText}</span>
                      <span className="text-xs text-on-surface-variant">
                        {r.viewpoint} · {r.commentDate}
                      </span>
                    </span>
                    <StatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {meta.stats && !loading && (
        <p className="text-center text-xs text-on-surface-variant">
          {meta.stats.comments} komentar dari {meta.stats.html} HTML · {meta.stats.linked} gambar tertaut
        </p>
      )}
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
