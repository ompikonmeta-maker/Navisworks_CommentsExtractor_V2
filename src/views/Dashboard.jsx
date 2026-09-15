import { useEffect, useMemo, useRef, useState } from 'react';
import { snapshotNode, nodeToImage } from '../lib/snapshot.js';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList,
  AreaChart, Area, LineChart, Line,
} from 'recharts';
import { useStore, computeKpis } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { statusLabels, openLabel, doneLabel } from '../lib/status.js';
import { exportToExcel } from '../lib/excel.js';
import { ingestFiles } from '../lib/ingest.js';
import { Icon, Button, Card, StatusBadge, DisciplineBadge, InfoTip } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';

const roleIcon = (role) => (role === 'open' ? 'radio_button_unchecked' : role === 'done' ? 'check_circle' : 'hourglass_top');

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
  const { settings } = useSettings();
  const statuses = settings.statuses;
  const labels = statusLabels(statuses);
  const openL = openLabel(statuses);
  const doneL = doneLabel(statuses);
  const loading = status === 'loading';
  const fileInputRef = useRef(null);
  // Refs for snapshots (per-card + whole overview) and Excel chart capture.
  const overviewRef = useRef(null);
  const resolutionRef = useRef(null);
  const overtimeRef = useRef(null);
  const disciplineRef = useRef(null);
  const needsRef = useRef(null);
  const recentRef = useRef(null);
  // The by-discipline chart matches the numeric table's height so both columns
  // line up top and bottom, whatever the discipline count.
  const discTableRef = useRef(null);
  const [discChartH, setDiscChartH] = useState(300);
  useEffect(() => {
    const el = discTableRef.current;
    if (!el) return undefined;
    // offsetHeight is the untransformed layout height — getBoundingClientRect
    // would report the shrunken size during the card's scale-in animation.
    const measure = () => setDiscChartH(Math.max(240, el.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, records]);

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

  const kpis = useMemo(() => computeKpis(records, labels), [records, labels]);
  const total = kpis.total || 0;
  const zeroByLabel = () => Object.fromEntries(labels.map((l) => [l, 0]));

  // Per-discipline status breakdown, richest first — feeds both the stacked
  // bar and the numeric table.
  const byDiscipline = useMemo(() => {
    const m = {};
    for (const r of records) {
      const row = m[r.discipline] || (m[r.discipline] = { name: r.discipline, ...zeroByLabel(), total: 0 });
      row[r.status] = (row[r.status] || 0) + 1;
      row.total += 1;
    }
    return Object.values(m).sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, labels.join('|')]);

  // Monthly intake split by current status — over-time area + KPI sparklines.
  const trend = useMemo(() => {
    const m = {};
    for (const r of records) {
      const key = toMonth(r.commentDate);
      if (key === 'Unknown') continue;
      const row = m[key] || (m[key] = { month: key, ...zeroByLabel() });
      row[r.status] = (row[r.status] || 0) + 1;
    }
    const rows = Object.values(m).sort((a, b) => a.month.localeCompare(b.month));
    const series = {};
    for (const s of labels) series[s] = rows.map((row) => row[s] || 0);
    return { rows, series };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, labels.join('|')]);

  // Real burndown: cumulative opened (by comment date) vs closed (by close-out
  // time). Closes recorded before v1.1 have no close-out time, so they don't
  // count here — only comments closed in-app going forward do.
  const burndown = useMemo(() => {
    const opened = {};
    const closed = {};
    for (const r of records) {
      const om = toMonth(r.commentDate);
      if (om !== 'Unknown') opened[om] = (opened[om] || 0) + 1;
      if (r.closedAt) {
        const cm = toMonth(r.closedAt);
        if (cm !== 'Unknown') closed[cm] = (closed[cm] || 0) + 1;
      }
    }
    const months = [...new Set([...Object.keys(opened), ...Object.keys(closed)])].sort();
    let oC = 0;
    let cC = 0;
    return months.map((m) => {
      oC += opened[m] || 0;
      cC += closed[m] || 0;
      return { month: m, Opened: oC, Closed: cC, Open: oC - cC };
    });
  }, [records]);
  const [timeView, setTimeView] = useState('intake'); // 'intake' | 'burndown'

  const recent = useMemo(() => records.slice(0, 6), [records]);

  // After-photo coverage: of the closed comments, how many carry an after
  // photo (i.e. the fix is documented).
  const coverage = useMemo(() => {
    const closed = records.filter((r) => r.status === doneL);
    const withPhoto = closed.filter((r) => r.afterImageData).length;
    return { closed: closed.length, withPhoto, pct: closed.length ? Math.round((withPhoto / closed.length) * 100) : 0 };
  }, [records, doneL]);

  // Needs attention: the oldest still-open comments (by comment date — the
  // export has no close date, so age is measured from when it was raised).
  const needsAttention = useMemo(() => {
    return records
      .filter((r) => r.status === openL)
      .map((r) => ({ r, ts: parseTs(r.commentDate) }))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 5)
      .map(({ r, ts }) => ({ ...r, ageDays: ts ? Math.floor((Date.now() - ts) / 86400000) : null }));
  }, [records, openL]);

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
        statuses: labels,
        doneLabel: doneL,
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
  // Colours come straight from the configurable status registry.
  const STATUS_COLORS = Object.fromEntries(statuses.map((s) => [s.label, s.color]));
  const midColor = (statuses.find((s) => s.role === 'middle') || {}).color || axis;
  const tooltipStyle = { background: surface, border: `1px solid ${grid}`, borderRadius: 12, color: onSurface, fontSize: 12 };
  const closedFrac = total ? (kpis[doneL] || 0) / total : 0; // exact fraction for the ring
  const closedPct = Math.round(closedFrac * 100); // rounded, used in the Excel Overview
  const pctColor = (p) => (p >= 60 ? STATUS_COLORS[doneL] : p >= 35 ? midColor : STATUS_COLORS[openL]);

  return (
    <div ref={overviewRef} className="canvas-w space-y-6">
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
        {[{ key: 'total', label: 'Total', icon: 'forum', color: primary, status: 'all' },
          ...statuses.map((s) => ({ key: s.label, label: s.label, icon: roleIcon(s.role), color: s.color, status: s.label }))].map((k) => {
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
                    <span className="truncate text-xs font-medium text-on-surface-variant">{k.label}</span>
                    <Icon name={k.icon} className="shrink-0 text-[20px]" style={{ color: k.color }} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-3xl font-semibold tabular-nums leading-none">{value}</div>
                      <div className="mt-1 text-xs">
                        <span className="text-on-surface-variant group-hover:hidden">{pct == null ? 'all comments' : `${pct}% of total`}</span>
                        <span className="hidden font-semibold text-primary group-hover:inline">{k.key === 'total' ? 'View all →' : 'Filter →'}</span>
                      </div>
                    </div>
                    {spark && <Sparkline values={spark} color={k.color} />}
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
                <Ring pct={closedFrac} color={STATUS_COLORS[doneL]} track={surfaceVar} size={176} />
                <ul className="space-y-2.5 text-sm">
                  {[...statuses].reverse().map((s) => (
                    <li key={s.key} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                      <span className="text-on-surface-variant">{s.label}</span>
                      <span className="ml-3 font-semibold tabular-nums">{kpis[s.label] || 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-outline-variant/50 pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    Photo evidence
                    <InfoTip label="About photo evidence">Of the comments already closed, the share that has an after photo attached as proof of the fix.</InfoTip>
                  </span>
                  <span className="text-on-surface-variant tabular-nums">{coverage.withPhoto} of {coverage.closed} closed · {coverage.pct}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-variant">
                  <div className="h-full rounded-full" style={{ width: `${coverage.pct}%`, background: STATUS_COLORS[doneL] }} />
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card ref={overtimeRef} className="relative p-6">
          <SnapButton onClick={() => snap(overtimeRef, timeView === 'intake' ? 'over-time' : 'burndown')} />
          <ChartTitle
            icon="timeline"
            title="Over time"
            sub={timeView === 'intake' ? 'Monthly comments, stacked by current status' : 'Cumulative opened vs closed — a real burndown, from close-out times'}
          />
          <div className="mb-3 flex gap-1 text-xs" data-nosnap>
            {[['intake', 'Intake'], ['burndown', 'Burndown']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTimeView(v)}
                className={`rounded-full px-3 py-1 font-medium ${timeView === v ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-container'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {loading ? (
            <SkeletonChart />
          ) : timeView === 'intake' ? (
            trend.rows.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={trend.rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} />
                  <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12, color: axis }} />
                  {labels.map((s) => (
                    <Area key={s} type="monotone" dataKey={s} stackId="1" stroke={STATUS_COLORS[s]} fill={STATUS_COLORS[s]} fillOpacity={0.22} strokeWidth={2} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-10 text-center text-sm text-on-surface-variant">Dates couldn’t be parsed for a time trend.</p>
            )
          ) : burndown.length ? (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={burndown} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} />
                  <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12, color: axis }} />
                  <Line type="monotone" dataKey="Opened" name="Opened" stroke={axis} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Closed" name={`${doneL} (cumulative)`} stroke={STATUS_COLORS[doneL]} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="Open" name="Backlog" stroke={STATUS_COLORS[openL]} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              {coverage.closed > 0 && !records.some((r) => r.closedAt) && (
                <p className="mt-2 text-xs text-on-surface-variant">Existing closed comments have no recorded close-out time, so the burndown fills in as you close comments here.</p>
              )}
            </>
          ) : (
            <p className="py-10 text-center text-sm text-on-surface-variant">No dated comments to chart yet.</p>
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
                {statuses.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
                  </span>
                ))}
              </div>
              {/* Chart height is measured from the table so both align top and
                  bottom (see discChartH / discTableRef). */}
              <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
                <ResponsiveContainer width="100%" height={discChartH}>
                  <BarChart data={byDiscipline} margin={{ top: 20, right: 8, bottom: 4, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: `${primary}22` }} />
                    {labels.map((s, i) => (
                      <Bar key={s} dataKey={s} stackId="status" fill={STATUS_COLORS[s]} radius={i === labels.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]} maxBarSize={48}>
                        {/* Total sits above each stacked bar (on the topmost segment). */}
                        {i === labels.length - 1 && (
                          <LabelList dataKey="total" position="top" fill={axis} fontSize={11} fontWeight={600} />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>

              <div className="overflow-x-auto">
                <table ref={discTableRef} className="w-full text-sm">
                  <thead>
                    <tr className="text-[10.5px] font-semibold uppercase tracking-wide text-on-surface-variant">
                      <th className="pb-2 pr-2 text-left">Discipline</th>
                      {statuses.map((s) => <th key={s.key} className="pb-2 text-center">{s.label}</th>)}
                      <th className="pb-2 text-center">Total</th>
                      <th className="pb-2 text-center">% {doneL}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDiscipline.map((d) => {
                      const pct = d.total ? Math.round(((d[doneL] || 0) / d.total) * 100) : 0;
                      return (
                        <tr
                          key={d.name}
                          onClick={() => goComments({ discipline: d.name, status: 'all' })}
                          className="cursor-pointer border-t border-outline-variant/50 hover:bg-surface-container"
                          title={`Filter Viewpoints: ${d.name}`}
                        >
                          <td className="py-2 pr-2"><DisciplineBadge discipline={d.name} /></td>
                          {statuses.map((s) => <td key={s.key} className="py-2 text-center font-medium tabular-nums" style={{ color: s.color }}>{d[s.label] || 0}</td>)}
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
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums" style={{ color: STATUS_COLORS[openL], background: `color-mix(in srgb, ${STATUS_COLORS[openL]} 10%, transparent)` }}>{r.ageDays}d</span>
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
  const rounded = Math.round(pct * 100);
  // Don't read a misleading "0%" when some progress exists; show "<1%".
  const label = pct > 0 && rounded === 0 ? '<1%' : `${rounded}%`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={track} strokeWidth="11" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} transform={`rotate(-90 ${cx} ${cy})`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>{label}</span>
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

// Info "i" that reveals a tooltip on hover/focus (CSS-driven delay + spring).
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
