// "Check this import" — the big picture of a Navisworks report: totals (A),
// disciplines (B), checks with a way in (E), who raised the comments (C) and
// when (D). Shown before a first import is saved (mode 'confirm') and again,
// read-only, from the import log (mode 'view'). Numbers: lib/importSummary.js.
import { useRef } from 'react';
import { useSettings } from '../store/settings.jsx';
import { fmtStamp } from '../lib/overview.js';
import { snapshotNode } from '../lib/snapshot.js';
import { Dialog, Button, Icon, discColor, discLabel } from './ui.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
};
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const PARTY_COLORS = ['#2a78d6', '#1baf7a', '#4a3aa7', '#eb6834', '#0e7c86'];
const WARN_STRIPES = 'repeating-linear-gradient(45deg, var(--tabelin-warn) 0 6px, color-mix(in srgb, var(--tabelin-warn) 60%, transparent) 6px 12px)';

function span(from, to) {
  if (!from || !to) return '';
  const a = new Date(from), b = new Date(to);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (months >= 1) return `${months} mo`;
  const days = Math.round((b - a) / 86400000) + 1;
  return `${days} day${days === 1 ? '' : 's'}`;
}

function Kpi({ n, label, note, warn }) {
  return (
    <div className="min-w-0 rounded-[18px] bg-surface-container px-4 py-3.5">
      <div className="text-[28px] font-bold leading-tight tabular-nums" style={warn ? { color: 'var(--tabelin-warn)' } : undefined}>{n}</div>
      <div className="mt-0.5 truncate text-[13px] text-on-surface-variant">{label}</div>
      {note && <div className="mt-1.5 truncate text-xs text-on-surface-variant">{note}</div>}
    </div>
  );
}

function Bars({ rows, max }) {
  return (
    <div className="grid gap-[7px]">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[124px_minmax(0,1fr)_44px] items-center gap-2.5 text-[13px]">
          <span className="flex min-w-0 items-center gap-2 truncate" style={r.warn ? { color: 'var(--tabelin-warn)', fontWeight: 600 } : undefined}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.warn ? 'var(--tabelin-warn)' : r.color }} />
            <span className="truncate">{r.label}</span>
          </span>
          <span className="h-3 overflow-hidden rounded-full bg-surface-container">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.n / (max || 1)) * 100)}%`, background: r.warn ? WARN_STRIPES : r.color }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

function Box({ tag, title, sub, children }) {
  return (
    <section className="min-w-0 rounded-[20px] border border-outline-variant px-[18px] py-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-on-surface-variant">{tag}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {sub && <p className="mb-3 mt-0.5 text-[13px] text-on-surface-variant">{sub}</p>}
      {children}
    </section>
  );
}

function Check({ ok, title, note, action }) {
  const tone = ok ? 'var(--tabelin-good)' : 'var(--tabelin-warn)';
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-control bg-surface-container px-3 py-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${tone} 18%, transparent)`, color: tone }}>
        <Icon name={ok ? 'check' : 'priority_high'} className="text-[17px]" />
      </span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold">{title}</div>
        {note && <div className="mt-px text-[12.5px] text-on-surface-variant">{note}</div>}
      </div>
      {action ? <span data-nosnap>{action}</span> : <span />}
    </div>
  );
}

