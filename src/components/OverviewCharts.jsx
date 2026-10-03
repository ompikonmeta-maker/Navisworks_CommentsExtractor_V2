// Overview charts — hand-drawn SVG so they follow the MD3 tokens in both themes
// (colours are CSS variables, so a theme switch needs no re-render) and stay
// light (no chart library). Every mark explains itself through a hover tooltip
// instead of on-chart labels.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AGE_BUCKETS } from '../lib/overview.js';

const DAY = 86400000;
export const DISC_NAMES = {
  PIP: 'Piping', STR: 'Structural', ELE: 'Electrical', INS: 'Instrument', TEL: 'Telecom', HVAC: 'HVAC',
  LOSPE: 'Loss prevention', HANDLING: 'Material handling', OTHER: 'No discipline',
};
export const discName = (k) => DISC_NAMES[k] || k;
export const discCode = (k) => (k === 'OTHER' ? '—' : k);
export const fmtDay = (t) => (t == null ? '—' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
export const fmtDayY = (t) => (t == null ? '—' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));

// Verdict → theme-aware status colours (good / warning / critical / neutral).
export const VERDICT = {
  ok: { fg: 'var(--tabelin-status-closed)', icon: 'check_circle', label: 'On track' },
  done: { fg: 'var(--tabelin-status-closed)', icon: 'check_circle', label: 'Done' },
  risk: { fg: 'var(--tabelin-status-review)', icon: 'warning', label: 'At risk' },
  bad: { fg: 'var(--tabelin-status-open)', icon: 'error', label: 'Behind' },
  triage: { fg: 'var(--md-sys-color-outline)', icon: 'help', label: 'Needs triage' },
  unknown: { fg: 'var(--md-sys-color-outline)', icon: 'help', label: 'No pace yet' },
};
export const tint = (c, p = 14) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
// Stripes for "middle" statuses (In Review…) so they differ from Open without
// relying on colour alone.
export const hatch = (c) => `repeating-linear-gradient(135deg, ${c} 0 3px, color-mix(in srgb, ${c} 50%, transparent) 3px 5.5px)`;

/* ---------------- tooltip ---------------- */
const TipCtx = createContext({ show: () => {}, hide: () => {} });
export function TipProvider({ children }) {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const show = useCallback((content, x, y) => setTip({ content, x, y }), []);
  const hide = useCallback(() => setTip(null), []);
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    let left = tip.x + 14, top = tip.y - h - 12;
    if (left + w > window.innerWidth - 8) left = tip.x - w - 14;
    if (left < 8) left = 8;
    if (top < 8) top = tip.y + 18;
    setPos({ left, top });
  }, [tip]);
  useEffect(() => {
    if (!tip) return undefined;
    const off = () => setTip(null);
    window.addEventListener('scroll', off, true);
    return () => window.removeEventListener('scroll', off, true);
  }, [tip]);
  return (
    <TipCtx.Provider value={{ show, hide }}>
      {children}
      {tip && createPortal(<div ref={ref} className="ov-tip" role="tooltip" style={pos}>{tip.content}</div>, document.body)}
    </TipCtx.Provider>
  );
}
export const useTip = () => useContext(TipCtx);
// Spread onto any element: hover/focus shows `content`.
export function useTipProps() {
  const { show, hide } = useTip();
  return (content) => ({
    onMouseMove: (e) => show(typeof content === 'function' ? content() : content, e.clientX, e.clientY),
    onMouseLeave: hide,
    onFocus: (e) => { const b = e.currentTarget.getBoundingClientRect(); show(typeof content === 'function' ? content() : content, b.left + b.width / 2, b.top); },
    onBlur: hide,
  });
}
export function TipRows({ title, rows = [], note }) {
  return (
    <>
      {title && <div className="font-semibold">{title}</div>}
      {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><span className="opacity-75">{k}</span><span className="tabular-nums">{v}</span></div>)}
      {note && <div className="mt-0.5 opacity-75">{note}</div>}
    </>
  );
}

