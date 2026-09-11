import { useMemo, useRef } from 'react';
import { snapshotNode, nodeToImage } from '../lib/snapshot.js';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList,
  AreaChart, Area,
} from 'recharts';
import { useStore, computeKpis } from '../store/store.jsx';
import { STATUSES } from '../lib/parser.js';
import { exportToExcel } from '../lib/excel.js';
import { ingestFiles } from '../lib/ingest.js';
import { Icon, Button, Card, StatusBadge, DisciplineBadge } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';

const KPI_META = [
  { key: 'total', label: 'Total', icon: 'forum', accent: 'text-primary', status: 'all' },
  { key: 'Open', label: 'Open', icon: 'radio_button_unchecked', accent: 'text-status-open', status: 'Open' },
  { key: 'In Review', label: 'In Review', icon: 'hourglass_top', accent: 'text-status-review', status: 'In Review' },
  { key: 'Closed', label: 'Closed', icon: 'check_circle', accent: 'text-status-closed', status: 'Closed' },
];

// Read MD3 tokens at render time so charts follow the active theme.
function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function toMonth(dateStr) {
  const m = /(\d{4})[/-](\d{1,2})/.exec(dateStr || '');
  if (!m) return 'Unknown';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
}

// Navisworks dates like "2024/12/9 04:0:23" → epoch ms (0 if unparseable).
function parseTs(dateStr) {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}):?(\d{1,2})?)?/.exec(dateStr || '');
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0).getTime();
}

