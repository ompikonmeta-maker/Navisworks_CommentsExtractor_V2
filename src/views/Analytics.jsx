import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from 'recharts';
import { useStore } from '../store/store.jsx';
import { Card, EmptyState, Icon } from '../components/ui.jsx';

// Read MD3 tokens at render time so charts follow the active theme.
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

export default function Analytics() {
  const { status, records } = useStore();
  const loading = status === 'loading';

  const byDiscipline = useMemo(() => {
    const m = {};
    for (const r of records) m[r.discipline] = (m[r.discipline] || 0) + 1;
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [records]);

  const byStatus = useMemo(() => {
    const m = { Open: 0, 'In Review': 0, Closed: 0 };
    for (const r of records) m[r.status] = (m[r.status] || 0) + 1;
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [records]);

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

  if (loading) {
    return (
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-5"><div className="skeleton h-64 w-full rounded" /></Card>
        ))}
      </div>
    );
  }

  if (!records.length) {
    return (
      <div className="mx-auto max-w-6xl">
        <EmptyState icon="insights" title="Belum ada data untuk dianalisis">
          Impor laporan HTML Navisworks untuk melihat tren waktu dan beban disiplin.
        </EmptyState>
      </div>
    );
  }

  const primary = cssVar('--md-sys-color-primary', '#006a6a');
  const grid = cssVar('--md-sys-color-outline-variant', '#bec9c8');
  const axis = cssVar('--md-sys-color-on-surface-variant', '#3f4948');
  const surface = cssVar('--md-sys-color-surface-container-high', '#e3eae9');
  const onSurface = cssVar('--md-sys-color-on-surface', '#161d1d');
  const STATUS_COLORS = {
    Open: cssVar('--tabelin-status-open', '#b3261e'),
    'In Review': cssVar('--tabelin-status-review', '#a9730a'),
    Closed: cssVar('--tabelin-status-closed', '#1f7a4d'),
  };

  const tooltipStyle = {
    background: surface,
    border: `1px solid ${grid}`,
    borderRadius: 8,
    color: onSurface,
    fontSize: 12,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <ChartTitle icon="bar_chart" title="Komentar per disiplin" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byDiscipline} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} />
              <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: `${primary}22` }} />
              <Bar dataKey="value" name="Komentar" fill={primary} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5">
          <ChartTitle icon="donut_large" title="Distribusi status" />
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={byStatus} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                {byStatus.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} stroke={surface} strokeWidth={2} />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 12, color: axis }} />
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-5">
        <ChartTitle icon="timeline" title="Tren komentar per bulan" />
        {overTime.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={overTime} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} />
              <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="value" name="Komentar" stroke={primary} strokeWidth={2.5} dot={{ r: 3, fill: primary }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-10 text-center text-sm text-on-surface-variant">Tanggal komentar tidak dapat diurai untuk tren waktu.</p>
        )}
      </Card>
    </div>
  );
}

function ChartTitle({ icon, title }) {
  return (
    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
      <Icon name={icon} className="text-[20px] text-primary" /> {title}
    </h3>
  );
}