function Timeline({ months }) {
  if (!months.length) return <p className="text-[13px] text-on-surface-variant">The report has no comment dates.</p>;
  const max = Math.max(...months.map((m) => m[1]), 1);
  const W = 420, H = 200, left = 34, base = 160, top = 28;
  const step = Math.min(48, (W - left - 8) / months.length);
  const bw = Math.max(4, Math.min(26, step * 0.7));
  const nice = max <= 10 ? 10 : 10 ** Math.floor(Math.log10(max)) * Math.ceil(max / 10 ** Math.floor(Math.log10(max)));
  const y = (v) => base - (v / nice) * (base - top);
  const every = Math.ceil(months.length / 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img"
      aria-label={`Comments per month: ${months.filter((m) => m[1]).map(([k, n]) => `${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)} ${n}`).join(', ')}`}>
      {[0, nice / 2, nice].map((v) => (
        <g key={v}>
          <line x1={left - 4} x2={W - 6} y1={y(v)} y2={y(v)} stroke="var(--md-sys-color-outline-variant)" strokeDasharray={v ? '3 4' : undefined} />
          <text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--md-sys-color-on-surface-variant)">{v}</text>
        </g>
      ))}
      {months.map(([k, n], i) => {
        const cx = left + step * i + step / 2;
        const mon = +k.slice(5);
        const showYear = i === 0 || mon === 1;
        return (
          <g key={k}>
            {n > 0 && <rect x={cx - bw / 2} y={y(n)} width={bw} height={base - y(n)} rx="4" fill="var(--md-sys-color-primary)" />}
            {n > 0 && <text x={cx} y={y(n) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--md-sys-color-on-surface)">{n}</text>}
            {(i % every === 0) && <text x={cx} y={178} textAnchor="middle" fontSize="11" fill="var(--md-sys-color-on-surface-variant)">{MONTHS[mon - 1]}</text>}
            {showYear && <text x={cx} y={194} textAnchor="middle" fontSize="11" fill="var(--md-sys-color-on-surface-variant)">{k.slice(0, 4)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * props: summary, mode 'confirm' | 'view', open, busy, place (review name),
 * onSave, onClose, onView(filter) — save (if needed) and open those comments,
 * onPickAgain — choose the files again (to add the images).
 */
export default function ImportSummary({ summary: s, mode = 'confirm', open, busy, place, onSave, onClose, onView, onPickAgain }) {
  const { settings } = useSettings();
  const body = useRef(null);
  const confirm = mode === 'confirm';

  const content = s && (() => {
    const c = s.checks;
    const discs = s.disciplines.map(([d, n]) => ({
      key: d, n, label: discLabel(d), warn: d === 'OTHER', color: discColor(d, settings.disciplineColors),
    }));
    const discCount = discs.filter((d) => !d.warn).length;
    // Raised by: the four biggest parties, the rest as "Others", no-name last.
    const named = s.parties.filter(([p]) => p);
    const noName = s.parties.find(([p]) => !p)?.[1] || 0;
    const top = named.slice(0, 4);
    const rest = named.slice(4).reduce((t, [, n]) => t + n, 0);
    const partyRows = [
      ...top.map(([p, n], i) => ({ key: p, label: p, n, color: PARTY_COLORS[i] })),
      ...(rest ? [{ key: '_rest', label: `Others (${named.length - 4})`, n: rest, color: '#8a94a8' }] : []),
      ...(noName ? [{ key: '_none', label: 'No name', n: noName, warn: true }] : []),
    ];
    const issues = [c.unassigned > 0, c.vpNoPhoto > 0, c.noCommenter > 0, c.dupIds > 0, c.empty > 0].filter(Boolean).length;
    const viewBtn = (filter, label = 'View') => onView && (
      <button type="button" disabled={busy} onClick={() => onView(filter)} className="t-press rounded-[10px] px-2 py-1.5 text-[13px] font-semibold text-primary hover:bg-primary-container disabled:opacity-40">{label}</button>
    );
    const busiest = s.busiestDay;
    const statusNote = s.statuses.length === 1 ? `all ${s.statuses[0][0] || 'Open'}` : s.statuses.map(([k, n]) => `${n} ${k}`).join(' · ');

    return (
      <div ref={body} className="bg-surface">
        <div className="flex flex-wrap items-start gap-3.5">
          <div className="min-w-0 flex-[999_1_360px]">
            <h2 id="imp-sum-title" tabIndex={-1} data-autofocus className="text-[22px] font-bold outline-none" style={{ textWrap: 'balance' }}>{confirm ? 'Check this import' : 'Import summary'}</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              {confirm
                ? 'This is what Tabelin found in the report. Fix the setup first, or save now and sort it out in Work.'
                : `Imported ${fmtStamp(s.at)}${s.by ? ` by ${s.by}` : ''}${s.undone ? ' · undone afterwards' : ''}.`}
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2 rounded-control bg-surface-container px-3 py-2 text-[13px] text-on-surface-variant">
            <Icon name="description" className="text-[18px]" />
            <span className="truncate"><b className="text-on-surface">{s.file || 'report'}</b> · {plural(s.images, 'image')}{place ? ` · ${place}` : ''}</span>
          </div>
        </div>

        {s.merge && (
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 rounded-control bg-surface-container px-4 py-2.5 text-[13px]">
            <span className="font-semibold">Re-import:</span>
            <span><b className="tabular-nums">{s.merge.added}</b> new</span>
            <span><b className="tabular-nums">{s.merge.changed}</b> changed text</span>
            <span><b className="tabular-nums">{s.merge.matched}</b> already here</span>
            <span><b className="tabular-nums">{s.merge.missing}</b> no longer in the report</span>
          </div>
        )}

        <div className="mt-5 text-xs font-semibold uppercase tracking-[.08em] text-on-surface-variant">In this report</div>
        <div className="mt-2 grid grid-cols-5 gap-2.5">
          <Kpi n={s.comments.toLocaleString()} label="comments" note={statusNote} />
          <Kpi n={s.viewpoints.toLocaleString()} label="viewpoints" note={s.viewpoints ? `≈ ${(s.comments / s.viewpoints).toFixed(1)} comments each` : ''} />
          <Kpi n={s.vpWithPhoto.toLocaleString()} label="viewpoints with a photo" note={`of ${s.viewpoints.toLocaleString()}`} warn={c.vpNoPhoto > 0} />
          <Kpi n={s.commenters.toLocaleString()} label="commenters" note="from the “Name:” prefix" />
          <Kpi n={span(s.from, s.to) || '—'} label={s.from ? `${fmtDay(s.from)} – ${fmtDay(s.to)}` : 'no dates'} note={s.sessions ? plural(s.sessions, 'review session') : ''} />
        </div>

        <div className="mt-[18px] grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-[18px]">
          <Box tag="By discipline" title={`${plural(discCount, 'discipline')} found`} sub="Read from the comment text. Unassigned comments have no discipline yet.">
            <Bars rows={discs} max={Math.max(...discs.map((d) => d.n))} />
          </Box>
          <Box tag="Check before you start" title={issues ? `${plural(issues, 'thing')} to look at` : 'All clear'}
            sub={confirm ? '“View” saves the import and opens exactly those comments in Work.' : '“View” opens those comments in Work.'}>
            <div className="grid gap-2">
              {c.unassigned > 0
                ? <Check title={`${plural(c.unassigned, 'comment')} ${c.unassigned === 1 ? 'has' : 'have'} no discipline`} note={`${Math.round((c.unassigned / s.comments) * 100)}% · add a rule in Settings › Detection, or assign them in Work.`} action={viewBtn({ discipline: 'OTHER', status: '!done' })} />
                : <Check ok title="Every comment has a discipline" />}
              {c.vpNoPhoto > 0
                ? <Check title={`${plural(c.vpNoPhoto, 'viewpoint')} ${c.vpNoPhoto === 1 ? 'has' : 'have'} no photo`} note="Their image files weren’t in the upload. Pick the report together with its images (or a .zip)."
                    action={confirm && onPickAgain && <button type="button" disabled={busy} onClick={onPickAgain} className="t-press rounded-[10px] px-2 py-1.5 text-[13px] font-semibold text-primary hover:bg-primary-container disabled:opacity-40">Pick again</button>} />
                : <Check ok title="Every viewpoint has a photo" />}
              {c.noCommenter > 0
                ? <Check title={`${plural(c.noCommenter, 'comment')} ${c.noCommenter === 1 ? 'has' : 'have'} no commenter`} note="No “Name:” at the start of the text." action={viewBtn({ commenter: '', status: 'all' })} />
                : <Check ok title="Every comment has a commenter" />}
              {c.dupIds > 0
                ? <Check title={`${plural(c.dupIds, 'duplicate comment ID')}`} note="A re-import may not match these comments one to one." />
                : <Check ok title="No duplicate comment IDs" note="A re-import later will match every comment." />}
              {c.empty > 0
                ? <Check title={`${plural(c.empty, 'empty comment')}`} note="The comment text is blank." />
                : <Check ok title="No empty comments" />}
            </div>
          </Box>
        </div>

        <div className="mt-6 text-xs font-semibold uppercase tracking-[.08em] text-on-surface-variant">Who and when</div>
        <div className="mt-2 grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-[18px]">
          <Box tag="Raised by" title={top[0] ? `Most comments come from ${top[0][0]}` : 'No commenter names'} sub="Grouped by the party before the name (CPY_Jefry → CPY).">
            <div className="mb-3 flex h-3.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              {partyRows.map((r) => <span key={r.key} style={{ flex: r.n, background: r.warn ? WARN_STRIPES : r.color }} />)}
            </div>
            <Bars rows={partyRows} max={Math.max(...partyRows.map((r) => r.n), 1)} />
            {s.people.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Top commenters">
                {s.people.map(([p, n]) => <span key={p} className="rounded-full bg-surface-container px-2.5 py-1 text-[12.5px]">{p}<b className="ml-1 tabular-nums">{n}</b></span>)}
                {s.commenters > s.people.length && <span className="rounded-full px-2.5 py-1 text-[12.5px] text-on-surface-variant">+ {s.commenters - s.people.length} more</span>}
              </div>
            )}
          </Box>
          <Box tag="When comments were written" title={s.sessions ? `${plural(s.sessions, 'review session')}${s.from ? ` over ${span(s.from, s.to)}` : ''}` : 'No dates'} sub="Comments per month, from the dates in the report.">
            <Timeline months={s.months} />
            {busiest && (
              <div className="mt-2 flex flex-wrap gap-2 text-[12.5px] text-on-surface-variant">
                <span>Busiest day: <b className="text-on-surface">{fmtDay(busiest.day)} · {busiest.n}</b></span>
                <span>·</span>
                <span>Oldest comment: {fmtDay(s.from)}</span>
              </div>
            )}
          </Box>
        </div>
      </div>
    );
  })();

  const png = async () => {
    try { await snapshotNode(body.current, `import-${(s.at || '').slice(0, 10)}`); } catch { /* ignore */ }
  };

  return (
    <Dialog open={open && !!s} onClose={busy ? undefined : onClose} labelledBy="imp-sum-title" width={1040}>
      {content}
      <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-outline-variant pt-4">
        <Button variant="text" icon="download" onClick={png} disabled={busy}>Download PNG</Button>
        <span className="mr-auto text-[13px] text-on-surface-variant">{confirm ? 'Nothing is saved until you press Save.' : ''}</span>
        {confirm ? (
          <>
            <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="filled" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : `Save ${plural(s?.comments || 0, 'comment')}`}</Button>
          </>
        ) : <Button variant="filled" onClick={onClose}>Close</Button>}
      </div>
    </Dialog>
  );
}