export default function Dashboard({ openDetail, goComments }) {
  const { status, records, meta, notify, setData } = useStore();
  const loading = status === 'loading';
  const fileInputRef = useRef(null);
  // Refs for snapshots (per-card + whole overview) and Excel chart capture.
  const overviewRef = useRef(null);
  const resolutionRef = useRef(null);
  const overtimeRef = useRef(null);
  const disciplineRef = useRef(null);
  const needsRef = useRef(null);
  const recentRef = useRef(null);

  const snap = async (ref, name) => {
    try {
      await snapshotNode(ref.current, name);
    } catch (e) {
      notify(`Snapshot failed: ${e.message}`, 'error');
    }
  };

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
  const total = kpis.total || 0;

  // Per-discipline status breakdown, richest first — feeds both the stacked
  // bar and the numeric table.
  const byDiscipline = useMemo(() => {
    const m = {};
    for (const r of records) {
      const row = m[r.discipline] || (m[r.discipline] = { name: r.discipline, Open: 0, 'In Review': 0, Closed: 0, total: 0 });
      row[r.status] = (row[r.status] || 0) + 1;
      row.total += 1;
    }
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [records]);

  // Monthly intake split by current status — over-time area + KPI sparklines.
  const trend = useMemo(() => {
    const m = {};
    for (const r of records) {
      const key = toMonth(r.commentDate);
      if (key === 'Unknown') continue;
      const row = m[key] || (m[key] = { month: key, Open: 0, 'In Review': 0, Closed: 0 });
      row[r.status] = (row[r.status] || 0) + 1;
    }
    const rows = Object.values(m).sort((a, b) => a.month.localeCompare(b.month));
    const series = {};
    for (const s of STATUSES) series[s] = rows.map((row) => row[s]);
    return { rows, series };
  }, [records]);

  const recent = useMemo(() => records.slice(0, 6), [records]);

  // After-photo coverage: of the closed comments, how many carry an after
  // photo (i.e. the fix is documented).
  const coverage = useMemo(() => {
    const closed = records.filter((r) => r.status === 'Closed');
    const withPhoto = closed.filter((r) => r.afterImageData).length;
    return { closed: closed.length, withPhoto, pct: closed.length ? Math.round((withPhoto / closed.length) * 100) : 0 };
  }, [records]);

  // Needs attention: the oldest still-open comments (by comment date — the
  // export has no close date, so age is measured from when it was raised).
  const needsAttention = useMemo(() => {
    return records
      .filter((r) => r.status === 'Open')
      .map((r) => ({ r, ts: parseTs(r.commentDate) }))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 5)
      .map(({ r, ts }) => ({ ...r, ageDays: ts ? Math.floor((Date.now() - ts) / 86400000) : null }));
  }, [records]);

  const handleExport = async () => {
    if (!records.length) return;
    try {
      notify('Building Excel — rendering charts…', 'info');
      // Capture the on-screen charts as images to embed on the Overview sheet.
      const [resImg, timeImg, discImg] = await Promise.all([
        nodeToImage(resolutionRef.current),
        nodeToImage(overtimeRef.current),
        nodeToImage(disciplineRef.current),
      ]);
      const overview = {
        generatedAt: new Date().toLocaleString(),
        total,
        kpis,
        closedPct,
        coverage,
        byDiscipline,
        trend: trend.rows,
        needsAttention,
        charts: [
          { name: 'Resolution', img: resImg },
          { name: 'Over time', img: timeImg },
          { name: 'By discipline', img: discImg },
        ],
      };
      await exportToExcel(records, { overview });
      notify(`Exported ${records.length} comments with the Overview.`, 'success');
    } catch (e) {
      notify(`Export failed: ${e.message}`, 'error');
    }
  };

  const snapshotOverview = () => snap(overviewRef, 'overview');

  const primary = cssVar('--md-sys-color-primary', '#1768f7');
  const grid = cssVar('--md-sys-color-outline-variant', '#c4c6d0');
  const axis = cssVar('--md-sys-color-on-surface-variant', '#44464f');
  const surface = cssVar('--md-sys-color-surface-container-high', '#e7e7f6');
  const surfaceVar = cssVar('--md-sys-color-surface-variant', '#e1e2ec');
  const onSurface = cssVar('--md-sys-color-on-surface', '#191b23');
  const STATUS_COLORS = {
    Open: cssVar('--tabelin-status-open', '#bf0031'),
    'In Review': cssVar('--tabelin-status-review', '#9a6800'),
    Closed: cssVar('--tabelin-status-closed', '#1f7a4d'),
  };
  const tooltipStyle = { background: surface, border: `1px solid ${grid}`, borderRadius: 12, color: onSurface, fontSize: 12 };
  const closedPct = total ? Math.round((kpis.Closed / total) * 100) : 0;
  const pctColor = (p) => (p >= 60 ? STATUS_COLORS.Closed : p >= 35 ? STATUS_COLORS['In Review'] : STATUS_COLORS.Open);

  return (
    <div ref={overviewRef} className="mx-auto max-w-6xl space-y-6">
      {/* Action bar */}
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-on-surface-variant">
          {loading ? 'Loading…' : `${records.length} review comments · ${meta.source === 'sample' ? 'sample data' : 'imported'}`}
        </div>
        <div className="flex flex-wrap gap-2" data-nosnap>
          <Button variant="tonal" icon="upload_file" onClick={() => fileInputRef.current?.click()}>Import</Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".html,.htm,.jpg,.jpeg,.png,.zip"
            className="hidden"
            onChange={(e) => handleImport(e.target.files)}
          />
          <Button variant="text" icon="image" onClick={snapshotOverview} disabled={!records.length}>Snapshot</Button>
          <Button icon="download" onClick={handleExport} disabled={!records.length}>Excel</Button>
        </div>
      </Card>

      {/* KPI — clickable → Viewpoints filtered; share + sparkline */}
      <Reveal className="grid grid-cols-2 gap-4 lg:grid-cols-4" deps={[status]}>
        {KPI_META.map((k) => {
          const value = kpis[k.key] ?? 0;
          const pct = k.key === 'total' || !total ? null : Math.round((value / total) * 100);
          const spark = k.key === 'total' ? null : trend.series[k.key];
          return (
            <Card key={k.key} className="relative p-5">
              {loading ? (
                <div className="space-y-2"><div className="skeleton h-4 w-20 rounded" /><div className="skeleton h-8 w-16 rounded" /></div>
              ) : (
                <button
                  onClick={() => goComments({ status: k.status, discipline: 'all' })}
                  className="group block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-control -m-1 p-1"
                  title={k.key === 'total' ? 'View all comments' : `Filter Viewpoints: ${k.label}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-on-surface-variant">{k.label}</span>
                    <Icon name={k.icon} className={`text-[20px] ${k.accent}`} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-3xl font-semibold tabular-nums leading-none">{value}</div>
                      <div className="mt-1 text-xs">
                        <span className="text-on-surface-variant group-hover:hidden">{pct == null ? 'all comments' : `${pct}% of total`}</span>
                        <span className="hidden font-semibold text-primary group-hover:inline">{k.key === 'total' ? 'View all →' : 'Filter →'}</span>
                      </div>
                    </div>
                    {spark && <Sparkline values={spark} color={STATUS_COLORS[k.key]} />}
                  </div>
                </button>
              )}
            </Card>
          );
        })}
      </Reveal>

      {/* Resolution ring + over-time (stacked by status) */}
      <Reveal className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]" deps={[status]}>
        <Card ref={resolutionRef} className="relative flex flex-col p-6">
          <SnapButton onClick={() => snap(resolutionRef, 'resolution')} />
          <ChartTitle icon="fact_check" title="Resolution" sub="Closure and after-photo coverage" />
          {loading ? (
            <SkeletonChart />
          ) : (
            <div className="flex flex-1 flex-col justify-center gap-5">
              <div className="flex items-center gap-6">
                <Ring pct={closedPct / 100} color={STATUS_COLORS.Closed} track={surfaceVar} size={176} />
                <ul className="space-y-2.5 text-sm">
                  {[['Closed', kpis.Closed], ['In Review', kpis['In Review']], ['Open', kpis.Open]].map(([s, n]) => (
                    <li key={s} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLORS[s] }} />
                      <span className="text-on-surface-variant">{s}</span>
                      <span className="ml-3 font-semibold tabular-nums">{n || 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-outline-variant/50 pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">After-photo coverage</span>
                  <span className="text-on-surface-variant tabular-nums">{coverage.withPhoto} of {coverage.closed} closed · {coverage.pct}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-variant">
                  <div className="h-full rounded-full" style={{ width: `${coverage.pct}%`, background: STATUS_COLORS.Closed }} />
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card ref={overtimeRef} className="relative p-6">
          <SnapButton onClick={() => snap(overtimeRef, 'over-time')} />
          <ChartTitle icon="timeline" title="Over time" sub="Monthly comments, stacked by current status" />
          {loading ? (
            <SkeletonChart />
          ) : trend.rows.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trend.rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12, color: axis }} />
                {STATUSES.map((s) => (
                  <Area key={s} type="monotone" dataKey={s} stackId="1" stroke={STATUS_COLORS[s]} fill={STATUS_COLORS[s]} fillOpacity={0.22} strokeWidth={2} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-10 text-center text-sm text-on-surface-variant">Dates couldn’t be parsed for a time trend.</p>
          )}
        </Card>
      </Reveal>

      {/* By discipline — stacked bar + numeric table */}
      <Reveal deps={[status]}>
        <Card ref={disciplineRef} className="relative p-6">
          <SnapButton onClick={() => snap(disciplineRef, 'by-discipline')} />
          <ChartTitle icon="bar_chart" title="By discipline" sub="Status mix per discipline — chart and exact numbers side by side" />
          {loading ? (
            <SkeletonChart />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-4 text-xs">
                {STATUSES.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLORS[s] }} /> {s}
                  </span>
                ))}
              </div>
              {/* items-stretch (default) so the chart column takes the table's
                  height; the chart fills it via height="100%". */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="min-h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byDiscipline} margin={{ top: 20, right: 8, bottom: 4, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: `${primary}22` }} />
                    {STATUSES.map((s, i) => (
                      <Bar key={s} dataKey={s} stackId="status" fill={STATUS_COLORS[s]} radius={i === STATUSES.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]} maxBarSize={48}>
                        {/* Total sits above each stacked bar (on the topmost segment). */}
                        {i === STATUSES.length - 1 && (
                          <LabelList dataKey="total" position="top" fill={axis} fontSize={11} fontWeight={600} />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
                </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10.5px] font-semibold uppercase tracking-wide text-on-surface-variant">
                      <th className="pb-2 pr-2 text-left">Discipline</th>
                      <th className="pb-2 text-center">Open</th>
                      <th className="pb-2 text-center">In Review</th>
                      <th className="pb-2 text-center">Closed</th>
                      <th className="pb-2 text-center">Total</th>
                      <th className="pb-2 text-center">% Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDiscipline.map((d) => {
                      const pct = d.total ? Math.round((d.Closed / d.total) * 100) : 0;
                      return (
                        <tr
                          key={d.name}
                          onClick={() => goComments({ discipline: d.name, status: 'all' })}
                          className="cursor-pointer border-t border-outline-variant/50 hover:bg-surface-container"
                          title={`Filter Viewpoints: ${d.name}`}
                        >
                          <td className="py-2 pr-2"><DisciplineBadge discipline={d.name} /></td>
                          <td className="py-2 text-center font-medium tabular-nums text-status-open">{d.Open}</td>
                          <td className="py-2 text-center font-medium tabular-nums text-status-review">{d['In Review']}</td>
                          <td className="py-2 text-center font-medium tabular-nums text-status-closed">{d.Closed}</td>
                          <td className="py-2 text-center font-semibold tabular-nums">{d.total}</td>
                          <td className="py-2 text-center font-bold tabular-nums" style={{ color: pctColor(pct) }}>{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            </>
          )}
        </Card>
      </Reveal>

      {/* Needs attention (oldest open) + Recent */}
      <Reveal className="grid gap-6 lg:grid-cols-2" deps={[status]}>
        <Card ref={needsRef} className="relative p-6">
          <SnapButton onClick={() => snap(needsRef, 'needs-attention')} />
          <ChartTitle icon="hourglass_top" title="Needs attention" sub="Oldest comments still open" />
          {loading ? (
            <SkeletonRows />
          ) : needsAttention.length ? (
            <ul className="divide-y divide-outline-variant/50">
              {needsAttention.map((r) => (
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
                    {r.ageDays != null && (
                      <span className="shrink-0 rounded-full bg-status-open/10 px-2 py-0.5 text-xs font-medium tabular-nums text-status-open">{r.ageDays}d</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-on-surface-variant">Nothing open — all caught up.</p>
          )}
        </Card>

        <Card ref={recentRef} className="relative p-6">
          <SnapButton onClick={() => snap(recentRef, 'recent')} />
          <ChartTitle icon="forum" title="Recent" sub="Latest comments" />
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

// Tiny trend line for a KPI card.
function Sparkline({ values, color }) {
  if (!values || values.length < 2) return null;
  const mx = Math.max(...values);
  if (mx === 0) return null;
  const w = 66;
  const h = 24;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (v / mx) * (h - 3) - 1.5]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

// Donut-style progress ring showing the closed share.
function Ring({ pct, color, track, size = 176 }) {
  const r = 48;
  const cx = 60;
  const cy = 60;
  const C = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={track} strokeWidth="11" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} transform={`rotate(-90 ${cx} ${cy})`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>{Math.round(pct * 100)}%</span>
        <span className="text-xs text-on-surface-variant">closed</span>
      </div>
    </div>
  );
}

// Small "save as image" button pinned to a card's corner. Marked
// [data-nosnap] so it's excluded from the snapshot it triggers.
function SnapButton({ onClick }) {
  return (
    <button
      type="button"
      data-nosnap
      onClick={onClick}
      title="Save as image"
      aria-label="Save as image"
      className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Icon name="image" className="text-[18px]" />
    </button>
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
