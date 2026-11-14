import { useEffect, useMemo, useRef, useState } from 'react';
import { snapshotNode, nodeToImage } from '../lib/snapshot.js';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { statusLabels } from '../lib/status.js';
import { exportToExcel } from '../lib/excel.js';
import { useData } from '../data/index.js';
import { useImport } from '../components/ImportAction.jsx';
import { workQueues } from '../lib/queues.js';
import ExportButton from '../components/ExportButton.jsx';
import { exportLogSheet } from '../lib/logsheet.js';
import { computeOverview, parseDay, parseTs } from '../lib/overview.js';
import { Icon, Button, Card, InfoTip } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import {
  TipProvider, TipRows, useTipProps, StatusBar, ForecastRunway, BurnUp, WeeklyPace, PaceHeadline, PaceCoverage, Pipeline, AgeHeatmap, RaisedBy,
  VERDICT, tint, hatch, discName, discCode, fmtDay, fmtDayY,
} from '../components/OverviewCharts.jsx';

const toMonth = (s) => { const m = /(\d{4})[/-](\d{1,2})/.exec(s || ''); return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : null; };

export default function Dashboard(props) {
  return <TipProvider><Overview {...props} /></TipProvider>;
}

function Overview({ openDetail, goComments, goSettings }) {
  const source = useData();
  const { status, records, meta, notify, setData } = useStore();
  const { settings, update } = useSettings();
  const statuses = settings.statuses;
  const labels = statusLabels(statuses);
  const loading = status === 'loading';
  const target = parseDay(settings.reviewTarget);
  const ov = useMemo(() => computeOverview(records, statuses, { target }), [records, statuses, target]);
  const tp = useTipProps();

  const overviewRef = useRef(null);
  const burnRef = useRef(null);
  const scoreRef = useRef(null);

  const snap = async (ref, name) => {
    try { await snapshotNode(ref.current, name); } catch (e) { notify(`Snapshot failed: ${e.message}`, 'error'); }
  };

  const readOnly = !source.caps.canAdmin;
  // Import lives in ImportAction (shared with Work).
  const importer = useImport();
  const fresh = importer.fresh;
  const [targetSignal, setTargetSignal] = useState(0);

  const logSheet = async () => {
    try {
      const st = await exportLogSheet(records, settings.templateExport);
      notify(`Log sheet ready: ${st.logRows} rows · ${st.images} photo${st.images === 1 ? '' : 's'}.`, 'success');
    } catch (e) {
      if (e.code === 'no-template') notify(e.message, 'info', { label: 'Set up', onClick: () => goSettings('template') });
      else notify(`Export failed: ${e.message}`, 'error');
    }
  };

  // Excel quick export keeps its Overview sheet (KPIs, disciplines, intake,
  // oldest open) and embeds the three main charts as images.
  const handleExport = async () => {
    if (!records.length) return;
    try {
      notify('Building Excel — rendering charts…', 'info');
      const [bImg, sImg] = await Promise.all([burnRef, scoreRef].map((r) => nodeToImage(r.current)));
      const trend = {};
      for (const r of records) { const k = toMonth(r.commentDate); if (!k) continue; const row = trend[k] || (trend[k] = { month: k }); row[r.status] = (row[r.status] || 0) + 1; }
      const oldestOpen = records.filter((r) => r.status !== ov.doneL)
        .map((r) => ({ ...r, ts: parseTs(r.commentDate) })).filter((r) => r.ts).sort((a, b) => a.ts - b.ts).slice(0, 5)
        .map((r) => ({ ...r, ageDays: Math.floor((Date.now() - r.ts) / 86400000) }));
      const overview = {
        generatedAt: new Date().toLocaleString(),
        total: ov.total, statuses: labels, doneLabel: ov.doneL,
        kpis: { ...ov.counts, total: ov.total }, closedPct: ov.pct,
        coverage: { closed: ov.done, withPhoto: ov.done - ov.noPhoto, pct: ov.done ? Math.round(((ov.done - ov.noPhoto) / ov.done) * 100) : 0 },
        byDiscipline: ov.disciplines.map((d) => ({ name: discName(d.key), ...d.counts, total: d.total })).sort((a, b) => b.total - a.total),
        trend: Object.values(trend).sort((a, b) => a.month.localeCompare(b.month)),
        needsAttention: oldestOpen,
        charts: [{ name: 'Scope and close-out', img: bImg }, { name: 'Disciplines', img: sImg }],
      };
      await exportToExcel(records, { overview });
      notify(`Exported ${records.length} comments with the Overview.`, 'success');
    } catch (e) {
      notify(`Export failed: ${e.message}`, 'error');
    }
  };

  const pickDisc = (key) => goComments({ discipline: key, status: 'all' });
  const middleLabels = statuses.filter((s) => s.role === 'middle').map((s) => s.label);
  const pickStage = (key) => {
    if (key === 'owned') return goComments({ discipline: 'OTHER', status: 'all' });
    if (key === 'actioned') return goComments({ status: ov.openL, discipline: 'all' });
    if (key === 'closed') return goComments({ status: middleLabels[0] || ov.openL, discipline: 'all' });
    if (key === 'ready') return goComments({ status: ov.doneL, discipline: 'all' });
    return goComments({ status: 'all', discipline: 'all' });
  };

  return (
    <div ref={overviewRef} className="canvas-w space-y-4">
      {/* Toolbar: target + actions (one strong action, the rest quiet) */}
      <div className="flex flex-wrap items-center justify-between gap-2" data-nosnap>
        <TargetChip value={settings.reviewTarget} onChange={(v) => update({ reviewTarget: v })} readOnly={readOnly} openSignal={targetSignal} />
        <div className="flex flex-wrap items-center gap-1">
          {!readOnly && <Button variant="text" icon="upload_file" onClick={() => importer.pick()} title="Import a Navisworks report">Import</Button>}
          {importer.ui}
          <Button variant="text" icon="image" onClick={() => snap(overviewRef, 'overview')} disabled={!records.length} title="Save the whole Overview as an image">Snapshot</Button>
          <ExportButton onLogSheet={logSheet} onQuick={handleExport} quickNote="All comments + this Overview" disabled={!records.length} />
        </div>
      </div>

      {loading ? (
        <Card className="p-6"><div className="skeleton h-28 w-full rounded-card" /></Card>
      ) : !records.length ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Icon name="upload_file" className="text-[32px] text-primary" />
          <div className="text-base font-semibold">No comments yet</div>
          {!readOnly && <Button variant="tonal" icon="upload_file" onClick={() => importer.pick()}>Import a Navisworks report</Button>}
        </Card>
      ) : (
        <>
          {!readOnly && (
            <SetupChecklist
              hasData={!fresh}
              target={settings.reviewTarget}
              isAdmin={source.caps.manageUsers}
              onImport={() => importer.pick()}
              onTarget={() => setTargetSignal((n) => n + 1)}
              onTemplate={() => goSettings('template')}
              onInvite={() => goSettings('users')}
            />
          )}
          <Reveal deps={[status, meta.source]}>
            <Hero ov={ov} statuses={statuses} goComments={goComments} />
          </Reveal>

          <Reveal deps={[status, meta.source]}>
            <Card className="relative p-6">
              <Head icon="flag" title="Do next" tip="What holds the log sheet and the target back, biggest first. Each count appears only here; Open list shows exactly those comments."
                right={<span className="text-[13px] text-on-surface-variant">Biggest effect first</span>} />
              <DoNext ov={ov} statuses={statuses} goComments={goComments} />
            </Card>
          </Reveal>

          <Reveal deps={[status, meta.source]}>
            <Card ref={scoreRef} className="relative p-6">
              <Head icon="groups" title="Disciplines" snap={() => snap(scoreRef, 'disciplines')}
                tip="Progress, pace and forecast per discipline, most at risk first. Pace = closed per day over the last 14 days; the tick is the pace the target needs. Click a row to open its comments."
                right={<VerdictCounts ov={ov} />} />
              <Scorecard ov={ov} onPick={pickDisc} />
            </Card>
          </Reveal>

          <Reveal className="grid gap-4 lg:grid-cols-12" deps={[status, meta.source]}>
            <Card ref={burnRef} className="relative min-w-0 p-6 lg:col-span-7">
              <Head icon="show_chart" title="Scope and close-out" snap={() => snap(burnRef, 'scope-close-out')}
                tip="Comments raised (grey) against closed (blue). The gap is the open backlog. Dashed blue: forecast at the current pace. Dotted: the pace needed to hit the target." />
              <BurnUp ov={ov} />
            </Card>
            <Card className="relative flex min-w-0 flex-col p-6 lg:col-span-5">
              <Head icon="speed" title="Closed per week" tip="Close-outs recorded in Tabelin over the last 8 weeks. The dotted line is the weekly pace the target needs; the bar below compares the last 4 weeks with it." />
              <PaceHeadline ov={ov} />
              <WeeklyPace ov={ov} fill />
              <PaceCoverage ov={ov} />
            </Card>
          </Reveal>

          <Reveal deps={[status, meta.source]}>
            <MoreInsights ov={ov} pickDisc={pickDisc} pickStage={pickStage} />
          </Reveal>
        </>
      )}

    </div>
  );
}