/* ---------------- width hook ---------------- */
export function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ---------------- status bar ---------------- */
export function StatusBar({ statuses, counts, total, height = 14, onPick }) {
  const tp = useTipProps();
  const order = [...statuses].reverse(); // done → middle → open
  return (
    <div className="flex gap-[2px] overflow-hidden rounded-full" style={{ height }}>
      {order.map((s) => {
        const n = counts[s.label] || 0;
        if (!n) return null;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onPick?.(s.label)}
            className="h-full min-w-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={{ flex: n, background: s.role === 'middle' ? hatch(s.color) : s.color }}
            aria-label={`${s.label}: ${n}`}
            {...tp(<TipRows title={s.label} rows={[[`${n} comments`, `${total ? Math.round((n / total) * 100) : 0}%`]]} />)}
          />
        );
      })}
    </div>
  );
}

/* ---------------- forecast runway (comets) ---------------- */
export function ForecastRunway({ ov, onPick }) {
  const [ref, W] = useWidth();
  const { show, hide } = useTip();
  const [focus, setFocus] = useState(null);
  const animRef = useRef(true);
  useEffect(() => { const t = setTimeout(() => { animRef.current = false; }, 2000); return () => clearTimeout(t); }, []);
  const rows = [
    { key: 'ALL', all: true, remaining: ov.remaining, pct: ov.pct, pace: ov.pace, needed: ov.needed, forecast: ov.forecast, late: ov.late, verdict: ov.verdict || 'unknown' },
    ...ov.byForecast.map((d) => ({ ...d, verdict: d.verdict || 'unknown' })),
  ];
  const narrow = W < 640;
  const rowH = 46, m = { l: narrow ? 128 : 200, r: narrow ? 58 : 84, t: 44, b: 30 };
  const H = m.t + rows.length * rowH + 8 + m.b;
  const T = ov.today, tg = ov.target;
  const cap = T + 150 * DAY;
  const ends = rows.map((r) => r.forecast).filter((f) => f != null && f <= cap);
  const x0 = T - 3 * DAY;
  const x1 = Math.max(x0 + 45 * DAY, (tg ?? T) + 21 * DAY, ...ends.map((f) => f + 6 * DAY));
  const span = W - m.l - m.r - 22;
  const X = (t) => m.l + Math.min(1, Math.max(0, (t - x0) / (x1 - x0))) * span;
  const top = m.t - 8, bottom = m.t + rows.length * rowH + 4;
  const months = [];
  for (let d = new Date(x0); d.getTime() <= x1; d.setMonth(d.getMonth() + 1, 1)) { const t = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); if (t >= x0) months.push(t); }
  const weeksTicks = [];
  { const d = new Date(x0); d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); for (let t = d.getTime(); t <= x1; t += 7 * DAY) weeksTicks.push(t); }
  const anim = animRef.current;
  const focused = focus != null ? rows[focus] : null;

  return (
    <div ref={ref} className={`ov-runway ${focus != null ? 'is-focus' : ''}`} style={{ width: '100%', minWidth: 0, overflow: 'hidden', paddingTop: 2 }}>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Forecast finish per discipline">
          <defs>
            <pattern id="ovLate" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" style={{ fill: 'var(--tabelin-status-open)' }} opacity=".035" />
              <rect width="2" height="8" style={{ fill: 'var(--tabelin-status-open)' }} opacity=".1" />
            </pattern>
            <pattern id="ovChk" width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" style={{ fill: 'var(--md-sys-color-surface)' }} />
              <rect width="4" height="4" style={{ fill: 'var(--md-sys-color-on-surface)' }} />
              <rect x="4" y="4" width="4" height="4" style={{ fill: 'var(--md-sys-color-on-surface)' }} />
            </pattern>
            <filter id="ovGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="4" in="SourceGraphic" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {rows.map((r, i) => r.forecast != null && (
              <linearGradient key={i} id={`ovG${i}`} gradientUnits="userSpaceOnUse" x1={X(T)} x2={X(r.forecast)} y1="0" y2="0">
                <stop offset="0" style={{ stopColor: VERDICT[r.verdict].fg, stopOpacity: 0 }} />
                <stop offset="1" style={{ stopColor: VERDICT[r.verdict].fg, stopOpacity: 0.7 }} />
              </linearGradient>
            ))}
          </defs>
          {tg != null && <rect x={X(tg)} y={top} width={Math.max(0, W - m.r - X(tg) + 6)} height={bottom - top} rx="14" fill="url(#ovLate)" />}
          {weeksTicks.map((t) => <line key={t} x1={X(t)} x2={X(t)} y1={top} y2={bottom} className="ov-grid" />)}
          {months.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={bottom} y2={H - 20} className="ov-axis" />
              <text x={X(t) + 4} y={H - 8} className="ov-tick" fontWeight="600">{new Date(t).toLocaleDateString('en-GB', { month: 'short' })}</text>
            </g>
          ))}
          <line x1={X(T)} x2={X(T)} y1={top} y2={bottom} className="ov-today" />
          <rect x={X(T) - 23} y={top - 24} width="46" height="18" rx="9" className="ov-pill-bg" />
          <text x={X(T)} y={top - 11} textAnchor="middle" className="ov-pill-tx">Today</text>
          {tg != null && (
            <g>
              <rect x={X(tg) - 4} y={top} width="8" height={bottom - top} fill="url(#ovChk)" opacity=".9" />
              <rect x={X(tg) - 27} y={top - 26} width="54" height="22" rx="11" style={{ fill: 'var(--md-sys-color-on-surface)' }} />
              <text x={X(tg)} y={top - 11} textAnchor="middle" fontSize="11.5" fontWeight="700" style={{ fill: 'var(--md-sys-color-surface)' }}>{fmtDay(tg)}</text>
            </g>
          )}
          {rows.map((r, i) => {
            const cy = m.t + i * rowH + rowH / 2;
            const col = VERDICT[r.verdict].fg;
            const tx = X(T), has = r.forecast != null, over = has && r.forecast > x1, fx = has ? X(r.forecast) : tx;
            const rr = 12, circ = 2 * Math.PI * rr;
            const rad = r.all ? 13 : 6 + Math.sqrt(r.remaining / 70) * 6.5;
            const th = r.all ? 10 : 7;
            const badge = !has ? '—' : tg == null ? fmtDay(r.forecast) : r.late > 0 ? `+${r.late}d` : r.late === 0 ? 'on time' : `${r.late}d`;
            const bw = narrow ? 50 : 60, bx = W - bw - 4;
            const tipC = (
              <TipRows
                title={r.all ? 'All comments' : discName(r.key)}
                rows={[
                  ['Left', r.remaining], ['Closed', `${r.pct}%`],
                  ['Per day now / needed', `${r.pace.toFixed(1)} / ${r.needed == null ? '—' : r.needed.toFixed(1)}`],
                  ['Finish', has ? fmtDayY(r.forecast) : 'no close-outs in 14 days'],
                ]}
              />
            );
            const enter = (e) => { setFocus(i); const b = e.currentTarget.getBoundingClientRect(); show(tipC, e.clientX ?? b.left + fx, e.clientY ?? b.top); };
            const leave = () => { setFocus(null); hide(); };
            return (
              <g key={r.key} className={`ov-row ${focus === i ? 'on' : ''}`}>
                {r.all && <rect x="4" y={cy - rowH / 2 + 3} width={W - 8} height={rowH - 6} rx="14" className="ov-allrow" />}
                <circle cx="22" cy={cy} r={rr} fill="none" className="ov-ring-track" strokeWidth="3.5" />
                <circle cx="22" cy={cy} r={rr} fill="none" strokeWidth="3.5" strokeLinecap="round" style={{ stroke: 'var(--tabelin-status-closed)' }} strokeDasharray={`${(circ * r.pct) / 100} ${circ}`} transform={`rotate(-90 22 ${cy})`} />
                <text x="22" y={cy + 3.5} textAnchor="middle" fontSize="8.5" fontWeight="700" className="ov-ink2">{r.pct}</text>
                <text x="44" y={narrow ? cy + 4 : cy - 2} fontSize={r.all ? 13 : 12} fontWeight="700" className={`ov-ink ${r.all ? '' : 'ov-mono'}`}>{r.all ? 'All' : r.key === 'OTHER' ? 'No disc.' : r.key}</text>
                {!narrow && <text x="44" y={cy + 13} fontSize="11" className="ov-ink3">{r.all ? 'whole review' : discName(r.key)}</text>}
                {has && <rect x={tx} y={cy - th / 2} width={Math.max(0, fx - tx)} height={th} rx={th / 2} fill={`url(#ovG${i})`} className={anim ? 'ov-grow' : ''} style={{ animationDelay: `${i * 45}ms` }} />}
                {has && (
                  <g className={anim ? 'ov-pop' : ''} style={{ animationDelay: `${450 + i * 45}ms` }}>
                    {r.all && <circle cx={fx} cy={cy} r={rad} className="ov-pulse" style={{ fill: col }} />}
                    <circle cx={fx} cy={cy} r={rad} filter="url(#ovGlow)" opacity=".9" style={{ fill: col }} />
                    <circle cx={fx} cy={cy} r={rad} strokeWidth="2.5" style={{ fill: col, stroke: 'var(--md-sys-color-surface)' }} />
                    {rad >= 10.5 && <text x={fx} y={cy + 3.8} textAnchor="middle" fontSize={r.all ? 10.5 : 9.5} fontWeight="700" style={{ fill: 'var(--ov-on-strong)' }}>{r.remaining}</text>}
                  </g>
                )}
                {over && <path d={`M${fx + rad + 5},${cy - 4}l4,4l-4,4M${fx + rad + 10},${cy - 4}l4,4l-4,4`} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: col }} />}
                <rect x={bx} y={cy - 11} width={bw} height="22" rx="11" style={{ fill: r.verdict === 'triage' || r.verdict === 'unknown' ? 'var(--md-sys-color-surface-container-high)' : tint(col, 16) }} />
                <text x={bx + bw / 2} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" style={{ fill: r.verdict === 'triage' || r.verdict === 'unknown' ? 'var(--md-sys-color-on-surface-variant)' : col }}>{badge}</text>
                <rect
                  x="0" y={cy - rowH / 2} width={W} height={rowH} fill="transparent" tabIndex={0}
                  style={{ cursor: r.all ? 'default' : 'pointer', outline: 'none' }}
                  onMouseMove={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}
                  onClick={() => !r.all && onPick?.(r.key)}
                />
              </g>
            );
          })}
          {focused && focused.forecast != null && (() => {
            const gx = Math.min(X(focused.forecast), W - m.r - 22);
            return (
              <g pointerEvents="none">
                <line x1={gx} x2={gx} y1={top} y2={bottom} className="ov-guide" />
                <rect x={gx - 30} y={bottom + 2} width="60" height="18" rx="9" style={{ fill: 'var(--md-sys-color-on-surface)' }} />
                <text x={gx} y={bottom + 15} textAnchor="middle" fontSize="10.5" fontWeight="700" style={{ fill: 'var(--md-sys-color-surface)' }}>{fmtDay(focused.forecast)}</text>
              </g>
            );
          })()}
        </svg>
      )}
    </div>
  );
}

