import { useMemo, useRef } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
  LineChart, Line,
} from 'recharts';
import { useStore, computeKpis } from '../store/store.jsx';
import { STATUSES } from '../lib/parser.js';
import { exportToExcel } from '../lib/excel.js';
import { ingestFiles } from '../lib/ingest.js';
import { Icon, Button, Card, StatusBadge, DisciplineBadge } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';

const KPI_META = [
  { key: 'total', label: 'Total', icon: 'forum', accent: 'text-primary' },
  { key: 'Open', label: 'Open', icon: 'radio_button_unchecked', accent: 'text-status-open' },
  { key: 'In Review', label: 'In Review', icon: 'hourglass_top', accent: 'text-status-review' },
  { key: 'Closed', label: 'Closed', icon: 'check_circle', accent: 'text-status-closed' },
];

// Read MD3 tokens at render time so the charts follow the active theme.
function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Parse Navisworks dates like "2024/12/9 04:0:23" → "YYYY-MM".
function toMonth(dateStr) {
  const m = /(\d{4})[/-](\d{1,2})/.exec(dateStr || '');
  if (!m) return 'Unknown';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
}

export default function Dashboard({ openDetail }) {
  const { status, records, meta, notify, setData } = useStore();
  const loading = status === 'loading';
  const fileInputRef = useRef(null);

  const handleImport = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      const { records: recs, stats, errors } = await ingestFiles(files);
      if (recs.length === 0) {
        notify(errors[0] || 'No comments could be imported.', 'error');
      } else {
        setData(recs, 'user', stats);
        notify(`Imported ${stats.comments} comments from ${stats.html} HTML · ${stats.linked} images linked.`, 'success');
      }
    } catch (e) {
      notify(`Import failed: ${e.message}`, 'error');
    }
  };

  const kpis = useMemo(() => computeKpis(records), [records]);

  // One row per discipline holding its per-status counts, for the stacked bars.
  const byDiscipline = useMemo(() => {
    const m = {};
    for (const r of records) {
      const row = m[r.discipline] || (m[r.discipline] = { name: r.discipline, Open: 0, 'In Review': 0, Closed: 0, total: 0 });
      row[r.status] = (row[r.status] || 0) + 1;
      row.total += 1;
    }
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [records]);

  const byStatus = useMemo(
    () => STATUSES.map((name) => ({ name, value: kpis[name] || 0 })),
    [kpis]
  );

  const overTime = useMemo(() => {
    const m = {};
    for (const r of records) {
      const key = toMonth(r.commentDate);
      m[key] = (m[key] || 0) + 1;
    }
    return Object.entries(m)
      .filter(([k]) => k !== 'Unknown')
      .map(([month, value]) => ({ month, value }))
      .sort((a, b) => a.month.localeCompare(b.month));
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

  const primary = cssVar('--md-sys-color-primary', '#1768f7');
  const grid = cssVar('--md-sys-color-outline-variant', '#c4c6d0');
  const axis = cssVar('--md-sys-color-on-surface-variant', '#44464f');
  const surface = cssVar('--md-sys-color-surface-container-high', '#e7e7f6');
  const surfaceLow = cssVar('--md-sys-color-surface-low', '#f2f3fb');
  const onSurface = cssVar('--md-sys-color-on-surface', '#191b23');
  const STATUS_COLORS = {
    Open: cssVar('--tabelin-status-open', '#bf0031'),
    'In Review': cssVar('--tabelin-status-review', '#9a6800'),
    Closed: cssVar('--tabelin-status-closed', '#1f7a4d'),
  };
  const tooltipStyle = { background: surface, border: `1px solid ${grid}`, borderRadius: 12, color: onSurface, fontSize: 12 };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Action bar */}
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-on-surface-variant">
          {loading ? 'Loading…' : `${records.length} review comments · ${meta.source === 'sample' ? 'sample data' : 'imported'}`}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="tonal" icon="upload_file" onClick={() => fileInputRef.current?.click()}>
            Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".html,.htm,.jpg,.jpeg,.png,.zip"
            className="hidden"
            onChange={(e) => handleImport(e.target.files)}
          />
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

      {/* Discipline (stacked) + status donut */}
      <Reveal className="grid gap-6 lg:grid-cols-2" deps={[status]}>
        <Card className="p-6">
          <ChartTitle icon="bar_chart" title="By discipline" sub="Open · In Review · Closed, stacked per discipline" />
          {loading ? (
            <SkeletonChart />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byDiscipline} margin={{ top: 16, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} interval={0} />
                <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: `${primary}22` }} />
                <Legend wrapperStyle={{ fontSize: 12, color: axis }} />
                {STATUSES.map((s, i) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    stackId="status"
                    fill={STATUS_COLORS[s]}
                    radius={i === STATUSES.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                    maxBarSize={48}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-6">
          <ChartTitle icon="donut_large" title="Status" sub="Resolution mix" />
          {loading ? (
            <SkeletonChart />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={byStatus} dataKey="value" nameKey="name" innerRadius={64} outerRadius={104} paddingAngle={2}>
                  {byStatus.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} stroke={surfaceLow} strokeWidth={2} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 12, color: axis }} />
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </Reveal>

      {/* Over time */}
      <Reveal deps={[status]}>
        <Card className="p-6">
          <ChartTitle icon="timeline" title="Over time" sub="Comments per month" />
          {loading ? (
            <SkeletonChart />
          ) : overTime.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={overTime} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" name="Comments" stroke={primary} strokeWidth={2.5} dot={{ r: 3, fill: primary }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-10 text-center text-sm text-on-surface-variant">Dates couldn’t be parsed for a time trend.</p>
          )}
        </Card>
      </Reveal>

      {/* Recent comments */}
      <Reveal deps={[status]}>
        <Card className="p-6">
          <ChartTitle icon="fact_check" title="Recent" />
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

function ChartTitle({ icon, title, sub }) {
  return (
    <div className="mb-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon name={icon} className="text-[20px] text-primary" /> {title}
      </h3>
      {sub && <p className="mt-0.5 pl-7 text-xs text-on-surface-variant">{sub}</p>}
    </div>
  );
}

function SkeletonChart() {
  return <div className="skeleton h-64 w-full rounded" />;
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