/* ---------------- pieces ---------------- */

// "Get this review ready": the four setup steps, ticked from the real state.
// Hidden once all are done, or for good when dismissed (per review, per
// browser).
function SetupChecklist({ hasData, target, isAdmin, onImport, onTarget, onTemplate, onInvite }) {
  const source = useData();
  const key = `tabelin.setupDone.${source.scopeKey}`;
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const [tpl, setTpl] = useState(null); // null = checking
  const [team, setTeam] = useState(null);
  useEffect(() => {
    let live = true;
    source.hasTemplate().then((v) => live && setTpl(!!v)).catch(() => live && setTpl(false));
    if (isAdmin) source.teamSize().then((n) => live && setTeam(n)).catch(() => live && setTeam(0));
    return () => { live = false; };
  }, [isAdmin]);
  const steps = [
    { id: 'import', done: hasData, title: 'Import comments', sub: hasData ? 'Report loaded' : 'Navisworks .html or .zip', action: 'Import', go: onImport },
    { id: 'target', done: !!target, title: 'Set a target', sub: target ? fmtDayY(parseDay(target)) : 'Close-out date', action: 'Set', go: onTarget },
    { id: 'tpl', done: !!tpl, title: 'Log-sheet template', sub: tpl ? 'Ready to export' : 'Choose the .xlsx', action: 'Set up', go: onTemplate },
    ...(isAdmin ? [{ id: 'team', done: team > 0, title: 'Invite your team', sub: team > 0 ? `${team} colleague${team === 1 ? '' : 's'}` : 'Only you so far', action: 'Invite', go: onInvite }] : []),
  ];
  const doneN = steps.filter((x) => x.done).length;
  if (dismissed || tpl === null || doneN === steps.length) return null;
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(key, '1'); } catch { /* ignore */ } };
  return (
    <div data-nosnap><Card className="relative p-5">
      <div className="mb-3 flex items-center gap-2 pr-8">
        <h2 className="text-[15px] font-semibold">Get this review ready</h2>
        <span className="rounded-full bg-surface-container px-2 py-0.5 text-[12px] font-semibold tabular-nums text-on-surface-variant">{doneN} of {steps.length}</span>
      </div>
      <button type="button" onClick={dismiss} aria-label="Hide these steps" title="Hide"
        className="t-press absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <Icon name="close" className="text-[18px]" />
      </button>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {steps.map((x) => (
          <div key={x.id} className="flex min-w-0 items-center gap-3 rounded-[16px] bg-surface-container px-3 py-2.5">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${x.done ? '' : 'border-2 border-dashed border-outline'}`}
              style={x.done ? { background: tint('var(--tabelin-good)', 16), color: 'var(--tabelin-good)' } : undefined}>
              {x.done && <Icon name="check" className="text-[17px]" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{x.title}</span>
              <span className="block truncate text-[12px] text-on-surface-variant">{x.sub}</span>
            </span>
            {!x.done && (
              <button type="button" onClick={x.go} className="t-press shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-primary hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">{x.action}</button>
            )}
          </div>
        ))}
      </div>
    </Card></div>
  );
}

function Head({ icon, title, tip, right, snap }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 pr-8">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <Icon name={icon} className="text-[20px] text-primary" />
        {title}
        {tip && <InfoTip label={`About ${title}`}>{tip}</InfoTip>}
      </h2>
      {right}
      {snap && (
        <button type="button" data-nosnap onClick={snap} title="Save as image" aria-label="Save as image"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Icon name="image" className="text-[18px]" />
        </button>
      )}
    </div>
  );
}

function VerdictChip({ verdict, children, tip }) {
  const tp = useTipProps();
  const v = VERDICT[verdict] || VERDICT.unknown;
  const neutral = verdict === 'unknown' || verdict === 'triage';
  return (
    <span tabIndex={tip ? 0 : undefined} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-2 pr-3 text-[13px] font-semibold"
      style={{ background: neutral ? 'var(--md-sys-color-surface-container-high)' : tint(v.fg, 16), color: neutral ? 'var(--md-sys-color-on-surface-variant)' : v.fg }}
      {...(tip ? tp(tip) : {})}>
      <Icon name={v.icon} className="text-[17px]" />{children ?? v.label}
    </span>
  );
}

function VerdictCounts({ ov }) {
  if (ov.target == null) return null;
  const words = { ok: 'on track', risk: 'at risk', bad: 'behind', triage: 'unclear' };
  const groups = ['ok', 'risk', 'bad', 'triage'].map((k) => [k, ov.disciplines.filter((d) => d.remaining > 0 && (d.verdict === k || (k === 'triage' && d.verdict === 'unknown')))]).filter(([, l]) => l.length);
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map(([k, list]) => (
        <VerdictChip key={k} verdict={k} tip={<TipRows title={words[k]} note={list.map((d) => discName(d.key)).join(', ')} />}>{list.length} {words[k]}</VerdictChip>
      ))}
    </div>
  );
}

function NoPace() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-on-surface-variant">
      <Icon name="speed" className="text-[28px]" />
      <div className="max-w-sm">The forecast appears once comments are closed in Tabelin. Close-out dates set the pace.</div>
    </div>
  );
}

export function TargetChip({ value, onChange, readOnly, openSignal }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const ref = useRef(null);
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);
  useEffect(() => { setDraft(value || ''); }, [value, open]);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const t = parseDay(value);
  if (readOnly) {
    if (!t) return null;
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-control bg-secondary-container px-4 text-sm font-semibold text-on-secondary-container" title="Review close-out target">
        <Icon name="flag" className="text-[19px]" />Target {fmtDayY(t)}
      </span>
    );
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-10 items-center gap-2 rounded-control px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${t ? 'bg-secondary-container text-on-secondary-container' : 'border border-dashed border-outline text-on-surface-variant hover:bg-surface-high'}`}
        title="Review close-out target">
        <Icon name="flag" className="text-[19px]" />{t ? `Target ${fmtDayY(t)}` : 'Set a target'}
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-30 w-64 rounded-card border border-outline-variant/60 bg-surface p-4 shadow-md-2">
          <label htmlFor="ov-target" className="text-xs font-medium text-on-surface-variant">Close all comments by</label>
          <input id="ov-target" type="date" value={draft} onChange={(e) => setDraft(e.target.value)}
            className="mt-1.5 block w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          <div className="mt-3 flex justify-end gap-1">
            {value && <Button variant="text" onClick={() => { onChange(''); setOpen(false); }}>Clear</Button>}
            <Button variant="tonal" onClick={() => { onChange(draft); setOpen(false); }} disabled={!draft}>Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Hero({ ov, statuses, goComments }) {
  const tp = useTipProps();
  const order = [...statuses].reverse();
  const roleNote = { done: 'Verified and closed', middle: 'Fixed, waiting for verification', open: 'Waiting for action' };
  const v = ov.verdict && VERDICT[ov.verdict];
  const maxPace = Math.max(ov.pace, ov.needed ?? 0, 0.1);
  return (
    <Card className="grid overflow-hidden p-0 lg:grid-cols-[1.35fr_1fr_1fr]">
      {/* progress */}
      <div className="p-6">
        <div className="flex flex-wrap items-baseline gap-4">
          <div className="text-[64px] font-bold leading-none tracking-[-0.035em] tabular-nums" tabIndex={0}
            {...tp(<TipRows title={`${ov.done} of ${ov.total} closed`} note={ov.hasCloseDates ? `+${ov.recent} in the last 14 days` : undefined} />)}>
            {ov.pct}<span className="text-[28px] font-semibold text-on-surface-variant">%</span>
          </div>
          <div className="text-sm text-on-surface-variant tabular-nums"><b className="text-on-surface">{ov.done}</b> / {ov.total} closed</div>
          {ov.hasCloseDates && ov.recent > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums" tabIndex={0} style={{ background: tint('var(--tabelin-good)', 14), color: 'var(--tabelin-good)' }}
              {...tp(<TipRows title={`${ov.recent} closed in the last 14 days`} />)}>+{ov.recent}</span>
          )}
        </div>
        <div className="mt-5"><StatusBar statuses={statuses} counts={ov.counts} total={ov.total} onPick={(label) => goComments({ status: label, discipline: 'all' })} /></div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] tabular-nums">
          {order.map((s) => (
            <button key={s.key} type="button" onClick={() => goComments({ status: s.label, discipline: 'all' })}
              className="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              {...tp(<TipRows title={s.label} note={roleNote[s.role]} />)}>
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.role === 'middle' ? hatch(s.color) : s.color }} />
              <b className="font-semibold">{ov.counts[s.label] || 0}</b><span className="text-on-surface-variant">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* target */}
      <div className="border-t border-outline-variant/40 p-6 lg:border-l lg:border-t-0">
        {ov.target == null ? (
          <div className="flex h-full flex-col justify-center gap-1 text-sm text-on-surface-variant">
            <Icon name="flag" className="text-[26px] text-primary" />
            <span>Set a target date to see the forecast and the pace you need.</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-on-surface-variant">{fmtDayY(ov.target)}</span>
              {v && <VerdictChip verdict={ov.verdict} tip={ov.forecast != null ? <TipRows title={`Forecast ${fmtDayY(ov.forecast)}`} note={ov.late > 0 ? `${ov.late} days after the target` : ov.late < 0 ? `${-ov.late} days early` : 'On the target day'} /> : <TipRows title="No pace yet" note="Close comments in Tabelin to measure the pace." />} />}
            </div>
            <div className="mt-3 text-[34px] font-bold leading-tight tracking-[-0.02em] tabular-nums">
              {ov.remaining === 0 ? 'All closed' : ov.daysLeft > 0 ? `${ov.daysLeft} days left` : ov.daysLeft === 0 ? 'Due today' : `${-ov.daysLeft} days over`}
            </div>
            {ov.remaining > 0 && (
              <div className="mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-[12.5px] tabular-nums">
                <span className="text-on-surface-variant">Now</span>
                <div className="h-2 overflow-hidden rounded-full bg-surface-high"><div className="h-full rounded-full" style={{ width: `${(ov.pace / maxPace) * 100}%`, background: 'var(--md-sys-color-primary)' }} /></div>
                <b {...tp(<TipRows title="Closed per day" note="Average over the last 14 days" />)} tabIndex={0}>{ov.pace.toFixed(1)}/day</b>
                {ov.needed != null && <>
                  <span className="text-on-surface-variant">Needed</span>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-high"><div className="h-full rounded-full bg-on-surface-variant" style={{ width: `${(ov.needed / maxPace) * 100}%` }} /></div>
                  <b {...tp(<TipRows title="Needed per day" note={`${ov.remaining} left over ${ov.daysLeft} days`} />)} tabIndex={0}>{ov.needed.toFixed(1)}/day</b>
                </>}
              </div>
            )}
            {ov.remaining > 0 && (
              <p className="mt-2 text-[14px] leading-snug text-on-surface-variant">
                {ov.forecast == null ? 'Close comments in Tabelin to measure the pace.' : (
                  <>At today’s pace you finish <b className="text-on-surface">{fmtDay(ov.forecast)}</b>
                    {ov.late > 0 ? <> — <b style={{ color: v?.fg }}>{ov.late} day{ov.late === 1 ? '' : 's'} late</b>.</>
                      : ov.late < 0 ? <> — {-ov.late} day{ov.late === -1 ? '' : 's'} early.</> : <> — on the target day.</>}</>
                )}
              </p>
            )}
          </>
        )}
      </div>

      {/* log-sheet readiness */}
      <div className="border-t border-outline-variant/40 p-6 lg:border-l lg:border-t-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
          Log sheet ready
        </div>
        <div className="mt-3 flex items-baseline gap-2 tabular-nums"><span className="text-[34px] font-bold leading-tight tracking-[-0.02em]">{ov.ready}</span><span className="text-sm text-on-surface-variant">/ {ov.total}</span></div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-high"><div className="h-full rounded-full" style={{ width: `${ov.total ? (ov.ready / ov.total) * 100 : 0}%`, background: 'var(--tabelin-status-closed)' }} /></div>
        <p className="mt-4 text-[13px] leading-snug text-on-surface-variant">Ready = closed, with an after-photo and a resolution. What’s missing is in <b className="font-semibold text-on-surface">Do next</b>.</p>
      </div>
    </Card>
  );
}

// "Do next": every blocker counted once, ranked by what it unblocks, each
// opening exactly those comments as a Work queue (definitions in lib/queues.js).
const DO_NEXT_LOOK = {
  unassigned: { c: 'var(--md-sys-color-on-surface-variant)', why: 'Unassigned comments have no owner and no forecast.' },
  noPhoto: { c: 'var(--md-sys-color-primary)' },
  verify: { why: 'Fixed, waiting for a reviewer to close.' },
  noRes: { c: 'var(--tabelin-warn)' },
  old: { c: 'var(--tabelin-warn)', why: 'Raised more than 3 months ago and still open.' },
};
function DoNext({ ov, statuses, goComments }) {
  const mid = statuses.filter((x) => x.role === 'middle');
  const items = workQueues(ov, statuses).doNext.map((q) => ({
    n: q.n, icon: q.icon, title: q.title, why: DO_NEXT_LOOK[q.id]?.why || q.why,
    c: DO_NEXT_LOOK[q.id]?.c || mid[0]?.color || 'var(--md-sys-color-primary)',
    go: () => goComments(q.filter),
  })).filter((x) => x.n > 0);
  if (!items.length) {
    return <div className="flex items-center gap-2 py-2 text-sm text-on-surface-variant"><Icon name="check_circle" className="text-[20px]" style={{ color: 'var(--tabelin-good)' }} />Nothing is holding the log sheet back.</div>;
  }
  return (
    <ol className="-mx-2 divide-y divide-outline-variant/40">
      {items.map((it, i) => (
        <li key={it.title}>
          <button type="button" onClick={it.go}
            className="donext t-press grid w-full grid-cols-[22px_44px_minmax(64px,auto)_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[18px] px-2 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="text-center text-[13px] font-semibold tabular-nums text-on-surface-variant">{i + 1}</span>
            <span className="grid h-11 w-11 place-items-center rounded-[14px]" style={{ background: tint(it.c, 14), color: it.c }}><Icon name={it.icon} className="text-[22px]" /></span>
            <span className="text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums">{it.n}</span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{it.title}</span>
              <span className="block truncate text-[13px] text-on-surface-variant">{it.why}</span>
            </span>
            <span className="donext-go inline-flex items-center gap-1.5 rounded-[12px] px-3 py-2 text-[14px] font-medium text-primary">Open list<Icon name="arrow_forward" className="text-[20px]" /></span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// Pipeline, the forecast runway, backlog age and "raised by" stay one click
// away instead of crowding the page.
const MORE = [
  { id: 'forecast', label: 'Forecast runway', icon: 'sports_score' },
  { id: 'pipeline', label: 'Pipeline', icon: 'conversion_path' },
  { id: 'age', label: 'Backlog age', icon: 'schedule' },
  { id: 'raised', label: 'Raised by', icon: 'record_voice_over' },
];
function MoreInsights({ ov, pickDisc, pickStage }) {
  const [open, setOpenState] = useState(() => { try { return localStorage.getItem('tabelin.ovMore') || ''; } catch { return ''; } });
  const setOpen = (v) => { setOpenState(v); try { localStorage.setItem('tabelin.ovMore', v); } catch { /* ignore */ } };
  return (
    <Card className="relative px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[15px] font-semibold">More insights</h2>
        {MORE.map((m) => (
          <button key={m.id} type="button" onClick={() => setOpen(open === m.id ? '' : m.id)} aria-expanded={open === m.id}
            className={`t-press inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${open === m.id ? 'bg-secondary-container font-semibold text-on-secondary-container' : 'bg-surface-container text-on-surface hover:bg-surface-high'}`}>
            <Icon name={m.icon} className="text-[18px]" />{m.label}
            <Icon name={open === m.id ? 'expand_less' : 'expand_more'} className="text-[20px]" />
          </button>
        ))}
      </div>
      {open && (
        <div key={open} className="more-pane mt-5 border-t border-outline-variant/50 pt-5">
          {open === 'forecast' && (ov.hasCloseDates ? <ForecastRunway ov={ov} onPick={pickDisc} /> : <NoPace />)}
          {open === 'pipeline' && <Pipeline ov={ov} onPick={pickStage} />}
          {open === 'age' && <AgeHeatmap ov={ov} onPick={pickDisc} />}
          {open === 'raised' && <RaisedBy ov={ov} />}
        </div>
      )}
    </Card>
  );
}

function Scorecard({ ov, onPick }) {
  const tp = useTipProps();
  const maxP = Math.max(0.1, ...ov.disciplines.map((d) => Math.max(d.pace, d.needed ?? 0)));
  const lateColor = (d) => (d.verdict === 'bad' ? 'var(--tabelin-bad)' : d.verdict === 'risk' ? 'var(--tabelin-warn)' : 'var(--md-sys-color-on-surface-variant)');
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[820px] text-[14px]">
        <thead>
          <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-on-surface-variant">
            <th className="px-2 py-2 font-semibold">Discipline</th>
            <th className="px-2 py-2 font-semibold">Closed</th>
            <th className="px-2 py-2 text-right font-semibold">Left</th>
            <th className="px-2 py-2 font-semibold">Pace now / needed</th>
            <th className="px-2 py-2 font-semibold">Forecast finish</th>
            <th className="px-2 py-2 text-right font-semibold">Oldest</th>
            <th className="px-2 py-2 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {ov.byRisk.map((d) => (
            <tr key={d.key} tabIndex={0} onClick={() => onPick(d.key)} onKeyDown={(e) => e.key === 'Enter' && onPick(d.key)}
              className="cursor-pointer border-t border-outline-variant/40 transition-colors hover:bg-surface-container focus:outline-none focus-visible:bg-surface-container">
              <td className="whitespace-nowrap px-2 py-3">
                <span className="mr-2 rounded-md bg-surface-container px-1.5 py-0.5 font-mono text-[12px] font-medium text-on-surface-variant">{discCode(d.key)}</span>{discName(d.key)}
              </td>
              <td className="px-2 py-3">
                <div className="flex items-center gap-3 tabular-nums">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-high"><div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: 'var(--tabelin-good)' }} /></div>
                  <span className="whitespace-nowrap text-[13px] text-on-surface-variant"><b className="font-semibold text-on-surface">{d.pct}%</b> of {d.total}</span>
                </div>
              </td>
              <td className="px-2 py-3 text-right font-semibold tabular-nums">{d.remaining}</td>
              <td className="px-2 py-3">
                <div className="flex items-center gap-2.5 tabular-nums" {...tp(<TipRows title={discName(d.key)} rows={[['Closed per day now', d.pace.toFixed(1)], ...(d.needed != null && d.remaining > 0 ? [['Needed per day', d.needed.toFixed(1)]] : [])]} />)}>
                  <div className="relative h-2 w-24 rounded-full bg-surface-high">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (d.pace / maxP) * 100)}%`, background: 'var(--md-sys-color-primary)' }} />
                    {d.needed != null && d.remaining > 0 && <i className="absolute -top-[3px] h-3.5 w-0.5 rounded bg-on-surface" style={{ left: `${Math.min(98, (d.needed / maxP) * 100)}%` }} />}
                  </div>
                  <span className="whitespace-nowrap text-[13px]">{d.pace.toFixed(1)}{d.needed != null && d.remaining > 0 && <span className="text-on-surface-variant"> / {d.needed.toFixed(1)}</span>}</span>
                </div>
              </td>
              <td className="whitespace-nowrap px-2 py-3 text-[13px] tabular-nums">
                {d.remaining === 0 ? <span className="text-on-surface-variant">done</span> : d.forecast == null ? <span className="text-on-surface-variant">—</span> : <>{fmtDay(d.forecast)}{d.late > 0 && <b className="font-semibold" style={{ color: lateColor(d) }}> +{d.late} d</b>}</>}
              </td>
              <td className="whitespace-nowrap px-2 py-3 text-right text-[13px] tabular-nums text-on-surface-variant">{d.oldest != null && d.remaining > 0 ? `${d.oldest} d` : '—'}</td>
              <td className="px-2 py-3 text-right">{d.verdict && <VerdictChip verdict={d.verdict} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
