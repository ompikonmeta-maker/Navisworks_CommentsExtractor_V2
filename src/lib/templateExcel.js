// =====================================================================
// Template-driven Excel export (zip/XML surgery — NOT ExcelJS).
//
// A user-supplied .xlsx is a ZIP of XML. We open it, edit ONLY the parts we
// need, and leave everything else (styles, drawings, embedded logos, media)
// byte-for-byte — so the template's look is preserved exactly (ExcelJS
// re-writes the whole book and mangles existing images, which is why we don't
// use it here).
//
// Two zones in the template:
//  • The LOG sheet — a repeating table. One record → one row. Columns are
//    located by a data-driven mapping (by header text / defined name / fixed
//    column), so a future layout change is a mapping edit, not a code change.
//  • DETAIL sheets — one page per item, driven by VLOOKUP(N2) into the log
//    sheet. We only set N2 and drop the before/after photos into the marked
//    image cells; the formulas fill the rest. Extra items clone a pattern
//    sheet verbatim. Optional "auto-repair" rewrites the detail VLOOKUP column
//    indexes to header-matching MATCH() so the sheet self-adjusts if columns
//    move.
// =====================================================================

async function getJSZip() {
  const mod = await import('jszip');
  return mod.default || mod;
}

// ---- small helpers ---------------------------------------------------
const xmlEsc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colToLetter = (n) => {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};
const letterToCol = (l) => {
  let n = 0;
  for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const EMU = 9525;

// Excel serial date (1900 system). Accepts Date | ISO string | serial number.
function toSerial(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((utc - Date.UTC(1899, 11, 30)) / 86400000);
}

// Resolve a sheet name → worksheet part path (xl/worksheets/sheetN.xml).
async function sheetPathMap(zip) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relMap = {};
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
  const out = {}; // name → { path, rid, sheetId }
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"[^>]*r:id="([^"]+)"/g)) {
    const target = relMap[m[3]] || '';
    out[m[1]] = { path: 'xl/' + target.replace(/^\/?xl\//, ''), rid: m[3], sheetId: +m[2] };
  }
  return { map: out, wb, rels, relMap };
}

// Parse a worksheet's cells (ref → { raw, s, t, inner }). Cheap, regex-based.
function readCells(sheetXml) {
  const cells = {};
  for (const m of sheetXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    cells[m[1]] = { attrs: m[2] || '', inner: m[3] || '' };
  }
  return cells;
}

function cellText(cell, shared) {
  if (!cell) return '';
  const t = /t="([^"]+)"/.exec(cell.attrs)?.[1];
  const v = /<v>([\s\S]*?)<\/v>/.exec(cell.inner)?.[1];
  const is = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cell.inner)?.[1];
  if (t === 's' && v != null) return (shared[+v] || '').trim();
  if (is != null) return is.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  if (v != null) return v.trim();
  return '';
}

async function sharedStrings(zip) {
  const f = zip.file('xl/sharedStrings.xml');
  if (!f) return [];
  const s = await f.async('string');
  const out = [];
  for (const m of s.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
  }
  return out;
}

// Defined names → cell ref (single-cell names only).
function definedNames(wbXml) {
  const out = {};
  for (const m of wbXml.matchAll(/<definedName name="([^"]+)"[^>]*>([^<]+)<\/definedName>/g)) {
    const ref = m[2];
    const cm = /'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)/.exec(ref);
    if (cm) out[m[1]] = { sheet: cm[1], cell: `${cm[2]}${cm[3]}` };
  }
  return out;
}

// =====================================================================
// Default mapping for the shipped "3D Model Log Sheet" template.
// =====================================================================
// Record fields a mapping row can bind to (source kind 'record'). Label first.
export const RECORD_FIELDS = [
  ['viewpoint', 'Viewpoint / Tag view'],
  ['commentText', 'Comment text (cleaned)'],
  ['commentRaw', 'Comment text (raw)'],
  ['commenter', 'Commenter'],
  ['discipline', 'Discipline'],
  ['resolution', 'Resolution'],
  ['status', 'Status'],
  ['closedAt', 'Closed at'],
  ['commentDate', 'Comment date'],
  ['authorCode', 'Author code (Navisworks User)'],
  ['cameraPosition', 'Camera position'],
  ['commentId', 'Comment ID'],
  ['imageRef', 'Image ref'],
  ['source', 'Source file'],
];

// A field row: { id, label, source:{kind:'record'|'const'|'attr', key}, by,
// value, format?, map?, and for attr: default?, multiline? }.
const f = (id, label, kind, key, by, value, extra = {}) => ({ id, label, source: { kind, key }, by, value, ...extra });

