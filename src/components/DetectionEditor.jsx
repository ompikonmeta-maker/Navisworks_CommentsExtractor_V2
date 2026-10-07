import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { DISCIPLINES } from '../lib/parser.js';
import { extract, RULE_MODES, DELIMITERS, BRACKETS } from '../lib/detect.js';
import { Icon, Button, Select } from './ui.jsx';

const CASES = [['none', 'as-is'], ['upper', 'UPPER'], ['lower', 'lower']];
const inputCls = 'rounded-control border border-outline-variant bg-surface-low hover:border-outline px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

// Fresh params when switching a rule to a given mode.
function blankRule(mode) {
  if (mode === 'delimiter' || mode === 'after') return { mode, delim: ':' };
  if (mode === 'brackets') return { mode, br: '[]' };
  if (mode === 'keyword') return { mode, kw: 'By' };
  if (mode === 'word') return { mode, idx: 1 };
  if (mode === 'regex') return { mode, pattern: '^(\\w+)\\s*[:\\-]' };
  return { mode }; // list
}

export default function DetectionEditor() {
  const { records, applyDetect, notify } = useStore();
  const { settings, setDetect } = useSettings();
  const [kind, setKind] = useState('commenter'); // 'commenter' | 'discipline' | 'comment'
  const isDisc = kind === 'discipline';
  const isComment = kind === 'comment';
  const cfg = settings.detect[kind];

  const allowed = useMemo(
    () => (isDisc ? [...new Set([...DISCIPLINES, ...settings.customDisciplines])] : []),
    [isDisc, settings.customDisciplines]
  );

  // Preview + coverage over the whole dataset (examples show the first rows).
  // Detection always reads the RAW source text (before any cleaning).
  const preview = useMemo(() => {
    let hit = 0;
    const examples = [];
    for (const r of records) {
      const src = r.commentRaw ?? r.commentText;
      const { val, via } = extract(src, cfg, allowed);
      const detected = val && val !== 'OTHER';
      if (detected) hit += 1;
      // For comment cleaning, show the resulting body (empty → unchanged text).
      const shown = isComment ? (val || src) : val;
      if (examples.length < 8) examples.push({ text: src, val: shown, via });
    }
    const total = records.length || 1;
    return { hit, total, pct: Math.round((hit / total) * 100), examples };
  }, [records, cfg, allowed, isComment]);

  const write = (next) => setDetect(kind, next);
  const patchRule = (i, patch) => write({ ...cfg, rules: cfg.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setMode = (i, mode) => write({ ...cfg, rules: cfg.rules.map((r, j) => (j === i ? blankRule(mode) : r)) });
  const addRule = () => write({ ...cfg, rules: [...cfg.rules, blankRule('delimiter')] });
  const removeRule = (i) => write({ ...cfg, rules: cfg.rules.filter((_, j) => j !== i) });
  const move = (i, d) => {
    const rules = [...cfg.rules];
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    [rules[i], rules[j]] = [rules[j], rules[i]];
    write({ ...cfg, rules });
  };
  const setNorm = (patch) => write({ ...cfg, ...patch });

  const LABELS = { commenter: 'Commenter', discipline: 'Discipline', comment: 'Comment text' };
  const apply = (mode) => {
    applyDetect(kind, cfg, allowed, mode);
    notify(`${LABELS[kind]} detection applied (${mode === 'fill' ? 'filled empty' : 'overwrote all'}).`, 'success');
  };

  const barColor = preview.pct >= 75 ? 'bg-status-closed' : preview.pct >= 40 ? 'bg-status-review' : 'bg-status-open';

  return (
    <div>
      {/* tabs */}
      <div className="mb-4 inline-flex overflow-hidden rounded-full border border-outline text-sm">
        {[['commenter', 'Commenter'], ['discipline', 'Discipline'], ['comment', 'Comment text']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`px-4 py-1.5 font-medium ${kind === k ? 'bg-primary text-on-primary' : 'text-on-surface hover:bg-surface-container'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mb-3 text-xs text-on-surface-variant">
        {isComment
          ? 'The comment body — strips the leading commenter prefix (e.g. “CPY_Dito: …” → “…”). Use “Text after delimiter (rest)”. When nothing is stripped the original text is kept. Applying overwrites commentText everywhere (list, drawer, Excel & template export); the raw text is preserved internally for the other detectors.'
          : isDisc
            ? 'The engineering discipline. Rules are tried in order; results are then constrained to the discipline list (else OTHER).'
            : 'The person who wrote the comment. Rules are tried top-to-bottom until one captures a value.'}
      </p>

      {/* rules */}
      <div className="space-y-2">
        {cfg.rules.map((r, i) => (
          <div key={i} className="rounded-2xl border border-outline-variant bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary-container text-[11px] font-bold text-on-secondary-container">{i + 1}</span>
              <Select value={r.mode} onChange={(v) => setMode(i, v)} aria-label="Rule mode" options={RULE_MODES.map((m) => ({ value: m.mode, label: m.label }))} />

              {(r.mode === 'delimiter' || r.mode === 'after') && (
                <Select value={r.delim} onChange={(v) => patchRule(i, { delim: v })} aria-label="Delimiter" options={DELIMITERS.map(([v, l]) => ({ value: v, label: l }))} />
              )}
              {r.mode === 'brackets' && (
                <Select value={r.br} onChange={(v) => patchRule(i, { br: v })} aria-label="Brackets" options={BRACKETS.map(([v, l]) => ({ value: v, label: l }))} />
              )}
              {r.mode === 'keyword' && (
                <input className={`${inputCls} w-24 font-mono`} value={r.kw} onChange={(e) => patchRule(i, { kw: e.target.value })} placeholder="By" aria-label="Keyword" />
              )}
              {r.mode === 'word' && (
                <input className={`${inputCls} w-16 font-mono`} value={r.idx} onChange={(e) => patchRule(i, { idx: e.target.value })} aria-label="Word index" />
              )}
              {r.mode === 'regex' && (
                <input className={`${inputCls} min-w-[200px] flex-1 font-mono`} value={r.pattern} onChange={(e) => patchRule(i, { pattern: e.target.value })} aria-label="Regex pattern" />
              )}
              {r.mode === 'list' && <span className="text-xs text-on-surface-variant">scans the discipline list</span>}

              <span className="flex-1" />
              <IconBtn onClick={() => move(i, -1)} disabled={i === 0} label="Move up"><Icon name="chevron_right" className="-rotate-90 text-[18px]" /></IconBtn>
              <IconBtn onClick={() => move(i, 1)} disabled={i === cfg.rules.length - 1} label="Move down"><Icon name="chevron_right" className="rotate-90 text-[18px]" /></IconBtn>
              <IconBtn onClick={() => removeRule(i)} disabled={cfg.rules.length === 1} label="Remove rule" danger><Icon name="close" className="text-[18px]" /></IconBtn>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addRule} className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-dashed border-outline px-3.5 py-2 text-sm font-medium text-primary hover:bg-primary/5">
        <Icon name="upload_file" className="text-[16px]" /> Add rule
      </button>

      {/* normalization */}
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-outline-variant pt-4 text-sm">
        <span className="font-medium">Normalize:</span>
        <label className="inline-flex items-center gap-1.5 text-on-surface-variant">
          <input type="checkbox" checked={cfg.strip} onChange={(e) => setNorm({ strip: e.target.checked })} /> strip edge punctuation
        </label>
        <label className="inline-flex items-center gap-1.5 text-on-surface-variant">
          case
          <Select value={cfg.case} onChange={(v) => setNorm({ case: v })} aria-label="Case" options={CASES.map(([v, l]) => ({ value: v, label: l }))} />
        </label>
        {isDisc && (
          <label className="inline-flex items-center gap-1.5 text-on-surface-variant">
            <input type="checkbox" checked={cfg.constrain} onChange={(e) => setNorm({ constrain: e.target.checked })} /> only if in the discipline list, else <code className="rounded bg-surface-container px-1 text-xs">OTHER</code>
          </label>
        )}
      </div>
      {isDisc && cfg.constrain && (
        <div className="mt-2 text-xs text-on-surface-variant">
          <span className="font-medium">Discipline list</span> (from the Disciplines section):{' '}
          {allowed.filter((d) => d !== 'OTHER').map((d) => <code key={d} className="mx-0.5 rounded bg-surface-container px-1">{d}</code>)}
        </div>
      )}

      {/* preview */}
      <div className="mt-4 border-t border-outline-variant pt-4">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm font-bold tabular-nums">{preview.hit} / {preview.total}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-variant">
            <div className={`h-full ${barColor}`} style={{ width: `${preview.pct}%` }} />
          </div>
          <span className="text-sm font-bold tabular-nums">{preview.pct}%</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-on-surface-variant">
                <th className="pb-1.5 pr-2 font-semibold">Sample comment text</th>
                <th className="pb-1.5 pr-2 font-semibold">Detected</th>
                <th className="pb-1.5 font-semibold">Via</th>
              </tr>
            </thead>
            <tbody>
              {preview.examples.map((e, i) => (
                <tr key={i} className="border-t border-outline-variant/50">
                  <td className="py-1.5 pr-2 font-mono text-on-surface-variant">{e.text.length > 68 ? `${e.text.slice(0, 68)}…` : e.text}</td>
                  <td className="py-1.5 pr-2">{e.val ? <span className="font-semibold">{e.val}</span> : <span className="italic text-status-open">— none —</span>}</td>
                  <td className="py-1.5 text-[10.5px] text-on-surface-variant">{e.via ? `rule ${e.via}` : (e.val === 'OTHER' ? 'default' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => apply('fill')}>Apply — fill empty only</Button>
          <Button variant="tonal" onClick={() => apply('overwrite')}>Apply — overwrite all</Button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ onClick, disabled, danger, label, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-7 w-7 place-items-center rounded-lg text-on-surface-variant disabled:opacity-30 ${danger ? 'hover:bg-error/10 hover:text-error' : 'hover:bg-surface-container hover:text-primary'}`}
    >
      {children}
    </button>
  );
}
