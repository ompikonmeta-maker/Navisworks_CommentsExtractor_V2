// =====================================================================
// Text-field extraction engine (v1.1). A single, data-driven extractor used
// for both Commenter and Discipline detection, configured by the user in
// Settings so a future project with a different comment format needs no code
// change. A config is a list of RULES tried in order (first non-empty wins),
// plus normalization; discipline additionally constrains the result to a list.
// =====================================================================

export const RULE_MODES = [
  { mode: 'delimiter', label: 'Text before delimiter' },
  { mode: 'after', label: 'Text after delimiter (rest)' },
  { mode: 'brackets', label: 'Text inside brackets' },
  { mode: 'keyword', label: 'Text after keyword' },
  { mode: 'word', label: 'Nth word' },
  { mode: 'list', label: 'Any word from the list' }, // discipline-style scan
  { mode: 'regex', label: 'Regex (capture group 1)' },
];
export const DELIMITERS = [
  [':', 'colon  :'], ['-', 'dash  -'], ['|', 'pipe  |'], ['>', 'angle  >'], [']', 'bracket  ]'],
];
export const BRACKETS = [['[]', '[ ]'], ['()', '( )'], ['<>', '< >']];

// Defaults reproduce the pre-v1.1 behaviour exactly, so existing data is
// unaffected until the user changes a rule.
export const DEFAULT_DETECT = {
  commenter: { rules: [{ mode: 'delimiter', delim: ':' }], strip: true, case: 'none', constrain: false },
  discipline: { rules: [{ mode: 'delimiter', delim: ':' }, { mode: 'list' }], strip: true, case: 'upper', constrain: true },
  // Comment body: everything AFTER the leading "Name:" prefix. Empty result
  // (no name-like prefix) means "keep the original text" — callers fall back.
  comment: { rules: [{ mode: 'after', delim: ':' }], strip: false, case: 'none', constrain: false },
};

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function applyRule(text, r, allowed) {
  if (!text) return '';
  try {
    if (r.mode === 'delimiter') {
      const i = text.indexOf(r.delim);
      if (i <= 0) return '';
      const v = text.slice(0, i);
      // A long multi-word head before the delimiter is a sentence, not a tag.
      return v.trim().includes(' ') && v.length > 24 ? '' : v;
    }
    if (r.mode === 'after') {
      // The remainder after the delimiter — but only when the head before it
      // looks like a name/tag (same guard as `delimiter`), so a sentence that
      // merely contains the delimiter is left whole.
      const i = text.indexOf(r.delim);
      if (i <= 0) return '';
      const head = text.slice(0, i).trim();
      if (head.includes(' ') && head.length > 24) return '';
      return text.slice(i + r.delim.length).trim();
    }
    if (r.mode === 'brackets') {
      const o = r.br?.[0];
      const c = r.br?.[1];
      const i = text.indexOf(o);
      if (i < 0) return '';
      const j = text.indexOf(c, i + 1);
      if (j < 0) return '';
      return text.slice(i + 1, j);
    }
    if (r.mode === 'keyword') {
      const m = new RegExp(`\\b${esc(r.kw || 'By')}\\b[\\s:\\-]*([^\\s,;:\\-]+)`, 'i').exec(text);
      return m ? m[1] : '';
    }
    if (r.mode === 'word') {
      const parts = text.trim().split(/\s+/);
      return parts[(parseInt(r.idx, 10) || 1) - 1] || '';
    }
    if (r.mode === 'list') {
      const up = text.toUpperCase();
      for (const d of allowed) {
        if (d === 'OTHER') continue;
        if (new RegExp(`\\b${esc(d.toUpperCase())}\\b`).test(up)) return d;
      }
      return '';
    }
    if (r.mode === 'regex') {
      const m = new RegExp(r.pattern).exec(text);
      return m ? (m[1] ?? m[0]) : '';
    }
  } catch {
    return ''; // an invalid regex etc. just yields no match
  }
  return '';
}

function normalize(v, cfg) {
  if (!v) return '';
  let s = v.trim();
  // Strip leading/trailing separators & whitespace — but NOT brackets, which
  // can be part of a name like "OPS(Teguh)".
  if (cfg.strip) s = s.replace(/^[\s\-–—:|>.,;]+|[\s\-–—:|>.,;]+$/g, '').trim();
  if (cfg.case === 'upper') s = s.toUpperCase();
  else if (cfg.case === 'lower') s = s.toLowerCase();
  return s.trim();
}

/**
 * Extract a value from text using an ordered rule config.
 * @returns {{val: string, via: number}} via = 1-based rule index, 0 = fallback.
 */
export function extract(text, cfg, allowed = []) {
  const up = allowed.map((a) => a.toUpperCase());
  for (let i = 0; i < (cfg.rules || []).length; i += 1) {
    const v = normalize(applyRule(text, cfg.rules[i], allowed), cfg);
    if (v) {
      if (cfg.constrain && up.length && !up.includes(v.toUpperCase())) continue;
      return { val: v, via: i + 1 };
    }
  }
  return cfg.constrain ? { val: 'OTHER', via: 0 } : { val: '', via: 0 };
}