export const DEFAULT_TEMPLATE_MAPPING = {
  logSheet: {
    name: '3D Model Log Sheet',
    headerRow: 9,
    dataStartRow: 10,
    itemColumn: { by: 'column', value: 'A' },
    fields: [
      f('viewpoint', 'Tag view', 'record', 'viewpoint', 'header', 'TAG VIEW NO.'),
      f('commentDate', 'Date', 'record', 'commentDate', 'header', 'DATE', { format: 'date' }),
      f('unit', 'Unit', 'const', 'unit', 'header', 'UNIT'),
      f('phase', 'Phase', 'const', 'phase', 'header', 'PHASE', { format: 'number' }),
      f('commentText', 'Comment record', 'record', 'commentText', 'header', 'COMMENT RECORD'),
      f('evidence', 'Evidence / Data Required', 'attr', 'evidence', 'header', 'Evidence / Data Required', { default: '1. 3D snapshot\n2. Document', multiline: true }),
      f('applicability', 'Comment Applicability', 'attr', 'applicability', 'header', 'Comment Applicability', { default: 'OFA' }),
      f('commenter', 'Commenter', 'record', 'commenter', 'header', 'COMMENT Originator'),
      f('discipline', 'Discipline', 'record', 'discipline', 'header', 'CTR DISCIPLINE RESP'),
      f('resolution', 'Resolution', 'record', 'resolution', 'header', 'RESOLUTION'),
      f('actionBy', 'Action By', 'attr', 'actionBy', 'header', 'ACTION BY'),
      f('status', 'Status', 'record', 'status', 'header', 'CTR DISCIPLINE STATUS', { map: { Open: 'OPEN', 'In Review': 'IN REVIEW', Closed: 'CLOSED' } }),
      f('closedAt', 'Closing date', 'record', 'closedAt', 'header', 'CTR DISCIPLINE CLOSING DATE', { format: 'date' }),
      f('remarks', 'Remarks', 'attr', 'remarks', 'header', 'REMARKS', { multiline: true }),
    ],
  },
  detail: {
    patternSheet: '1',
    itemNumber: { by: 'cell', value: 'N2', name: 'ph_item' },
    imageBefore: { by: 'cell', value: 'C25', name: 'ph_before' },
    imageAfter: { by: 'cell', value: 'I25', name: 'ph_after' },
    vlookupAutoRepair: false,
  },
  // Export constants (filled in the dialog); referenced by const-kind fields.
  constants: { unit: '', phase: '' },
};

// Normalise a field row from the legacy `{ field: '@x' | 'x.y' | 'plain' }`
// shape to the new `{ source:{kind,key} }` shape (idempotent).
function normalizeField(fld, i = 0) {
  if (fld.source) return { id: fld.id || `f${i}`, label: fld.label || fld.source.key, ...fld };
  const raw = fld.field || '';
  let source;
  if (raw.startsWith('@')) source = { kind: 'const', key: raw.slice(1) };
  else if (raw.startsWith('x.')) source = { kind: 'attr', key: raw.slice(2) };
  else source = { kind: 'record', key: raw };
  const out = { id: fld.id || source.key || `f${i}`, label: fld.label || source.key, source, by: fld.by, value: fld.value };
  if (fld.format) out.format = fld.format;
  if (fld.map) out.map = fld.map;
  return out;
}

// Migrate a whole mapping to the new model (safe on already-new mappings).
export function migrateMapping(m) {
  if (!m || !m.logSheet) return m;
  const oldDefaults = m.extraDefaults || {};
  const fields = (m.logSheet.fields || []).map((fld, i) => {
    const nf = normalizeField(fld, i);
    if (nf.source.kind === 'attr' && nf.default === undefined && oldDefaults[nf.source.key] !== undefined) {
      nf.default = oldDefaults[nf.source.key];
    }
    return nf;
  });
  const { extraDefaults, ...rest } = m;
  return { ...rest, logSheet: { ...m.logSheet, fields } };
}

// A custom field's input type. Falls back to the old `multiline` flag so
// sessions saved before typed fields keep working.
export const attrType = (f) => f.ftype || (f.multiline ? 'multiline' : 'text');
// Render a stored custom value for a cell: checkbox fields hold an array, which
// joins either as "A, B" or as a numbered list down the cell.
export function joinAttrValue(value, join) {
  if (!Array.isArray(value)) return value;
  if (!value.length) return '';
  return join === 'list' ? value.map((v, i) => `${i + 1}. ${v}`).join('\n') : value.join(', ');
}

// The attribute registry = the attr-kind field rows (drives the drawer).
export function attrFields(mapping) {
  return (mapping?.logSheet?.fields || []).map(normalizeField).filter((x) => x.source.kind === 'attr');
}

