import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { Icon, Button, Select, InfoTip } from './ui.jsx';
import {
  inspectTemplate,
  resolveMapping,
  fillTemplate,
  migrateMapping,
  buildFieldsFromHeaders,
  DEFAULT_TEMPLATE_MAPPING,
  RECORD_FIELDS,
  CUSTOM_PREFIX,
} from '../lib/templateExcel.js';
import { saveTemplate, loadTemplate, clearTemplate } from '../lib/persist.js';
import { inlineImages } from '../lib/server.js';

const BY_OPTS = [
  { value: 'header', label: 'By header' },
  { value: 'name', label: 'By name' },
  { value: 'column', label: 'By column' },
];
const CELL_BY = [
  { value: 'cell', label: 'By cell' },
  { value: 'name', label: 'By name' },
];
const KIND_OPTS = [
  { value: 'record', label: 'From data' },
  { value: 'const', label: 'Constant' },
  { value: 'attr', label: 'Custom' },
  { value: 'blank', label: 'Leave blank' },
];
const DETAIL_KIND_OPTS = [
  { value: 'record', label: 'From data' },
  { value: 'const', label: 'Constant' },
  { value: 'attr', label: 'Custom' },
];
const FMT_OPTS = [
  { value: 'text', label: 'text' },
  { value: 'date', label: 'date' },
  { value: 'number', label: 'number' },
];
const RECORD_OPTS = RECORD_FIELDS.map(([value, label]) => ({ value, label }));
// Subtle highlight on a Custom (cf_) field so it stands out from data/const.
const cfHighlight = 'rounded bg-status-review/10 ring-1 ring-status-review/40';

const inputCls =
  'rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
// Quiet field for the dense mapping table — no resting border/fill; frames up
// only on hover / focus so the table reads as data, not a wall of boxes.
const quietInput =
  'w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-xs text-on-surface transition-colors hover:bg-surface-container focus:border-primary focus:bg-surface focus:outline-none';
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';

const STEPS = [
  { key: 'template', label: 'Template' },
  { key: 'columns', label: 'Columns' },
  { key: 'detail', label: 'Detail' },
  { key: 'export', label: 'Export' },
];
const Check = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
);

