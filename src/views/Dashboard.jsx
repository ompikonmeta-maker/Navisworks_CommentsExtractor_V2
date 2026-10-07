import { useEffect, useMemo, useRef, useState } from 'react';
import { snapshotNode, nodeToImage } from '../lib/snapshot.js';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { statusLabels } from '../lib/status.js';
import { exportToExcel } from '../lib/excel.js';
import { ingestFiles } from '../lib/ingest.js';
import { api, remoteState, isReadOnly, applyMergeRemote, undoImportRemote } from '../lib/server.js';
import { loadTemplate } from '../lib/persist.js';
import { planMerge, applyMergeLocal } from '../lib/merge.js';
import ImportDialog from '../components/ImportDialog.jsx';
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

function Overview({ openDetail, goComments, goSettings, remoteUser }) {
  const { status, records, meta, notify, setData } = useStore();
  const { settings, update } = useSettings();
  const statuses = settings.statuses;
  const labels = statusLabels(statuses);
  const loading = status === 'loading';
  const target = parseDay(settings.reviewTarget);
  const ov = useMemo(() => computeOverview(records, statuses, { target }), [records, statuses, target]);
  const tp = useTipProps();

  const fileInputRef = useRef(null);
  const overviewRef = useRef(null);
  const forecastRef = useRef(null);
  const burnRef = useRef(null);
  const scoreRef = useRef(null);

  const snap = async (ref, name) => {
    try { await snapshotNode(ref.current, name); } catch (e) { notify(`Snapshot failed: ${e.message}`, 'error'); }
  };

  const readOnly = isReadOnly();
  // Import. Into an empty review (or over the offline sample) it's a plain
  // load; into a review with comments it first shows what the new report
  // changes and then merges by comment ID. Either way it can be undone.
  const [merge, setMerge] = useState(null); // { plan, stats, fileName, missingAction }
  const [targetSignal, setTargetSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const fresh = !records.length || (!remoteState.active && meta.source === 'sample');

  const handleImport = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      const { records: recs, stats, errors } = await ingestFiles(files);
      if (recs.length === 0) { notify(errors[0] || 'No comments could be imported.', 'error'); return; }
      const fileName = files.find((f) => /\.html?$/i.test(f.name))?.name || files[0].name;
      if (fresh) await runImport(planMerge([], recs), stats, 'keep');
      else setMerge({ plan: planMerge(records, recs), stats, fileName, missingAction: 'keep' });
    } catch (e) {
      notify(`Import failed: ${e.message}`, 'error');
    }
  };

  const runImport = async (plan, stats, missingAction) => {
    const doneLabel = ov.doneL;
    const before = { records, source: meta.source };
    setBusy(true);
    try {
      let undo;
      if (remoteState.active) {
        const res = await applyMergeRemote(remoteState.reviewId, plan, { missingAction, doneLabel });
        setData(res.records, `review:${remoteState.reviewId}`, stats);
        undo = async () => setData(await undoImportRemote(remoteState.reviewId, res.undo), `review:${remoteState.reviewId}`, stats);
      } else {
        const base = before.source === 'sample' ? [] : before.records;
        setData(applyMergeLocal(base, plan, { missingAction, doneLabel }), 'user', stats);
        undo = async () => setData(before.records, before.source, { comments: before.records.length, html: 0, images: 0, linked: 0 });
      }
      const msg = plan.matched.length
        ? `Review updated: ${plan.added.length} added, ${plan.changed} changed.`
        : `Imported ${plan.added.length} comments · ${stats.linked} images linked.`;
      notify(msg, 'success', {
        label: 'Undo',
        onClick: async () => {
          try { await undo(); notify('Import undone.', 'success'); } catch (e) { notify(`Couldn’t undo: ${e.message}`, 'error'); }
        },
      });
      setMerge(null);
    } catch (e) {
      notify(`Import failed: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

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
      const [fImg, bImg, sImg] = await Promise.all([forecastRef, burnRef, scoreRef].map((r) => nodeToImage(r.current)));
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
        charts: [{ name: 'Forecast finish', img: fImg }, { name: 'Scope and close-out', img: bImg }, { name: 'Disciplines', img: sImg }],
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
          {!readOnly && <Button variant="text" icon="upload_file" onClick={() => fileInputRef.current?.click()} title="Import a Navisworks report">Import</Button>}
          <input ref={fileInputRef} type="file" multiple accept=".html,.htm,.jpg,.jpeg,.png,.zip" className="hidden" onChange={(e) => { handleImport(e.target.files); e.target.value = ''; }} />
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
          {!readOnly && <Button variant="tonal" icon="upload_file" onClick={() => fileInputRef.current?.click()}>Import a Navisworks report</Button>}
        </Card>
      ) : (
        <>
          {!readOnly && (
            <SetupChecklist
              hasData={!fresh}
              target={settings.reviewTarget}
              isAdmin={remoteState.active && remoteUser?.role === 'admin'}
              onImport={() => fileInputRef.current?.click()}
              onTarget={() => setTargetSignal((n) => n + 1)}
              onTemplate={() => goSettings('template')}
              onInvite={() => goSettings('users')}
            />
          )}
          <Reveal deps={[status, meta.source]}>
            <Hero ov={ov} statuses={statuses} goComments={goComments} />
          </Reveal>

          <Reveal deps={[status, meta.source]}>
            <Card ref={forecastRef} className="relative min-w-0 p-6">
              <Head icon="sports_score" title="Forecast finish" snap={() => snap(forecastRef, 'forecast-finish')}
                tip="Each comet runs from today to when a discipline closes its last comment at its current pace (close-outs in the last 14 days). Bigger head = more left. Past the chequered line misses the target. Click a row to open its comments."
                right={<VerdictCounts ov={ov} />} />
              {ov.hasCloseDates ? <ForecastRunway ov={ov} onPick={pickDisc} /> : <NoPace />}
            </Card>
          </Reveal>

          <Reveal className="grid gap-4 lg:grid-cols-12" deps={[status, meta.source]}>
            <Card ref={burnRef} className="relative min-w-0 p-6 lg:col-span-8">
              <Head icon="show_chart" title="Scope and close-out" snap={() => snap(burnRef, 'scope-close-out')}
                tip="Comments raised (grey) against closed (blue). The gap is the open backlog. Dashed blue: forecast at the current pace. Dotted: the pace needed to hit the target." />
              <BurnUp ov={ov} />
            </Card>
            <Card className="relative flex min-w-0 flex-col p-6 lg:col-span-4">
              <Head icon="speed" title="Closed per week" tip="Close-outs recorded in Tabelin over the last 8 weeks. The dotted line is the weekly pace the target needs; the bar below compares the last 4 weeks with it." />
              <PaceHeadline ov={ov} />
              <WeeklyPace ov={ov} fill />
              <PaceCoverage ov={ov} />
            </Card>
          </Reveal>

          <Reveal className="grid gap-4 lg:grid-cols-2" deps={[status, meta.source]}>
            <Card className="relative flex flex-col p-6">
              <Head icon="conversion_path" title="Pipeline" tip="Where comments sit between being raised and going into the log sheet. Red numbers are what drops out at each step. Click a step to see those comments." />
              <Pipeline ov={ov} onPick={pickStage} />
            </Card>
            <Card className="relative flex flex-col p-6">
              <Head icon="priority_high" title="Needs attention" tip="What holds the target back, most urgent first. Each opens the matching comments." />
              <Attention ov={ov} statuses={statuses} goComments={goComments} openDetail={openDetail} />
            </Card>
          </Reveal>

          <Reveal deps={[status, meta.source]}>
            <Card ref={scoreRef} className="relative p-6">
              <Head icon="groups" title="Disciplines" snap={() => snap(scoreRef, 'disciplines')} tip="Progress, pace and forecast per discipline, most at risk first. Click a row to open its comments." />
              <Scorecard ov={ov} statuses={statuses} onPick={pickDisc} />
            </Card>
          </Reveal>

          <Reveal className="grid gap-4 lg:grid-cols-12" deps={[status, meta.source]}>
            <Card className="relative min-w-0 p-6 lg:col-span-7">
              <Head icon="schedule" title="Backlog age" tip="Comments not yet closed, by how long ago they were raised. Darker = more." />
              <AgeHeatmap ov={ov} onPick={pickDisc} />
            </Card>
            <Card className="relative flex min-w-0 flex-col p-6 lg:col-span-5">
              <Head icon="record_voice_over" title="Raised by" tip="Share of each group's comments that are closed. Groups come from the prefix of the commenter name (CPY_, OPS, …)." />
              <RaisedBy ov={ov} />
            </Card>
          </Reveal>
        </>
      )}

      <ImportDialog state={merge} onChange={setMerge} onCancel={() => setMerge(null)} busy={busy}
        onConfirm={() => runImport(merge.plan, merge.stats, merge.missingAction)} />
    </div>
  );
}

/* ---------------- pieces ---------------- */

// "Get this review ready": the four setup steps, ticked from the real state.
// Hidden once all are done, or for good when dismissed (per review, per
// browser).
function SetupChecklist({ hasData, target, isAdmin, onImport, onTarget, onTemplate, onInvite }) {
  const key = `tabelin.setupDone.${remoteState.active ? remoteState.reviewId : 'local'}`;
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const [tpl, setTpl] = useState(null); // null = checking
  const [team, setTeam] = useState(null);
  useEffect(() => {
    let live = true;
    (remoteState.active ? api.hasTemplate(remoteState.projectId) : loadTemplate().then(Boolean)).then((v) => live && setTpl(!!v)).catch(() => live && setTpl(false));
    if (isAdmin) api.listUsers().then((u) => live && setTeam(u.filter((x) => x.id !== remoteState.user?.id).length)).catch(() => live && setTeam(0));
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
        <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-on-surface-variant">{doneN} of {steps.length}</span>
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
              <span className="block truncate text-[11.5px] text-on-surface-variant">{x.sub}</span>
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
  const groups = ['ok', 'risk', 'bad', 'triage'].map((k) => [k, ov.disciplines.filter((d) => d.remaining > 0 && d.verdict === k)]).filter(([, l]) => l.length);
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map(([k, list]) => (
        <VerdictChip key={k} verdict={k} tip={<TipRows title={VERDICT[k].label} note={list.map((d) => discName(d.key)).join(', ')} />}>{list.length}</VerdictChip>
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

function TargetChip({ value, onChange, readOnly, openSignal }) {
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
              {ov.remaining === 0 ? 'All closed' : ov.daysLeft > 0 ? `${ov.daysLeft} days` : ov.daysLeft === 0 ? 'Due today' : `${-ov.daysLeft} days over`}
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
            {ov.forecast != null && ov.remaining > 0 && (
              <div className="mt-3 text-[12.5px] text-on-surface-variant">Finish <b className="text-on-surface">{fmtDay(ov.forecast)}</b>
                {ov.late > 0 && <b style={{ color: v?.fg }}> · +{ov.late}d</b>}</div>
            )}
          </>
        )}
      </div>

      {/* log-sheet readiness */}
      <div className="border-t border-outline-variant/40 p-6 lg:border-l lg:border-t-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
          Log sheet <InfoTip label="About log-sheet ready">Closed comments with an after-photo and a resolution — ready for the 3D Model Log Sheet export.</InfoTip>
        </div>
        <div className="mt-3 flex items-baseline gap-2 tabular-nums"><span className="text-[34px] font-bold leading-tight tracking-[-0.02em]">{ov.ready}</span><span className="text-sm text-on-surface-variant">/ {ov.total}</span></div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-high"><div className="h-full rounded-full" style={{ width: `${ov.total ? (ov.ready / ov.total) * 100 : 0}%`, background: 'var(--tabelin-status-closed)' }} /></div>
        {ov.done > 0 && (
          <div className="mt-4 grid gap-1">
            {[
              ['no_photography', ov.noPhoto, 'without an after-photo', 'Closed, but the after-photo is missing.', { noPhoto: true }],
              ['description', ov.noRes, 'without a resolution', 'Closed, but no resolution was written.', { noRes: true }],
            ].map(([icon, n, label, tip, f]) => (
              <button key={icon} type="button" onClick={() => goComments({ status: ov.doneL, ...f })} disabled={!n}
                className="t-press flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[12.5px] tabular-nums enabled:hover:bg-surface-container disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                {...tp(<TipRows title={`${n} closed ${label}`} note={tip} />)}>
                <Icon name={icon} className="text-[17px]" style={{ color: n ? 'var(--tabelin-warn)' : 'var(--tabelin-good)' }} />
                <b className="font-semibold">{n}</b><span className="truncate text-on-surface-variant">{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function Attention({ ov, statuses, goComments, openDetail }) {
  const a = ov.attention;
  const mid = statuses.filter((s) => s.role === 'middle');
  const items = [
    a.unassignedOpen > 0 && { n: a.unassignedOpen, t: 'without a discipline', icon: 'person_off', c: 'var(--tabelin-bad)', go: () => goComments({ discipline: 'OTHER', status: '!done' }), tip: 'Nobody owns these yet. Detection could not read a discipline from the text.' },
    a.over90 > 0 && { n: a.over90, t: 'open over 3 months', icon: 'hourglass_bottom', c: 'var(--tabelin-bad)', go: () => goComments({ old: true }), tip: 'Raised more than 90 days ago and still not closed.' },
    a.middle > 0 && { n: a.middle, t: mid.length === 1 ? `${mid[0].label.toLowerCase()}` : 'waiting for verification', icon: 'pending', c: 'var(--tabelin-warn)', go: () => goComments({ status: mid[0]?.label || ov.openL, discipline: 'all' }), tip: 'Fixed, waiting for the reviewer to verify.' },
    a.missingEvidence > 0 && { n: a.missingEvidence, t: 'closed without evidence', icon: 'no_photography', c: 'var(--tabelin-warn)', go: () => goComments({ status: ov.doneL, noPhoto: true, noRes: true }), tip: `${a.noPhoto} without an after-photo · ${a.noRes} without a resolution.` },
  ].filter(Boolean);
  const tp = useTipProps();
  return (
    <div>
      {items.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-sm text-on-surface-variant"><Icon name="check_circle" className="text-[20px]" style={{ color: 'var(--tabelin-good)' }} />Nothing is blocking the target.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {items.map((it) => (
            <button key={it.t} type="button" onClick={it.go} {...tp(<TipRows title={`${it.n} ${it.t}`} note={it.tip} />)}
              className="flex flex-col gap-2 rounded-[20px] bg-surface-container p-4 text-left transition-[background,transform] hover:-translate-y-px hover:bg-secondary-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className="flex items-center justify-between">
                <span className="text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums">{it.n}</span>
                <Icon name={it.icon} className="text-[20px]" style={{ color: it.c }} />
              </span>
              <span className="text-[12.5px] font-medium text-on-surface-variant">{it.t}</span>
            </button>
          ))}
        </div>
      )}
      {a.oldest && (
        <button type="button" onClick={() => openDetail(a.oldest.record.ID)}
          className="mt-3 grid w-full grid-cols-[auto_1fr] items-start gap-3 rounded-control bg-surface-container p-3 text-left hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {a.oldest.record.imageData ? (
            <img src={a.oldest.record.imageData} alt="" className="h-12 w-16 rounded-lg object-cover" />
          ) : (
            <span className="grid h-12 w-16 place-items-center rounded-lg bg-surface-high text-on-surface-variant"><Icon name="view_in_ar" /></span>
          )}
          <span className="min-w-0">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">Oldest open · {a.oldest.age} days</span>
            <span className="mt-0.5 line-clamp-2 block text-[12.5px]">{a.oldest.record.commentText}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-on-surface-variant">{a.oldest.record.viewpoint} · {discName(a.oldest.record.discipline || 'OTHER')}</span>
          </span>
        </button>
      )}
    </div>
  );
}

function Scorecard({ ov, statuses, onPick }) {
  const tp = useTipProps();
  const order = [...statuses].reverse();
  const maxP = Math.max(0.1, ...ov.disciplines.map((d) => Math.max(d.pace, d.needed ?? 0)));
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-on-surface-variant">
            <th className="px-2 py-2 font-semibold">Discipline</th>
            <th className="px-2 py-2 font-semibold">Status</th>
            <th className="px-2 py-2 text-right font-semibold">Closed</th>
            <th className="px-2 py-2 text-right font-semibold">Left</th>
            <th className="px-2 py-2 font-semibold"><span className="inline-flex items-center gap-1">Pace<InfoTip label="About pace">Closed per day over the last 14 days. The tick marks the pace needed to hit the target.</InfoTip></span></th>
            <th className="px-2 py-2 font-semibold">Finish</th>
            <th className="px-2 py-2 text-right font-semibold">Oldest</th>
            <th className="px-2 py-2 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {ov.byRisk.map((d) => (
            <tr key={d.key} tabIndex={0} onClick={() => onPick(d.key)} onKeyDown={(e) => e.key === 'Enter' && onPick(d.key)}
              className="cursor-pointer border-t border-outline-variant/40 transition-colors hover:bg-surface-container focus:outline-none focus-visible:bg-surface-container">
              <td className="whitespace-nowrap px-2 py-2.5">
                <span className="mr-2 rounded-md bg-surface-container px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-on-surface-variant">{discCode(d.key)}</span>{discName(d.key)}
              </td>
              <td className="px-2 py-2.5">
                <div className="flex h-2.5 w-36 gap-[2px] overflow-hidden rounded-full" {...tp(<TipRows title={discName(d.key)} rows={order.map((s) => [s.label, d.counts[s.label] || 0])} />)}>
                  {order.map((s) => (d.counts[s.label] ? <div key={s.key} style={{ flex: d.counts[s.label], background: s.role === 'middle' ? hatch(s.color) : s.color }} /> : null))}
                </div>
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums"><b className="font-semibold">{d.pct}%</b> <span className="text-on-surface-variant">of {d.total}</span></td>
              <td className="px-2 py-2.5 text-right tabular-nums">{d.remaining}</td>
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-2 tabular-nums">
                  <div className="relative h-1.5 w-20 rounded-full bg-surface-high">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (d.pace / maxP) * 100)}%`, background: 'var(--md-sys-color-primary)' }} />
                    {d.needed != null && d.remaining > 0 && <i className="absolute -top-[3px] h-3 w-0.5 rounded bg-on-surface" style={{ left: `${Math.min(98, (d.needed / maxP) * 100)}%` }} />}
                  </div>
                  <span>{d.pace.toFixed(1)}</span>{d.needed != null && d.remaining > 0 && <span className="text-on-surface-variant">/ {d.needed.toFixed(1)}</span>}
                </div>
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                {d.remaining === 0 ? <span className="text-on-surface-variant">done</span> : d.forecast == null ? <span className="text-on-surface-variant">—</span> : <>{fmtDay(d.forecast)}{d.late > 0 && <span className="text-on-surface-variant"> +{d.late}d</span>}</>}
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{d.oldest != null && d.remaining > 0 ? `${d.oldest} d` : '—'}</td>
              <td className="px-2 py-2.5">{d.verdict && <VerdictChip verdict={d.verdict} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