// ---- column-first auto-mapping --------------------------------------
// Prefix for auto-defined custom fields, so they read apart from the parser
// keys (viewpoint, commentText, …).
export const CUSTOM_PREFIX = 'cf_';
const STATUS_MAP = { Open: 'OPEN', 'In Review': 'IN REVIEW', Closed: 'CLOSED' };
// Known template headers → the parser field / constant they should pull from.
const SYNONYMS = [
  [['tag view no', 'tag view', 'viewpoint', 'tag'], { kind: 'record', key: 'viewpoint' }],
  [['date', 'comment date'], { kind: 'record', key: 'commentDate', format: 'date' }],
  [['unit'], { kind: 'const', key: 'unit' }],
  [['phase'], { kind: 'const', key: 'phase', format: 'number' }],
  [['comment record', 'comment text', 'comment'], { kind: 'record', key: 'commentText' }],
  [['comment originator', 'originator', 'commenter'], { kind: 'record', key: 'commenter' }],
  [['ctr discipline resp', 'discipline resp', 'discipline'], { kind: 'record', key: 'discipline' }],
  [['resolution'], { kind: 'record', key: 'resolution' }],
  [['ctr discipline status', 'discipline status', 'status'], { kind: 'record', key: 'status', map: STATUS_MAP }],
  [['ctr discipline closing date', 'closing date', 'closed at'], { kind: 'record', key: 'closedAt', format: 'date' }],
  [['author', 'user'], { kind: 'record', key: 'authorCode' }],
];
const normH = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[\s:：.\-,]+$/, '').trim();
const slugKey = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';

// Guess which parser field / constant a template header should pull from.
// Exact (normalized) match only — a loose "contains" match wrongly grabs the
// many workflow columns ("SUBMISSION DATE TO CPY", "COMMENT ORIGINATOR REPLY",
// …) that share a generic word, so those are left blank instead.
export function autoMatchHeader(text) {
  const t = normH(text);
  if (!t) return null;
  for (const [names, target] of SYNONYMS) if (names.includes(t)) return target;
  return null;
}

// Build column-first field rows from the log header row (in column order).
// Matched headers bind to their field; unmatched ones become 'blank' rows
// (left untouched on export) carrying a suggested cf_ key for one-click define.
export function buildFieldsFromHeaders(headers) {
  return Object.entries(headers || {})
    .sort((a, b) => letterToCol(a[0]) - letterToCol(b[0]))
    .map(([col, text], i) => {
      const m = autoMatchHeader(text);
      const base = { id: `h_${col}_${i}`, label: text, by: 'header', value: text };
      if (m) {
        const out = { ...base, source: { kind: m.kind, key: m.key } };
        if (m.format) out.format = m.format;
        if (m.map) out.map = m.map;
        return out;
      }
      return { ...base, source: { kind: 'blank', key: '' }, suggestKey: CUSTOM_PREFIX + slugKey(text) };
    });
}

// ---- locator resolution ---------------------------------------------
// Returns a column NUMBER (1-based) for log fields, or a cell ref for scalars.
function resolveColumn(loc, ctx) {
  if (!loc) return null;
  if (loc.by === 'header') {
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
    const want = norm(loc.value);
    for (const [colLetter, text] of Object.entries(ctx.headers)) {
      if (norm(text) === want) return letterToCol(colLetter);
    }
    return null;
  }
  if (loc.by === 'name') {
    const dn = ctx.defined[loc.value];
    if (dn) return letterToCol(/([A-Z]+)\d+/.exec(dn.cell)[1]);
    return null;
  }
  if (loc.by === 'column') return letterToCol(String(loc.value).toUpperCase());
  return null;
}
function resolveCell(loc, ctx) {
  if (!loc) return null;
  if (loc.by === 'name' && ctx.defined[loc.value]) return ctx.defined[loc.value].cell;
  if (loc.by === 'cell') return String(loc.value).toUpperCase();
  return null;
}

// Read a sheet's header-row cells → { colLetter: text }.
async function readHeaderRow(zip, info, headerRow, shared) {
  const xml = await zip.file(info.path).async('string');
  const cells = readCells(xml);
  const headers = {};
  for (const [ref, c] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (m && +m[2] === headerRow) { const t = cellText(c, shared); if (t) headers[m[1]] = t; }
  }
  return headers;
}