function download(bytes, name, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TemplateExportPanel() {
  const { records, notify, renameAttr } = useStore();
  const { settings, setTemplateExport } = useSettings();
  const cfg = settings.templateExport;
  const fields = cfg.logSheet.fields;
  const [tpl, setTpl] = useState(null); // { name, bytes }
  const [info, setInfo] = useState(null); // inspect result
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [step, setStep] = useState(0); // 0 Template · 1 Columns · 2 Detail · 3 Export
  const fileRef = useRef(null);
  const jsonRef = useRef(null);

  useEffect(() => {
    (async () => {
      const saved = await loadTemplate();
      if (saved) { setTpl(saved); try { setInfo(await inspectTemplate(saved.bytes)); } catch (e) { setErr(e.message); } }
    })();
  }, []);

  const preview = useMemo(() => (info ? resolveMapping(info, cfg) : null), [info, cfg]);
  const activeFields = fields.filter((f) => f.source.kind !== 'blank');
  const resolvedCount = preview ? preview.rows.slice(1).filter((r, i) => fields[i]?.source.kind !== 'blank' && r.col).length : 0;
  const newCount = fields.filter((f) => f.source.kind === 'blank').length;

  // Re-inspect when the header row changes so the preview reads the right row.
  useEffect(() => {
    if (!tpl) return;
    (async () => { try { setInfo(await inspectTemplate(tpl.bytes, cfg.logSheet.headerRow)); } catch (e) { setErr(e.message); } })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.logSheet.headerRow]);

  // Pin the detected log/detail sheets on first inspect.
  useEffect(() => {
    if (!info) return;
    if (!info.candidateLogSheets?.includes(cfg.logSheet?.name)) setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, name: info.logSheet } }));
    if (info.detailSheets?.length && !info.detailSheets.includes(cfg.detail?.patternSheet)) setTemplateExport((c) => ({ ...c, detail: { ...c.detail, patternSheet: info.detailSheets[0] } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  const headersFor = (name) => info?.headersBySheet?.[name] || info?.headers || {};
  // Auto-build column rows on first load, while the field list is still the
  // shipped default (so we don't clobber a mapping the user tailored).
  const isDefaultFields = useMemo(() => JSON.stringify(fields) === JSON.stringify(DEFAULT_TEMPLATE_MAPPING.logSheet.fields), [fields]);
  useEffect(() => {
    if (!info) return;
    if (isDefaultFields) patchFields(() => buildFieldsFromHeaders(headersFor(cfg.logSheet.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, cfg.logSheet.name]);

  // ---- setters ----
  const setLogSheet = (name) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, name } }));
  const setPattern = (name) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, patternSheet: name } }));
  const setConst = (k, v) => setTemplateExport((c) => ({ ...c, constants: { ...c.constants, [k]: v } }));
  const setDetailFlag = (k, v) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, [k]: v } }));
  const setLog = (patch) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, ...patch } }));
  const setItemCol = (patch) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, itemColumn: { ...c.logSheet.itemColumn, ...patch } } }));
  const setDetailLoc = (key, patch) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, [key]: { ...c.detail[key], ...patch } } }));
  const patchFields = (fn) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, fields: fn(c.logSheet.fields) } }));
  const setField = (i, patch) => patchFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setFieldSource = (i, patch) => patchFields((fs) => fs.map((f, j) => (j === i ? { ...f, source: { ...f.source, ...patch } } : f)));
  const moveField = (i, d) => patchFields((fs) => { const j = i + d; if (j < 0 || j >= fs.length) return fs; const n = [...fs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const removeField = (i) => patchFields((fs) => fs.filter((_, j) => j !== i));
  const addField = () => patchFields((fs) => [...fs, { id: `f${Date.now()}`, label: 'New field', source: { kind: 'attr', key: `${CUSTOM_PREFIX}field_${fs.length + 1}` }, by: 'header', value: '' }]);
  const changeKind = (i, kind) => patchFields((fs) => fs.map((f, j) => {
    if (j !== i) return f;
    if (kind === 'record') return { ...f, source: { kind, key: RECORD_FIELDS[0][0] } };
    if (kind === 'blank') return { ...f, source: { kind, key: '' } };
    const key = f.source.key || f.suggestKey || (kind === 'attr' ? CUSTOM_PREFIX + slug(f.label) : slug(f.label));
    return { ...f, source: { kind, key } };
  }));
  const commitKey = (i, oldKey, raw) => {
    const newKey = slug(raw);
    if (!newKey || newKey === oldKey) return;
    setFieldSource(i, { key: newKey });
    if (fields[i]?.source.kind === 'attr') renameAttr(oldKey, newKey);
  };
  const defineBlank = (i) => patchFields((fs) => fs.map((f, j) => (j === i ? { ...f, source: { kind: 'attr', key: f.suggestKey || CUSTOM_PREFIX + slug(f.label) }, default: '' } : f)));
  const defineAllNew = () => patchFields((fs) => fs.map((f) => (f.source.kind === 'blank' ? { ...f, source: { kind: 'attr', key: f.suggestKey || CUSTOM_PREFIX + slug(f.label) }, default: '' } : f)));
  const rebuildFromHeaders = () => {
    if (!info) return;
    if (!isDefaultFields && !window.confirm('Rebuild the column list from the template? Your manual edits to the field rows will be replaced.')) return;
    patchFields(() => buildFieldsFromHeaders(headersFor(cfg.logSheet.name)));
  };
  const resetMapping = () => setTemplateExport(() => JSON.parse(JSON.stringify(DEFAULT_TEMPLATE_MAPPING)));

  // ---- detail-sheet field mapping (field → cell, written as values) ----
  const detailFields = cfg.detail.fields || [];
  const patchDetailFields = (fn) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, fields: fn(c.detail.fields || []) } }));
  const setDetailField = (i, patch) => patchDetailFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setDetailFieldSource = (i, patch) => patchDetailFields((fs) => fs.map((f, j) => (j === i ? { ...f, source: { ...f.source, ...patch } } : f)));
  const removeDetailField = (i) => patchDetailFields((fs) => fs.filter((_, j) => j !== i));
  const addDetailField = () => patchDetailFields((fs) => [...fs, { id: `d${Date.now()}`, source: { kind: 'record', key: RECORD_FIELDS[0][0] }, by: 'cell', value: '' }]);
  const changeDetailKind = (i, kind) => patchDetailFields((fs) => fs.map((f, j) => {
    if (j !== i) return f;
    if (kind === 'record') return { ...f, source: { kind, key: RECORD_FIELDS[0][0] } };
    const key = f.source.key || (kind === 'attr' ? `${CUSTOM_PREFIX}field` : 'const');
    return { ...f, source: { kind, key } };
  }));

  const constFields = fields.filter((f) => f.source.kind === 'const');
  const attrList = fields.map((f, i) => ({ f, i })).filter((x) => x.f.source.kind === 'attr');

  // ---- template + export ----
  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr('');
    const bytes = new Uint8Array(await f.arrayBuffer());
    setTpl({ name: f.name, bytes });
    try { await saveTemplate(f.name, bytes); } catch { notify('Couldn’t save the template for this project. It is used for this export only.', 'error'); }
    // A fresh template should re-map from its own columns.
    setTemplateExport(() => JSON.parse(JSON.stringify(DEFAULT_TEMPLATE_MAPPING)));
    try { setInfo(await inspectTemplate(bytes, cfg.logSheet.headerRow)); } catch (er) { setErr(`Couldn’t read template: ${er.message}`); setInfo(null); }
  };
  const removeTpl = async () => {
    try { await clearTemplate(); } catch { notify('Couldn’t remove the template.', 'error'); return; }
    setTpl(null); setInfo(null);
  };

  const doExport = async () => {
    if (!tpl) return;
    setBusy(true); setErr('');
    try {
      const { bytes, stats } = await fillTemplate(tpl.bytes, await inlineImages(records), cfg, cfg.constants || {});
      download(bytes, `3D-review-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
      notify(`Export done: ${stats.logRows} rows · ${stats.detailSheets} detail sheets · ${stats.images} images.`, 'success');
    } catch (e) { setErr(e.message); notify(`Export failed: ${e.message}`, 'error'); } finally { setBusy(false); }
  };
  const exportMapping = () => download(JSON.stringify(cfg, null, 2), 'tabelin-mapping.json', 'application/json');
  const importMapping = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const parsed = migrateMapping(JSON.parse(await f.text())); setTemplateExport(() => parsed); notify('Mapping imported.', 'success'); }
    catch (er) { notify(`Invalid mapping file: ${er.message}`, 'error'); }
    e.target.value = '';
  };

  // One calm pill per row — carries the resolved column letter, so the extra
  // "Col" column is gone. New = a template column with no data yet.
  const statusPill = (f, col) => {
    const dot = <span className="h-1.5 w-1.5 rounded-full bg-current" />;
    if (f.source.kind === 'blank')
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-status-review/15 px-2 py-0.5 text-[11px] font-bold text-status-review">{dot}New{col && <span className="font-mono opacity-70">{col}</span>}</span>;
    if (col)
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-status-closed/15 px-2 py-0.5 text-[11px] font-bold text-status-closed">{dot}Mapped<span className="font-mono opacity-70">{col}</span></span>;
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-status-open/15 px-2 py-0.5 text-[11px] font-bold text-status-open">{dot}No column</span>;
  };

  const stepper = (
    <div className="mx-auto flex w-full max-w-xl gap-1 rounded-full border border-outline-variant bg-surface-low p-1">
      {STEPS.map((s, i) => {
        const on = i === step;
        const done = i < step && (i === 0 ? !!tpl : !!info);
        const locked = i > 0 && !info;
        return (
          <button
            key={s.key}
            type="button"
            disabled={locked}
            onClick={() => setStep(i)}
            aria-current={on ? 'step' : undefined}
            className={`flex flex-1 items-center justify-center gap-2 rounded-full px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${on ? 'bg-white/25 text-on-primary' : done ? 'bg-status-closed text-white' : 'bg-surface-high text-on-surface-variant'}`}>
              {done ? <Check /> : i + 1}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        );
      })}
    </div>
  );

  const nextBtn = (to, label) => (
    <button onClick={() => setStep(to)} className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-container">
      {label} <Icon name="chevron_right" className="text-[16px]" />
    </button>
  );

  return (
    <div className="space-y-5 pb-4">
      {stepper}

      {/* ---------- STEP 1 · TEMPLATE & SHEETS ---------- */}
      {step === 0 && (
        <>
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" onChange={onPick} />
              <Button variant="tonal" icon="upload_file" onClick={() => fileRef.current?.click()}>{tpl ? 'Replace template…' : 'Choose template .xlsx…'}</Button>
              {tpl && <span className="text-sm font-medium">{tpl.name}</span>}
              {info && <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-[11px] font-bold text-on-surface-variant">{Object.keys(headersFor(cfg.logSheet.name)).length} columns read</span>}
              <span className="flex-1" />
              {tpl && <button onClick={removeTpl} className="rounded-full p-1.5 text-on-surface-variant hover:text-error" title="Remove template"><Icon name="close" className="text-[18px]" /></button>}
            </div>
            {info && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-on-surface-variant">
                  Log sheet
                  <Select className="mt-1 w-full" aria-label="Log sheet" value={cfg.logSheet?.name || info.logSheet} onChange={setLogSheet} options={(info.candidateLogSheets || []).map((n) => ({ value: n, label: n === info.logSheet ? `${n} (auto)` : n }))} />
                </label>
                <label className="text-xs font-medium text-on-surface-variant">
                  Detail sheet
                  <Select className="mt-1 w-full" aria-label="Detail sheet" value={cfg.detail?.patternSheet || info.detailSheets[0] || ''} onChange={setPattern} options={(info.detailSheets || []).map((n) => ({ value: n, label: n }))} />
                </label>
                <p className="text-[11px] text-on-surface-variant sm:col-span-2">Pick which sheet holds the comment table and which one is the per-item detail page. Saved in this browser.</p>
              </div>
            )}
            {err && <p className="mt-2 text-xs text-error">{err}</p>}
          </div>

          {!tpl && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Icon name="download" className="text-[40px] text-outline" />
              <div className="font-medium">Export into your Excel template</div>
              <p className="max-w-sm text-sm text-on-surface-variant">Choose a template .xlsx. The comment data fills the log sheet; each Tag View becomes a detail sheet with before/after photos. The template’s layout, logos and styling stay exactly as they are.</p>
            </div>
          )}

          {info && (
            <div className="rounded-2xl border border-outline-variant bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="inline-flex items-center gap-1.5 text-sm font-semibold">Log sheet structure <InfoTip label="About log sheet structure">Which rows and column the comment table uses. Set these once for your template.</InfoTip></div>
                <button onClick={resetMapping} className="text-xs font-medium text-primary hover:underline">Reset to default</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-medium text-on-surface-variant">
                  Header row
                  <input type="number" min={1} className={`${inputCls} mt-1 block w-full`} value={cfg.logSheet.headerRow} onChange={(e) => setLog({ headerRow: parseInt(e.target.value, 10) || 1 })} />
                </label>
                <label className="text-xs font-medium text-on-surface-variant">
                  First data row
                  <input type="number" min={1} className={`${inputCls} mt-1 block w-full`} value={cfg.logSheet.dataStartRow} onChange={(e) => setLog({ dataStartRow: parseInt(e.target.value, 10) || 1 })} />
                </label>
                <div className="text-xs font-medium text-on-surface-variant">
                  <span className="inline-flex items-center gap-1">Item column <InfoTip label="About the item column">The column whose cells link to each detail sheet. Usually the first column.</InfoTip></span>
                  <div className="mt-1 flex gap-1">
                    <Select className="dd-compact w-[120px]" aria-label="Item column locator" value={cfg.logSheet.itemColumn.by} onChange={(v) => setItemCol({ by: v })} options={BY_OPTS} />
                    <input className={`${inputCls} min-w-0 flex-1`} value={cfg.logSheet.itemColumn.value} onChange={(e) => setItemCol({ value: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex">{nextBtn(1, 'Continue to Columns')}</div>
            </div>
          )}
        </>
      )}

      {/* ---------- STEP 2 · COLUMN MAPPING ---------- */}
      {step === 1 && info && (
        <div className="rounded-2xl border border-outline-variant bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold">
              Column mapping
              <InfoTip label="About column mapping">Each row is a column from your template. Matched columns pull from your data; unmatched ones are new — define them to fill a value per comment. New keys get a “cf_” prefix.</InfoTip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {newCount > 0 && <button onClick={defineAllNew} className="rounded-full bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-high">Define all new ({newCount})</button>}
              <button onClick={rebuildFromHeaders} className="rounded-full bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-high">Rebuild from headers</button>
              <button onClick={addField} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary"><Icon name="upload_file" className="text-[15px]" /> Add field</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-on-surface-variant">
                  <th className="pb-1.5 pr-2 font-semibold">Label</th>
                  <th className="pb-1.5 pr-2 font-semibold">Source</th>
                  <th className="pb-1.5 pr-2 font-semibold">Field / key</th>
                  <th className="pb-1.5 pr-2 font-semibold">Find by</th>
                  <th className="pb-1.5 pr-2 font-semibold">Value</th>
                  <th className="pb-1.5 pr-2 font-semibold">Fmt</th>
                  <th className="pb-1.5 pr-2 font-semibold">Status</th>
                  <th className="pb-1.5 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => {
                  const row = preview.rows[i + 1];
                  const kind = f.source.kind;
                  return (
                    <tr key={f.id} className={`group border-t border-outline-variant/50 align-middle ${kind === 'blank' ? 'bg-status-review/5' : ''} hover:bg-surface-low`}>
                      <td className="py-0.5 pr-2"><input className={`${quietInput} w-[130px]`} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} /></td>
                      <td className="py-0.5 pr-2"><Select className="dd-quiet dd-compact w-[116px]" aria-label="Source" value={kind} onChange={(v) => changeKind(i, v)} options={KIND_OPTS} /></td>
                      <td className="py-0.5 pr-2">
                        {kind === 'record' ? (
                          <Select className="dd-quiet dd-compact w-[150px]" aria-label="Data field" value={f.source.key} onChange={(v) => setFieldSource(i, { key: v })} options={RECORD_OPTS} />
                        ) : kind === 'blank' ? (
                          <button onClick={() => defineBlank(i)} className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15">Define as {f.suggestKey || `${CUSTOM_PREFIX}${slug(f.label)}`}</button>
                        ) : (
                          <input key={f.id + kind} className={`${quietInput} w-[130px] font-mono ${kind === 'attr' ? cfHighlight : ''}`} defaultValue={f.source.key} onBlur={(e) => commitKey(i, f.source.key, e.target.value)} />
                        )}
                      </td>
                      <td className="py-0.5 pr-2"><Select className="dd-quiet dd-compact w-[116px]" aria-label="Find by" value={f.by} onChange={(v) => setField(i, { by: v })} options={BY_OPTS} /></td>
                      <td className="py-0.5 pr-2"><input className={`${quietInput} w-[150px] font-mono`} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} /></td>
                      <td className="py-0.5 pr-2"><Select className="dd-quiet dd-compact w-[92px]" aria-label="Format" value={f.format || 'text'} onChange={(v) => setField(i, { format: v === 'text' ? undefined : v })} options={FMT_OPTS} /></td>
                      <td className="py-0.5 pr-2">{statusPill(f, row?.col)}</td>
                      <td className="py-0.5 pl-1">
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button onClick={() => moveField(i, -1)} disabled={i === 0} className="grid h-6 w-6 place-items-center rounded text-on-surface-variant hover:bg-surface-container disabled:opacity-30" title="Move up"><Icon name="chevron_right" className="-rotate-90 text-[16px]" /></button>
                          <button onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} className="grid h-6 w-6 place-items-center rounded text-on-surface-variant hover:bg-surface-container disabled:opacity-30" title="Move down"><Icon name="chevron_right" className="rotate-90 text-[16px]" /></button>
                          <button onClick={() => removeField(i)} className="grid h-6 w-6 place-items-center rounded text-on-surface-variant hover:bg-error/10 hover:text-error" title="Remove"><Icon name="close" className="text-[16px]" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-on-surface-variant">
            <span className="font-bold text-status-closed">Mapped</span> pulls from your comments (its column letter is shown) · <span className="font-bold text-status-review">New</span> column isn’t in your data — Define it (key gets <span className="font-mono">cf_</span>) to fill it per comment · <span className="font-bold text-status-open">No column</span> means the header wasn’t found.
          </p>
          <div className="mt-3 flex">{nextBtn(2, 'Continue to Detail')}</div>
        </div>
      )}

      {/* ---------- STEP 3 · DETAIL & VALUES ---------- */}
      {step === 2 && info && (
        <>
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">Detail sheet cells <InfoTip label="About detail cells">On each detail sheet the tool sets the item number and drops the before/after photos into these cells. Field values are filled below (or by the template’s own formulas).</InfoTip></div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[['itemNumber', 'Item number'], ['imageBefore', 'Before image'], ['imageAfter', 'After image']].map(([key, label]) => (
                <div key={key} className="text-xs font-medium text-on-surface-variant">
                  {label}
                  <div className="mt-1 flex gap-1">
                    <Select className="dd-compact w-[108px]" aria-label={`${label} locator`} value={cfg.detail[key].by} onChange={(v) => setDetailLoc(key, { by: v })} options={CELL_BY} />
                    <input className={`${inputCls} min-w-0 flex-1 font-mono`} value={cfg.detail[key].value} onChange={(e) => setDetailLoc(key, { value: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
            <label className="mt-3 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!cfg.detail?.vlookupAutoRepair} onChange={(e) => setDetailFlag('vlookupAutoRepair', e.target.checked)} />
              <span className="inline-flex items-center gap-1.5">Auto-repair VLOOKUP <InfoTip label="About auto-repair">Only for templates that already use VLOOKUP: rewrites those formulas to look up by header text so they survive column moves. Not needed if you map the fields below.</InfoTip></span>
            </label>
          </div>

          {/* detail fields — write field values straight into detail cells */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-sm font-semibold">
                Detail fields
                <InfoTip label="About detail fields">For each item, the tool writes these field values straight into the detail sheet cells — no VLOOKUP needed, so it works with any template. Locate a cell by its reference (C7) or a Defined Name.</InfoTip>
              </div>
              <button onClick={addDetailField} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary"><Icon name="upload_file" className="text-[15px]" /> Add field</button>
            </div>
            {detailFields.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-on-surface-variant">
                      <th className="pb-1.5 pr-2 font-semibold">Source</th>
                      <th className="pb-1.5 pr-2 font-semibold">Field / key</th>
                      <th className="pb-1.5 pr-2 font-semibold">Find cell by</th>
                      <th className="pb-1.5 pr-2 font-semibold">Cell</th>
                      <th className="pb-1.5 pr-2 font-semibold">Fmt</th>
                      <th className="pb-1.5 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {detailFields.map((f, i) => {
                      const kind = f.source.kind;
                      return (
                        <tr key={f.id} className="group border-t border-outline-variant/50 align-middle hover:bg-surface-low">
                          <td className="py-0.5 pr-2"><Select className="dd-quiet dd-compact w-[116px]" aria-label="Source" value={kind} onChange={(v) => changeDetailKind(i, v)} options={DETAIL_KIND_OPTS} /></td>
                          <td className="py-0.5 pr-2">
                            {kind === 'record' ? (
                              <Select className="dd-quiet dd-compact w-[150px]" aria-label="Data field" value={f.source.key} onChange={(v) => setDetailFieldSource(i, { key: v })} options={RECORD_OPTS} />
                            ) : (
                              <input key={f.id + kind} className={`${quietInput} w-[150px] font-mono ${kind === 'attr' ? cfHighlight : ''}`} defaultValue={f.source.key} onBlur={(e) => setDetailFieldSource(i, { key: slug(e.target.value) })} />
                            )}
                          </td>
                          <td className="py-0.5 pr-2"><Select className="dd-quiet dd-compact w-[96px]" aria-label="Find cell by" value={f.by} onChange={(v) => setDetailField(i, { by: v })} options={CELL_BY} /></td>
                          <td className="py-0.5 pr-2"><input className={`${quietInput} w-[110px] font-mono`} value={f.value} onChange={(e) => setDetailField(i, { value: e.target.value })} placeholder="e.g. C7" /></td>
                          <td className="py-0.5 pr-2"><Select className="dd-quiet dd-compact w-[92px]" aria-label="Format" value={f.format || 'text'} onChange={(v) => setDetailField(i, { format: v === 'text' ? undefined : v })} options={FMT_OPTS} /></td>
                          <td className="py-0.5 pl-1">
                            <button onClick={() => removeDetailField(i)} className="grid h-6 w-6 place-items-center rounded text-on-surface-variant opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus:opacity-100 group-hover:opacity-100" title="Remove"><Icon name="close" className="text-[16px]" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-on-surface-variant">No detail fields yet. Add one to write a field’s value into a detail-sheet cell — or leave empty if your template already uses VLOOKUP.</p>
            )}
            <p className="mt-2 text-[11px] text-on-surface-variant">Custom (<span className="font-mono">cf_</span>) fields are <span className="rounded bg-status-review/10 px-1 ring-1 ring-status-review/40">highlighted</span>. Values are written directly (no formula) so they don’t depend on the log’s sheet name or column order.</p>
          </div>

          {/* constants — custom (cf_) fields now live in Settings › Labels */}
          {constFields.length > 0 && (
            <div className="rounded-2xl border border-outline-variant bg-surface p-4">
              <div className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">Constants <InfoTip label="About constants">One value used for every row — filled into the columns you set to “Constant”.</InfoTip></div>
              <div className="grid gap-3 sm:grid-cols-2">
                {constFields.map((f) => (
                  <label key={f.id} className="text-xs font-medium text-on-surface-variant">
                    {f.label} <span className="font-mono text-[10px] text-outline">({f.source.key})</span>
                    <input className={`${inputCls} mt-1 block w-full`} value={cfg.constants?.[f.source.key] ?? ''} onChange={(e) => setConst(f.source.key, e.target.value)} placeholder="—" />
                  </label>
                ))}
              </div>
            </div>
          )}
          {attrList.length > 0 && (
            <p className="px-1 text-[11px] text-on-surface-variant">Custom (cf_) field defaults are set in <span className="font-medium">Settings › Labels › Custom fields</span>.</p>
          )}
          <div className="flex">{nextBtn(3, 'Continue to Export')}</div>
        </>
      )}

      {/* ---------- STEP 4 · EXPORT ---------- */}
      {step === 3 && info && (
        <div className="rounded-2xl border border-outline-variant bg-surface p-4">
          <div className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">Export <InfoTip label="About export">Fills the log sheet and one detail sheet per comment, then downloads the .xlsx. Save the field mapping as JSON to reuse it next time.</InfoTip></div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface-container px-3 py-1 text-xs font-medium text-on-surface-variant">{records.length} comments → {records.length} log rows + {records.length} detail sheets · {activeFields.length} columns filled</span>
          </div>
          {records.length > 150 && <p className="mt-2 text-xs text-status-review">{records.length} comments will create {records.length} detail sheets — a large, slow file. For a quick test, reduce the data first.</p>}
          {!records.length && <p className="mt-2 text-xs text-status-review">No comments loaded yet — import a report first.</p>}
          {err && <p className="mt-2 text-xs text-error">{err}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={jsonRef} type="file" accept=".json" className="sr-only" onChange={importMapping} />
            <Button variant="text" icon="folder_open" onClick={() => jsonRef.current?.click()}>Import mapping</Button>
            <Button variant="text" icon="upload_file" onClick={exportMapping}>Export mapping</Button>
          </div>
        </div>
      )}

      {/* Sticky export action bar — solid so it reads as a pinned bar, not a
          translucent overlay, and stays reachable while configuring. */}
      {info && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-full border border-outline-variant bg-surface px-4 py-2 shadow-md-2">
          <span className="pl-1 text-xs text-on-surface-variant">{records.length} comments → {records.length} rows + {records.length} sheets</span>
          <span className="flex-1" />
          <Button icon="download" onClick={doExport} disabled={busy || !records.length}>{busy ? 'Working…' : 'Export using template'}</Button>
        </div>
      )}
    </div>
  );
}