/* ---------------- burn-up ---------------- */
export function BurnUp({ ov, height = 290 }) {
  const [ref, W] = useWidth();
  const { show, hide } = useTip();
  const [hx, setHx] = useState(null);
  const pts = ov.burnup;
  if (!pts.length) return <div ref={ref} className="grid place-items-center text-sm text-on-surface-variant" style={{ height }}>No dated comments yet.</div>;
  const H = height, m = { l: 40, r: 78, t: 30, b: 26 };
  const T = ov.today, tg = ov.target, f = ov.forecast != null && ov.forecast <= T + 150 * DAY ? ov.forecast : null;
  const x0 = pts[0].t, x1 = Math.max(T, f ?? T, tg ?? T) + 5 * DAY;
  const rawStep = Math.max(1, (ov.total * 1.05) / 4);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const ystep = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= rawStep);
  const ymax = ystep * 4;
  const X = (t) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const line = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t)},${Y(p[key])}`).join('');
  const area = `${line('closed')}L${X(pts[pts.length - 1].t)},${Y(0)}L${X(pts[0].t)},${Y(0)}Z`;
  const yt = [0, 1, 2, 3, 4].map((k) => k * ystep);
  const months = [];
  { const monthsSpan = Math.max(1, Math.round((x1 - x0) / (30.4 * DAY))); const fit = Math.max(2, Math.floor((W - m.l - m.r) / 56));
    const stepM = [1, 2, 3, 4, 6, 12].find((k) => monthsSpan / k <= fit) || 12; const d = new Date(x0); d.setDate(1); d.setMonth(d.getMonth() + 1);
    for (; d.getTime() <= x1; d.setMonth(d.getMonth() + stepM)) months.push(d.getTime()); }
  const near = hx == null ? null : pts.reduce((b, p) => (Math.abs(X(p.t) - hx) < Math.abs(X(b.t) - hx) ? p : b), pts[0]);
  return (
    <div ref={ref} style={{ height, width: '100%', minWidth: 0, overflow: 'hidden' }}>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={`Raised ${ov.total}, closed ${ov.done}`}>
          {yt.map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="ov-grid" /><text x={m.l - 8} y={Y(v) + 4} textAnchor="end" className="ov-tick">{v}</text></g>)}
          {months.map((t) => <text key={t} x={X(t)} y={H - 8} textAnchor="middle" className="ov-tick">{new Date(t).toLocaleDateString('en-GB', { month: 'short' })}{new Date(t).getMonth() === 0 ? ` ’${String(new Date(t).getFullYear()).slice(2)}` : ''}</text>)}
          {tg != null && <><line x1={X(tg)} x2={X(tg)} y1={m.t} y2={H - m.b} strokeWidth="1.5" style={{ stroke: 'var(--tabelin-status-review)' }} />
            <text x={X(tg) - 4} y={m.t - 8} textAnchor="end" fontSize="11" fontWeight="700" style={{ fill: 'var(--tabelin-status-review)' }}>{fmtDay(tg)}</text></>}
          <line x1={X(T)} x2={X(T)} y1={m.t} y2={H - m.b} className="ov-today" />
          <path d={area} style={{ fill: 'color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent)' }} />
          <path d={`${line('raised')}L${X(x1)},${Y(pts[pts.length - 1].raised)}`} fill="none" strokeWidth="2" strokeLinejoin="round" style={{ stroke: 'var(--md-sys-color-outline)' }} />
          <path d={line('closed')} fill="none" strokeWidth="2" strokeLinejoin="round" style={{ stroke: 'var(--md-sys-color-primary)' }} />
          {tg != null && ov.remaining > 0 && tg > T && <line x1={X(T)} y1={Y(ov.done)} x2={X(tg)} y2={Y(ov.total)} strokeWidth="1.5" strokeDasharray="2 3" style={{ stroke: 'var(--md-sys-color-on-surface-variant)' }} />}
          {f != null && ov.remaining > 0 && <>
            <line x1={X(T)} y1={Y(ov.done)} x2={X(f)} y2={Y(ov.total)} strokeWidth="2" strokeDasharray="5 4" style={{ stroke: 'var(--md-sys-color-primary)' }} />
            <circle cx={X(f)} cy={Y(ov.total)} r="4.5" strokeWidth="2" style={{ fill: 'var(--md-sys-color-surface)', stroke: 'var(--md-sys-color-primary)' }} /></>}
          <circle cx={X(T)} cy={Y(ov.done)} r="4.5" strokeWidth="2" style={{ fill: 'var(--md-sys-color-primary)', stroke: 'var(--md-sys-color-surface)' }} />
          <text x={W - m.r + 6} y={Y(ov.total) + 4} fontSize="12" fontWeight="700" className="ov-ink">{ov.total}</text>
          <text x={X(T) + 8} y={Y(ov.done) + 16} fontSize="12" fontWeight="700" style={{ fill: 'var(--md-sys-color-primary)' }}>{ov.done}</text>
          {near && <g pointerEvents="none">
            <line x1={X(near.t)} x2={X(near.t)} y1={m.t} y2={H - m.b} className="ov-guide" />
            <circle cx={X(near.t)} cy={Y(near.raised)} r="4" strokeWidth="2" style={{ fill: 'var(--md-sys-color-outline)', stroke: 'var(--md-sys-color-surface)' }} />
            <circle cx={X(near.t)} cy={Y(near.closed)} r="4" strokeWidth="2" style={{ fill: 'var(--md-sys-color-primary)', stroke: 'var(--md-sys-color-surface)' }} />
          </g>}
          <rect x={m.l} y={m.t} width={Math.max(0, W - m.l - m.r)} height={H - m.t - m.b} fill="transparent"
            onMouseMove={(e) => { const b = e.currentTarget.ownerSVGElement.getBoundingClientRect(); const x = e.clientX - b.left; setHx(x);
              const p = pts.reduce((bb, q) => (Math.abs(X(q.t) - x) < Math.abs(X(bb.t) - x) ? q : bb), pts[0]);
              show(<TipRows title={fmtDayY(p.t)} rows={[['Raised', p.raised], ['Closed', p.closed], ['Open', p.raised - p.closed]]} />, e.clientX, e.clientY); }}
            onMouseLeave={() => { setHx(null); hide(); }} />
        </svg>
      )}
    </div>
  );
}

/* ---------------- weekly close-outs ---------------- */
export function WeeklyPace({ ov, height = 220 }) {
  const [ref, W] = useWidth();
  const tp = useTipProps();
  const need = ov.needed != null ? ov.needed * 7 : null;
  const H = height, m = { l: 6, r: 6, t: 24, b: 24 };
  const ymax = Math.max(5, ...ov.weeks.map((w) => w.value), need ?? 0) * 1.12;
  const Y = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const n = ov.weeks.length, slot = (W - m.l - m.r) / n, bw = Math.max(6, Math.min(30, slot - 10));
  return (
    <div ref={ref} style={{ height, width: '100%', minWidth: 0, overflow: 'hidden' }}>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Closed per week, last 8 weeks">
          <line x1={m.l} x2={W - m.r} y1={Y(0)} y2={Y(0)} className="ov-axis" />
          {ov.weeks.map((w, i) => {
            const cx = m.l + slot * (i + 0.5), y = Y(w.value), last = i === n - 1;
            return (
              <g key={w.end}>
                {w.value > 0 && <path d={`M${cx - bw / 2},${Y(0)}V${y + 4}Q${cx - bw / 2},${y} ${cx - bw / 2 + 4},${y}H${cx + bw / 2 - 4}Q${cx + bw / 2},${y} ${cx + bw / 2},${y + 4}V${Y(0)}Z`} style={{ fill: 'var(--md-sys-color-primary)' }} opacity={last ? 1 : 0.5} />}
                {last && <text x={cx} y={y - 6} textAnchor="middle" fontSize="12" fontWeight="700" className="ov-ink">{w.value}</text>}
                {(i % 2 === 1 || last) && <text x={cx} y={H - 7} textAnchor="middle" className="ov-tick">{fmtDay(w.end)}</text>}
                <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent"
                  {...tp(<TipRows title={`Week to ${fmtDay(w.end)}`} rows={[['Closed', w.value], ...(need != null ? [['Needed', Math.ceil(need)]] : [])]} />)} />
              </g>
            );
          })}
          {need != null && <>
            <line x1={m.l} x2={W - m.r} y1={Y(need)} y2={Y(need)} strokeWidth="1.5" strokeDasharray="2 3" style={{ stroke: 'var(--md-sys-color-on-surface-variant)' }} pointerEvents="none" />
            <text x={W - m.r} y={Y(need) - 6} textAnchor="end" fontSize="11" fontWeight="700" className="ov-ink2">{Math.ceil(need)} needed</text></>}
        </svg>
      )}
    </div>
  );
}

/* ---------------- pipeline ---------------- */
const RAMP = ['30%', '48%', '66%', '84%', '100%'];
export function Pipeline({ ov, onPick }) {
  const tp = useTipProps();
  const total = ov.total || 1;
  return (
    <div className="flex flex-col gap-1">
      {ov.pipeline.map((s, i) => {
        const prev = i ? ov.pipeline[i - 1].value : null;
        const drop = prev != null ? prev - s.value : 0;
        return (
          <div key={s.key}>
            {drop > 0 && (
              <div className="ml-[132px] flex items-center gap-1 py-0.5 text-[11.5px] text-on-surface-variant sm:ml-[152px]">
                <span className="font-semibold tabular-nums" style={{ color: 'var(--tabelin-status-open)' }}>−{drop}</span> {s.drop}
              </div>
            )}
            <button type="button" onClick={() => onPick?.(s.key)} className="grid w-full grid-cols-[120px_1fr_48px] items-center gap-3 rounded-control text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[140px_1fr_56px]"
              {...tp(<TipRows title={s.label} rows={[[`${s.value} comments`, `${Math.round((s.value / total) * 100)}% of raised`]]} />)}>
              <span className="truncate text-[13px] font-medium">{s.label}</span>
              <span className="block h-[26px] rounded-[7px] transition-[filter] hover:brightness-110" style={{ width: `${Math.max(1.5, (s.value / total) * 100)}%`, background: `color-mix(in srgb, var(--md-sys-color-primary) ${RAMP[i]}, var(--md-sys-color-surface))` }} />
              <span className="text-right text-[13px] font-semibold tabular-nums">{s.value}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- backlog age heatmap ---------------- */
export function AgeHeatmap({ ov, onPick }) {
  const tp = useTipProps();
  const rows = ov.disciplines.filter((d) => d.remaining > 0).sort((a, b) => b.remaining - a.remaining);
  const max = Math.max(1, ...rows.flatMap((d) => d.ages));
  const shade = (v) => (v === 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999)));
  const bg = ['var(--md-sys-color-surface-container)', '22%', '45%', '70%', '100%'];
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[440px] gap-[3px] text-[12.5px]" style={{ gridTemplateColumns: '112px repeat(4, minmax(0,1fr)) 44px' }}>
        <div />
        {AGE_BUCKETS.map((b) => <div key={b.key} className="px-1 py-1 text-center text-[11px] font-semibold text-on-surface-variant">{b.label}</div>)}
        <div />
        {rows.map((d) => (
          <div key={d.key} className="contents">
            <button type="button" onClick={() => onPick?.(d.key)} className="truncate px-1.5 py-1.5 text-left font-medium hover:text-primary focus:outline-none focus-visible:text-primary">{discName(d.key)}</button>
            {d.ages.map((v, i) => {
              const s = shade(v);
              return (
                <div key={i} className="rounded-md py-1.5 text-center font-semibold tabular-nums" tabIndex={0}
                  style={{ background: s === 0 ? bg[0] : `color-mix(in srgb, var(--md-sys-color-primary) ${bg[s]}, var(--md-sys-color-surface))`, color: s >= 3 ? 'var(--ov-on-strong)' : 'var(--md-sys-color-on-surface)' }}
                  {...tp(<TipRows title={discName(d.key)} rows={[[`Waiting ${AGE_BUCKETS[i].long}`, v]]} />)}>
                  {v}
                </div>
              );
            })}
            <div className="py-1.5 text-right font-semibold tabular-nums">{d.remaining}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- raised by ---------------- */
export function RaisedBy({ ov }) {
  const tp = useTipProps();
  return (
    <div className="flex flex-col gap-3.5">
      {ov.parties.map((p) => (
        <div key={p.party} tabIndex={0} className="cursor-default rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          {...tp(<TipRows title={p.party} rows={[[`${p.done} of ${p.total} closed`, `${p.pct}%`]]} note={p.names.slice(0, 6).join(', ') + (p.names.length > 6 ? '…' : '')} />)}>
          <div className="mb-1.5 flex justify-between gap-2 text-[13px]">
            <span className="font-semibold">{p.party}</span>
            <span className="tabular-nums"><b className="font-semibold">{p.pct}%</b> <span className="text-on-surface-variant">of {p.total}</span></span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-high">
            <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: 'var(--md-sys-color-primary)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