// Auto-detect the log sheet: the sheet whose header row best matches the
// mapping's field header labels. Falls back to a /log/i name, then the
// configured name. Makes the export tolerant of a renamed sheet.
async function detectLogSheet(zip, map, mapping, shared) {
  const wantNames = mapping.logSheet.fields.map((f) => String(f.value || '').toLowerCase().replace(/[:：]\s*$/, '').trim());
  const hr = mapping.logSheet.headerRow;
  let best = null;
  for (const [name, info] of Object.entries(map)) {
    if (name.startsWith('__') || /^\d+$/.test(name)) continue; // skip meta + detail pages
    // eslint-disable-next-line no-await-in-loop
    const headers = await readHeaderRow(zip, info, hr, shared);
    const texts = Object.values(headers).map((t) => String(t).toLowerCase().replace(/[:：]\s*$/, '').trim());
    const score = wantNames.filter((w) => texts.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { name, info, headers, score };
  }
  if (best) return best;
  const byName = Object.keys(map).find((n) => /log/i.test(n) && !/^\d+$/.test(n));
  if (byName) return { name: byName, info: map[byName], headers: await readHeaderRow(zip, map[byName], hr, shared), score: 0 };
  const cfgName = mapping.logSheet.name;
  return map[cfgName] ? { name: cfgName, info: map[cfgName], headers: await readHeaderRow(zip, map[cfgName], hr, shared), score: 0 } : null;
}

// Pick the log sheet: honour an explicit mapping.logSheet.name that exists in
// the workbook; otherwise auto-detect by header match.
async function resolveLog(zip, map, mapping, shared) {
  const forced = mapping.logSheet?.name;
  if (forced && map[forced]) {
    return { name: forced, info: map[forced], headers: await readHeaderRow(zip, map[forced], mapping.logSheet.headerRow, shared), score: -1 };
  }
  return detectLogSheet(zip, map, mapping, shared);
}

// =====================================================================
// Inspect a template → structure for the mapping editor.
// =====================================================================
export async function inspectTemplate(bytes, headerRow) {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(bytes);
  const { map, wb } = await sheetPathMap(zip);
  const shared = await sharedStrings(zip);
  const defined = definedNames(wb);
  const hr = headerRow || DEFAULT_TEMPLATE_MAPPING.logSheet.headerRow;

  // Candidate log sheets = non-numeric, non-hidden-meta sheets; read each
  // one's header row so the picker can switch without re-inspecting.
  const candidateLogSheets = Object.keys(map).filter((n) => !/^\d+$/.test(n) && n !== 'Sheet1');
  const headersBySheet = {};
  for (const name of candidateLogSheets) {
    // eslint-disable-next-line no-await-in-loop
    headersBySheet[name] = await readHeaderRow(zip, map[name], hr, shared);
  }
  const auto = await detectLogSheet(zip, map, DEFAULT_TEMPLATE_MAPPING, shared);
  const logSheet = auto ? auto.name : candidateLogSheets[0] || DEFAULT_TEMPLATE_MAPPING.logSheet.name;
  const detailSheets = Object.keys(map).filter((n) => /^\d+$/.test(n)).sort((a, b) => +a - +b);
  return {
    sheetNames: Object.keys(map),
    candidateLogSheets,
    headersBySheet,
    logSheet, // auto-detected best guess
    headers: headersBySheet[logSheet] || {},
    detailSheets,
    definedNames: Object.keys(defined),
  };
}

// Resolve the full mapping against a template → preview rows. Uses the headers
// of the chosen log sheet (mapping.logSheet.name) when known.
export function resolveMapping(info, mapping) {
  const chosen = mapping.logSheet?.name;
  const headers = (chosen && info.headersBySheet?.[chosen]) || info.headers;
  const ctx = { headers, defined: {} };
  // defined names available as a set → map name→approx (not needed for preview col)
  const rows = [];
  const itemCol = resolveColumn(mapping.logSheet.itemColumn, ctx);
  rows.push({ field: 'ITEM (link)', col: itemCol ? colToLetter(itemCol) : null });
  for (const fld of mapping.logSheet.fields) {
    const col = resolveColumn(fld, ctx);
    rows.push({ field: fld.label || fld.source?.key || fld.field, col: col ? colToLetter(col) : null });
  }
  return { itemCol, rows };
}

// ---- value encoding for a log cell -----------------------------------
function encodeCell(ref, styleAttr, field, rec, constants) {
  const s = styleAttr ? ` s="${styleAttr}"` : '';
  const fld = field.source ? field : normalizeField(field);
  const src = fld.source;
  if (src.kind === 'blank') return `<c r="${ref}"${s}/>`;
  let raw = '';
  const fmt = fld.format;
  if (src.kind === 'const') raw = constants[src.key] ?? '';
  else if (src.kind === 'attr') {
    raw = rec.extra?.[src.key] ?? fld.default ?? '';
    if (Array.isArray(raw)) raw = joinAttrValue(raw, fld.join);
  } else raw = rec[src.key] ?? '';
  if (typeof raw === 'string' && raw.includes('\n')) {
    // numbered-list checkbox output → keep the in-cell line breaks visible.
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(raw)}</t></is></c>`;
  }
  if (fld.map && raw in fld.map) raw = fld.map[raw];
  if (raw === '' || raw == null) return `<c r="${ref}"${s}/>`;
  if (fmt === 'date') {
    const ser = toSerial(raw);
    if (ser != null) return `<c r="${ref}"${s}><v>${ser}</v></c>`;
    return `<c r="${ref}"${s}/>`;
  }
  if (fmt === 'number' || (typeof raw === 'number')) {
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace('%', '')) / (String(raw).includes('%') ? 100 : 1);
    if (!Number.isNaN(num)) return `<c r="${ref}"${s}><v>${num}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(raw)}</t></is></c>`;
}

// Build one log data row from a style-template row's per-column styles.
function buildRow(rowNum, rec, itemNo, colStyles, fieldByCol, itemCol, constants) {
  const cols = new Set([...Object.keys(colStyles).map(Number), ...fieldByCol.keys()]);
  if (itemCol) cols.add(itemCol);
  const ordered = [...cols].sort((a, b) => a - b);
  let cells = '';
  for (const c of ordered) {
    const ref = `${colToLetter(c)}${rowNum}`;
    const st = colStyles[c];
    if (c === itemCol) {
      cells += `<c r="${ref}"${st ? ` s="${st}"` : ''} t="inlineStr"><is><t>${itemNo}</t></is></c>`;
    } else if (fieldByCol.has(c)) {
      cells += encodeCell(ref, st, fieldByCol.get(c), rec, constants);
    } else if (st) {
      cells += `<c r="${ref}" s="${st}"/>`;
    }
  }
  return `<row r="${rowNum}">${cells}</row>`;
}

// Parse dataURL → { ext, base64, w, h } using PNG/JPEG header for size.
function parseImg(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const ext = /jpe?g/i.test(m[1]) ? 'jpeg' : 'png';
  const bin = atobBytes(m[2]);
  let w = 300;
  let h = 220;
  if (ext === 'png' && bin.length > 24) {
    w = (bin[16] << 24) | (bin[17] << 16) | (bin[18] << 8) | bin[19];
    h = (bin[20] << 24) | (bin[21] << 16) | (bin[22] << 8) | bin[23];
  } else if (ext === 'jpeg') {
    const d = jpegSize(bin);
    if (d) { w = d.w; h = d.h; }
  }
  return { ext, base64: m[2], w, h };
}
function atobBytes(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) a[i] = s.charCodeAt(i);
    return a;
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}
function jpegSize(b) {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

// one-cell anchored picture XML (no stretch), sized to fit `maxPx`.
function picAnchor(colIdx0, rowIdx0, img, rid, id, maxPx = 330) {
  const s = Math.min(1, maxPx / Math.max(img.w, img.h));
  const cx = Math.round(img.w * s * EMU);
  const cy = Math.round(img.h * s * EMU);
  return (
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${colIdx0}</xdr:col><xdr:colOff>19050</xdr:colOff>` +
    `<xdr:row>${rowIdx0}</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="ba${id}"/>` +
    `<xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill>` +
    `<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
  );
}

// =====================================================================
// Fill the template. Returns Uint8Array of the produced .xlsx.
// =====================================================================
export async function fillTemplate(bytes, records, rawMapping, constants = {}) {
  const mapping = migrateMapping(rawMapping);
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(bytes);
  const { map, wb, rels } = await sheetPathMap(zip);
  const shared = await sharedStrings(zip);
  const wbXml = wb;
  const defined = definedNames(wbXml);

  const logCfg = mapping.logSheet;
  const log = await resolveLog(zip, map, mapping, shared);
  if (!log) throw new Error(`Log sheet not found in template (expected something like "${logCfg.name}").`);
  const logInfo = log.info;
  const logName = log.name; // actual sheet name (may differ from the config)

  // --- resolve log columns ---
  let logXml = await zip.file(logInfo.path).async('string');
  const cells = readCells(logXml);
  const headers = log.headers;
  const ctx = { headers, defined };
  const itemCol = resolveColumn(logCfg.itemColumn, ctx);
  const fieldByCol = new Map();
  const headerTextByCol = {}; // col# → header text (for auto-repair)
  for (const [letter, text] of Object.entries(headers)) headerTextByCol[letterToCol(letter)] = text;
  for (const f of logCfg.fields) {
    if (f.source?.kind === 'blank') continue; // leave the template cell untouched
    const col = resolveColumn(f, ctx);
    if (col) fieldByCol.set(col, f);
  }

  // --- style-template from the first data row ---
  const colStyles = {};
  for (const [ref, c] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (m && +m[2] === logCfg.dataStartRow) {
      const st = /s="(\d+)"/.exec(c.attrs)?.[1];
      if (st != null) colStyles[letterToCol(m[1])] = st;
    }
  }

  // --- rebuild sheetData rows >= dataStartRow ---
  const start = logCfg.dataStartRow;
  const newRows = records.map((rec, i) => buildRow(start + i, rec, i + 1, colStyles, fieldByCol, itemCol, constants)).join('');
  logXml = logXml.replace(/<sheetData>([\s\S]*?)<\/sheetData>/, (whole, inner) => {
    const kept = [...inner.matchAll(/<row r="(\d+)"[\s\S]*?<\/row>|<row r="(\d+)"[^>]*\/>/g)]
      .filter((m) => +(m[1] || m[2]) < start)
      .map((m) => m[0])
      .join('');
    return `<sheetData>${kept}${newRows}</sheetData>`;
  });
  // --- log hyperlinks: ITEM column → detail sheet ---
  if (itemCol) {
    const hl = records
      .map((_, i) => `<hyperlink ref="${colToLetter(itemCol)}${start + i}" location="'${i + 1}'!A1" display="${i + 1}"/>`)
      .join('');
    if (/<hyperlinks>[\s\S]*?<\/hyperlinks>/.test(logXml)) logXml = logXml.replace(/<hyperlinks>[\s\S]*?<\/hyperlinks>/, `<hyperlinks>${hl}</hyperlinks>`);
    else logXml = logXml.replace(/(<\/sheetData>)/, `$1<hyperlinks>${hl}</hyperlinks>`);
  }
  // --- dimension refresh ---
  const lastRow = start + records.length - 1;
  logXml = logXml.replace(/<dimension ref="([A-Z]+)\d+:([A-Z]+)\d+"\/>/, (m, a, b) => `<dimension ref="${a}1:${b}${Math.max(lastRow, logCfg.headerRow)}"/>`);
  zip.file(logInfo.path, logXml);

  // --- detail sheets: ensure one per record, set N2 + images ---
  const existingDetails = Object.keys(map).filter((n) => /^\d+$/.test(n)).sort((a, b) => +a - +b);
  const patternName = mapping.detail.patternSheet || existingDetails[0] || '1';
  const patternInfo = map[patternName];
  const stats = { logRows: records.length, detailSheets: 0, images: 0, cloned: 0 };

  let mediaN = 1000;
  // Phase A — ensure every item has its own detail sheet, cloned from the
  // PRISTINE pattern. This must happen BEFORE any image is injected, otherwise
  // the first item's photo lives in the pattern's drawing and every later clone
  // inherits it (a photo leaking onto sheets that shouldn't have one).
  for (let i = 0; i < records.length; i += 1) {
    const name = String(i + 1);
    if (!map[name]) {
      map[name] = await cloneDetailSheet(zip, map, wbXml, rels, patternInfo, name, defined);
      stats.cloned += 1;
    }
  }
  // Phase B — fill each detail sheet: item number, clear placeholders, photos.
  for (let i = 0; i < records.length; i += 1) {
    const itemNo = i + 1;
    const name = String(itemNo);
    const info = map[name];
    stats.detailSheets += 1;
    // set N2 (item number)
    let dXml = await zip.file(info.path).async('string');
    const n2 = resolveCell(mapping.detail.itemNumber, ctx) || 'N2';
    dXml = setCellNumber(dXml, n2, itemNo);
    // clear image placeholder text + collect image cells
    const beforeCell = resolveCell(mapping.detail.imageBefore, ctx) || 'C25';
    const afterCell = resolveCell(mapping.detail.imageAfter, ctx) || 'I25';
    dXml = clearCellText(dXml, beforeCell);
    dXml = clearCellText(dXml, afterCell);
    // auto-repair VLOOKUP → MATCH by header text
    if (mapping.detail.vlookupAutoRepair) dXml = autoRepairVlookup(dXml, logName, headerTextByCol, logCfg.headerRow);
    zip.file(info.path, dXml);

    // inject before/after images (append to this sheet's drawing)
    const rec = records[i];
    const imgs = [];
    const b = parseImg(rec.imageData);
    const a = parseImg(rec.afterImageData);
    if (b) imgs.push({ img: b, cell: beforeCell });
    if (a) imgs.push({ img: a, cell: afterCell });
    if (imgs.length) {
      for (const im of imgs) { mediaN += 1; im.mediaName = `imageT${mediaN}.${im.img.ext}`; }
      await injectImages(zip, info, imgs);
      stats.images += imgs.length;
    }
  }

  // remove calcChain (Excel rebuilds; avoids stale refs after edits). Also drop
  // its content-type override AND the workbook relationship that points at it —
  // a relationship to a part we deleted is a dangling ref that makes Excel show
  // the "we found a problem with some content" repair prompt on open.
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    let ct = await zip.file('[Content_Types].xml').async('string');
    ct = ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    zip.file('[Content_Types].xml', ct);
    const wbRelsPath = 'xl/_rels/workbook.xml.rels';
    if (zip.file(wbRelsPath)) {
      let wr = await zip.file(wbRelsPath).async('string');
      wr = wr.replace(/<Relationship\b[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, '');
      zip.file(wbRelsPath, wr);
    }
  }
  // force full recalc so VLOOKUP/formatting recompute on open
  let wb2 = await zip.file('xl/workbook.xml').async('string');
  if (/<calcPr /.test(wb2)) wb2 = wb2.replace(/<calcPr [^>]*\/>/, '<calcPr calcId="0" fullCalcOnLoad="1"/>');
  zip.file('xl/workbook.xml', wb2);

  // JSZip records implicit folder entries as we add parts, but a workbook Excel
  // wrote has none. Delete just the folder markers from the entry map — NOT via
  // zip.remove(), which would recursively drop the folder's whole subtree.
  for (const p of Object.keys(zip.files)) { if (zip.files[p].dir) delete zip.files[p]; }

  const out = await zip.generateAsync({ type: typeof window === 'undefined' ? 'nodebuffer' : 'uint8array' });
  return { bytes: out, stats };
}

// ---- cell mutations --------------------------------------------------
function setCellNumber(xml, ref, num) {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  if (re.test(xml)) {
    return xml.replace(re, (m, attrs) => {
      const s = /s="\d+"/.exec(attrs)?.[0] || '';
      return `<c r="${ref}" ${s}><v>${num}</v></c>`.replace('  ', ' ');
    });
  }
  return xml; // ref not present → leave (formulas may still reference)
}
function clearCellText(xml, ref) {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  return xml.replace(re, (m, attrs) => {
    const s = /s="\d+"/.exec(attrs)?.[0] || '';
    return `<c r="${ref}" ${s}/>`.replace('  ', ' ');
  });
}
// Rewrite VLOOKUP(...,'Log'!A:X, <n>, ...) → MATCH by the header text at col n.
function autoRepairVlookup(xml, logName, headerTextByCol, headerRow) {
  const esc = logName.replace(/'/g, "''");
  const re = new RegExp(`(VLOOKUP\\([^,]+,\\s*'?${esc.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}'?![^,]+,\\s*)(\\d+)(\\s*,)`, 'g');
  return xml.replace(re, (whole, pre, idx, post) => {
    const text = headerTextByCol[+idx];
    if (!text) return whole;
    const match = `MATCH("${text.replace(/"/g, '""')}",'${esc}'!$A$${headerRow}:$XFD$${headerRow},0)`;
    return `${pre}${match}${post}`;
  });
}

// ---- detail-sheet clone (verbatim) ----------------------------------
async function cloneDetailSheet(zip, map, wbXml, wbRels, patternInfo, newName, defined) {
  // Pick a worksheet-part number not already present in the zip (workbook.xml
  // does NOT list part paths, so derive from the actual files to avoid
  // clobbering existing sheets).
  const usedSheet = Object.keys(zip.files)
    .map((p) => /xl\/worksheets\/sheet(\d+)\.xml$/.exec(p))
    .filter(Boolean)
    .map((m) => +m[1]);
  const sheetNo = Math.max(0, ...usedSheet) + 1;
  const newSheetFile = `xl/worksheets/sheet${sheetNo}.xml`;
  // copy sheet xml, patch N2 later by caller
  let sx = await zip.file(patternInfo.path).async('string');
  zip.file(newSheetFile, sx);

  // sheet rels (drawing + hyperlink + printer): clone drawing too
  const patRelsPath = patternInfo.path.replace(/worksheets\/(sheet\d+)\.xml/, 'worksheets/_rels/$1.xml.rels');
  let newDrawingNo = null;
  let relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  const patRelsFile = zip.file(patRelsPath);
  if (patRelsFile) {
    const pr = await patRelsFile.async('string');
    for (const m of pr.matchAll(/<Relationship Id="([^"]+)" Type="([^"]+)" Target="([^"]+)"([^>]*)\/>/g)) {
      const [, id, type, target, extra] = m;
      if (/\/drawing$/.test(type)) {
        // clone the drawing part
        const drawSrc = 'xl/' + target.replace(/^\.\.\//, '').replace(/^\/?xl\//, '');
        const drNoMatch = /drawing(\d+)\.xml/.exec(target);
        const allDraw = Object.keys(zip.files).map((f) => /xl\/drawings\/drawing(\d+)\.xml$/.exec(f)).filter(Boolean).map((x) => +x[1]);
        newDrawingNo = Math.max(0, ...allDraw) + 1;
        const drXml = await zip.file(drawSrc).async('string');
        zip.file(`xl/drawings/drawing${newDrawingNo}.xml`, drXml);
        // clone drawing rels (same media targets)
        const drRelsSrc = drawSrc.replace(/drawings\/(drawing\d+)\.xml/, 'drawings/_rels/$1.xml.rels');
        if (zip.file(drRelsSrc)) {
          const drRels = await zip.file(drRelsSrc).async('string');
          zip.file(`xl/drawings/_rels/drawing${newDrawingNo}.xml.rels`, drRels);
        }
        relsXml += `<Relationship Id="${id}" Type="${type}" Target="../drawings/drawing${newDrawingNo}.xml"/>`;
      } else if (/\/printerSettings$/.test(type)) {
        // skip printer settings (optional) to avoid dangling parts
      } else {
        relsXml += `<Relationship Id="${id}" Type="${type}" Target="${target}"${extra ? '' : ''}/>`;
      }
    }
  }
  relsXml += '</Relationships>';
  const newRelsFile = newSheetFile.replace(/worksheets\/(sheet\d+)\.xml/, 'worksheets/_rels/$1.xml.rels');
  zip.file(newRelsFile, relsXml);

  // register in [Content_Types]
  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!new RegExp(`/xl/worksheets/sheet${sheetNo}\\.xml"`).test(ct)) {
    ct = ct.replace('</Types>', `<Override PartName="/${newSheetFile}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  }
  if (newDrawingNo && !new RegExp(`/xl/drawings/drawing${newDrawingNo}\\.xml"`).test(ct)) {
    ct = ct.replace('</Types>', `<Override PartName="/xl/drawings/drawing${newDrawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  }
  zip.file('[Content_Types].xml', ct);

  // register in workbook rels + workbook.xml <sheets>
  let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const usedRid = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1]);
  const newRid = `rId${Math.max(0, ...usedRid) + 1}`;
  rels = rels.replace('</Relationships>', `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNo}.xml"/></Relationships>`);
  zip.file('xl/_rels/workbook.xml.rels', rels);

  let wx = await zip.file('xl/workbook.xml').async('string');
  const usedSid = [...wx.matchAll(/sheetId="(\d+)"/g)].map((m) => +m[1]);
  const newSid = Math.max(0, ...usedSid) + 1;
  wx = wx.replace(/(<\/sheets>)/, `<sheet name="${newName}" sheetId="${newSid}" r:id="${newRid}"/>$1`);
  zip.file('xl/workbook.xml', wx);

  return { path: newSheetFile, rid: newRid, sheetId: newSid };
}

// ---- inject before/after images into a detail sheet's drawing --------
async function injectImages(zip, sheetInfo, imgs) {
  const relsPath = sheetInfo.path.replace(/worksheets\/(sheet\d+)\.xml/, 'worksheets/_rels/$1.xml.rels');
  let sheetRels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  // find (or create) this sheet's drawing part
  let drawingNo;
  const drRel = /Target="\.\.\/drawings\/drawing(\d+)\.xml"/.exec(sheetRels);
  if (drRel) drawingNo = +drRel[1];
  if (!drawingNo) {
    const allDraw = Object.keys(zip.files).map((f) => /xl\/drawings\/drawing(\d+)\.xml$/.exec(f)).filter(Boolean).map((x) => +x[1]);
    drawingNo = Math.max(0, ...allDraw) + 1;
    zip.file(`xl/drawings/drawing${drawingNo}.xml`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>');
    zip.file(`xl/drawings/_rels/drawing${drawingNo}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    // attach to sheet
    const usedRid = [...sheetRels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1]);
    const rid = `rId${Math.max(0, ...usedRid) + 1}`;
    sheetRels = sheetRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`);
    zip.file(relsPath, sheetRels);
    let sx = await zip.file(sheetInfo.path).async('string');
    if (!/xmlns:r=/.test(sx)) sx = sx.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    if (!/<drawing /.test(sx)) sx = sx.replace('</worksheet>', `<drawing r:id="${rid}"/></worksheet>`);
    zip.file(sheetInfo.path, sx);
  }
  const drPath = `xl/drawings/drawing${drawingNo}.xml`;
  const drRelsPath = `xl/drawings/_rels/drawing${drawingNo}.xml.rels`;
  let dr = await zip.file(drPath).async('string');
  let drRels = zip.file(drRelsPath) ? await zip.file(drRelsPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const usedRid = [...drRels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1]);
  let rid = Math.max(0, ...usedRid);
  const usedPicId = [...dr.matchAll(/cNvPr id="(\d+)"/g)].map((m) => +m[1]);
  let picId = Math.max(0, ...usedPicId, 1000);
  let anchors = '';
  let relAdds = '';
  for (const im of imgs) {
    rid += 1; picId += 1;
    zip.file(`xl/media/${im.mediaName}`, im.img.base64, { base64: true });
    relAdds += `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${im.mediaName}"/>`;
    const m = /^([A-Z]+)(\d+)$/.exec(im.cell);
    const col0 = letterToCol(m[1]) - 1;
    const row0 = +m[2] - 1;
    anchors += picAnchor(col0, row0, im.img, `rId${rid}`, picId);
  }
  dr = dr.replace('</xdr:wsDr>', `${anchors}</xdr:wsDr>`);
  drRels = drRels.replace('</Relationships>', `${relAdds}</Relationships>`);
  zip.file(drPath, dr);
  zip.file(drRelsPath, drRels);
  // ensure content-types has image defaults + this drawing override
  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!/Extension="png"/.test(ct)) ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  if (!/Extension="jpeg"/.test(ct)) ct = ct.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  if (!new RegExp(`/xl/drawings/drawing${drawingNo}\\.xml"`).test(ct)) ct = ct.replace('</Types>', `<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  zip.file('[Content_Types].xml', ct);
}
