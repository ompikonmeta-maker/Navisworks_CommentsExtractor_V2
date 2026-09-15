import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { Icon, Button, Select } from './ui.jsx';
import {
  inspectTemplate,
  resolveMapping,
  fillTemplate,
  migrateMapping,
  DEFAULT_TEMPLATE_MAPPING,
  RECORD_FIELDS,
} from '../lib/templateExcel.js';
import { saveTemplate, loadTemplate, clearTemplate } from '../lib/persist.js';

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
  { value: 'record', label: 'Record' },
  { value: 'const', label: 'Const' },
  { value: 'attr', label: 'Custom' },
];
const FMT_OPTS = [
  { value: 'text', label: 'text' },
  { value: 'date', label: 'date' },
  { value: 'number', label: 'number' },
];
const RECORD_OPTS = RECORD_FIELDS.map(([value, label]) => ({ value, label }));

const inputCls =
  'rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

const normHeader = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';

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
  const fileRef = useRef(null);
  const jsonRef = useRef(null);

  useEffect(() => {
    (async () => {
      const saved = await loadTemplate();
      if (saved) {
        setTpl(saved);
        try { setInfo(await inspectTemplate(saved.bytes)); } catch (e) { setErr(e.message); }
      }
    })();
  }, []);

  const preview = useMemo(() => (info ? resolveMapping(info, cfg) : null), [info, cfg]);
  const resolvedCount = preview ? preview.rows.filter((r) => r.col).length : 0;

  useEffect(() => {
    if (!tpl) return;
    (async () => {
      try { setInfo(await inspectTemplate(tpl.bytes, cfg.logSheet.headerRow)); } catch (e) { setErr(e.message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.logSheet.headerRow]);

  useEffect(() => {
    if (!info) return;
    if (!info.candidateLogSheets?.includes(cfg.logSheet?.name)) {
      setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, name: info.logSheet } }));
    }
    if (info.detailSheets?.length && !info.detailSheets.includes(cfg.detail?.patternSheet)) {
      setTemplateExport((c) => ({ ...c, detail: { ...c.detail, patternSheet: info.detailSheets[0] } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  // ---- mapping setters ----
  const setLogSheet = (name) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, name } }));
  const setPattern = (name) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, patternSheet: name } }));
  const setConst = (k, v) => setTemplateExport((c) => ({ ...c, constants: { ...c.constants, [k]: v } }));
  const setDetailFlag = (k, v) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, [k]: v } }));
  const setLog = (patch) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, ...patch } }));
  const setItemCol = (patch) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, itemColumn: { ...c.logSheet.itemColumn, ...patch } } }));
  const patchFields = (fn) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, fields: fn(c.logSheet.fields) } }));
  const setField = (i, patch) => patchFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setFieldSource = (i, patch) => patchFields((fs) => fs.map((f, j) => (j === i ? { ...f, source: { ...f.source, ...patch } } : f)));
  const moveField = (i, d) => patchFields((fs) => {
    const j = i + d;
    if (j < 0 || j >= fs.length) return fs;
    const next = [...fs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const removeField = (i) => patchFields((fs) => fs.filter((_, j) => j !== i));
  const addField = () => patchFields((fs) => [...fs, { id: `f${Date.now()}`, label: 'New field', source: { kind: 'attr', key: `field_${fs.length + 1}` }, by: 'header', value: '' }]);
  const changeKind = (i, kind) => patchFields((fs) => fs.map((f, j) => {
    if (j !== i) return f;
    const key = kind === 'record' ? (RECORD_FIELDS[0][0]) : (f.source.key || slug(f.label));
    return { ...f, source: { kind, key } };
  }));
  // Commit an attr/const key rename (on blur) — migrates record.extra for attr.
  const commitKey = (i, oldKey, newKeyRaw) => {
    const newKey = slug(newKeyRaw);
    if (!newKey || newKey === oldKey) return;
    setFieldSource(i, { key: newKey });
    if (fields[i]?.source.kind === 'attr') renameAttr(oldKey, newKey);
  };
  const resetMapping = () => setTemplateExport(() => JSON.parse(JSON.stringify(DEFAULT_TEMPLATE_MAPPING)));

  const constFields = fields.filter((f) => f.source.kind === 'const');
  const attrFieldsList = fields.map((f, i) => ({ f, i })).filter((x) => x.f.source.kind === 'attr');

  const unmapped = useMemo(() => {
    if (!info) return [];
    const used = new Set(fields.filter((f) => f.by === 'header').map((f) => normHeader(f.value)));
    return Object.entries(info.headers).filter(([, txt]) => !used.has(normHeader(txt))).map(([, txt]) => txt);
  }, [info, fields]);

  const addUnmapped = () => patchFields((fs) => [
    ...fs,
    ...unmapped.map((txt, k) => ({ id: `f${Date.now()}_${k}`, label: txt, source: { kind: 'attr', key: slug(txt) }, by: 'header', value: txt })),
  ]);

  // ---- template + export ----
  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr('');
    const bytes = new Uint8Array(await f.arrayBuffer());
    setTpl({ name: f.name, bytes });
    await saveTemplate(f.name, bytes);
    try { setInfo(await inspectTemplate(bytes, cfg.logSheet.headerRow)); } catch (er) { setErr(`Couldn’t read template: ${er.message}`); setInfo(null); }
  };
  const removeTpl = async () => { await clearTemplate(); setTpl(null); setInfo(null); };

  const doExport = async () => {
    if (!tpl) return;
    setBusy(true); setErr('');
    try {
      const { bytes, stats } = await fillTemplate(tpl.bytes, records, cfg, cfg.constants || {});
      download(bytes, `3D-review-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
      notify(`Template export: ${stats.logRows} rows · ${stats.detailSheets} detail sheets · ${stats.images} images.`, 'success');
    } catch (e) { setErr(e.message); notify(`Template export failed: ${e.message}`, 'error'); } finally { setBusy(false); }
  };
  const exportMapping = () => download(JSON.stringify(cfg, null, 2), 'tabelin-mapping.json', 'application/json');
  const importMapping = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const parsed = migrateMapping(JSON.parse(await f.text())); setTemplateExport(() => parsed); notify('Mapping imported.', 'success'); }
    catch (er) { notify(`Invalid mapping file: ${er.message}`, 'error'); }
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      {/* template loader */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" onChange={onPick} />
          <Button variant="tonal" icon="upload_file" onClick={() => fileRef.current?.click()}>
            {tpl ? 'Replace template…' : 'Choose template .xlsx…'}
          </Button>
          {tpl && <span className="text-sm font-medium">{tpl.name}</span>}
          {info && (
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${resolvedCount >= (preview.rows.length - 1) ? 'bg-status-closed/15 text-status-closed' : 'bg-status-review/15 text-status-review'}`}>
              {resolvedCount}/{preview.rows.length} fields resolved
            </span>
          )}
          <span className="flex-1" />
          {tpl && (
            <button onClick={removeTpl} className="rounded-full p-1.5 text-on-surface-variant hover:text-error" title="Remove template">
              <Icon name="close" className="text-[18px]" />
            </button>
          )}
        </div>
        {info && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-on-surface-variant">
              Sheet log (tabel)
              <Select className="mt-1 w-full" aria-label="Log sheet" value={cfg.logSheet?.name || info.logSheet}
                onChange={setLogSheet} options={(info.candidateLogSheets || []).map((n) => ({ value: n, label: n === info.logSheet ? `${n} (auto)` : n }))} />
            </label>
            <label className="text-xs font-medium text-on-surface-variant">
              Sheet pola detail
              <Select className="mt-1 w-full" aria-label="Detail pattern sheet" value={cfg.detail?.patternSheet || info.detailSheets[0] || ''}
                onChange={setPattern} options={(info.detailSheets || []).map((n) => ({ value: n, label: n }))} />
            </label>
            <p className="text-[11px] text-on-surface-variant sm:col-span-2">Pilih sheet mana yang jadi tabel log dan sheet mana yang jadi pola detail. Tersimpan di browser, dipakai ulang.</p>
          </div>
        )}
        {err && <p className="mt-2 text-xs text-error">{err}</p>}
      </div>

      {!tpl && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Icon name="download" className="text-[40px] text-outline" />
          <div className="font-medium">Export ke template Excel-mu</div>
          <p className="max-w-sm text-sm text-on-surface-variant">Pilih file .xlsx template (mis. 3D Review Log). Data comment mengisi log sheet; tiap Tag View jadi sheet detail dengan foto before/after. Layout, logo, dan style template dipertahankan persis.</p>
        </div>
      )}

      {info && (
        <>
          {/* structure */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Struktur log sheet</div>
              <button onClick={resetMapping} className="text-xs font-medium text-primary hover:underline">Reset ke default</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-medium text-on-surface-variant">
                Baris header
                <input type="number" min={1} className={`${inputCls} mt-1 block w-full`} value={cfg.logSheet.headerRow} onChange={(e) => setLog({ headerRow: parseInt(e.target.value, 10) || 1 })} />
              </label>
              <label className="text-xs font-medium text-on-surface-variant">
                Baris data mulai
                <input type="number" min={1} className={`${inputCls} mt-1 block w-full`} value={cfg.logSheet.dataStartRow} onChange={(e) => setLog({ dataStartRow: parseInt(e.target.value, 10) || 1 })} />
              </label>
              <div className="text-xs font-medium text-on-surface-variant">
                Kolom ITEM (link)
                <div className="mt-1 flex gap-1">
                  <Select className="w-[120px]" aria-label="Item column locator" value={cfg.logSheet.itemColumn.by} onChange={(v) => setItemCol({ by: v })} options={BY_OPTS} />
                  <input className={`${inputCls} min-w-0 flex-1`} value={cfg.logSheet.itemColumn.value} onChange={(e) => setItemCol({ value: e.target.value })} />
                </div>
              </div>
            </div>
          </div>

          {/* editable field mapping */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Field → lokasi kolom</div>
              <div className="flex flex-wrap gap-2">
                {unmapped.length > 0 && (
                  <button onClick={addUnmapped} className="rounded-full bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-high">
                    + {unmapped.length} header belum terpetakan
                  </button>
                )}
                <button onClick={addField} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary">
                  <Icon name="upload_file" className="text-[15px]" /> Tambah field
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-on-surface-variant">
                    <th className="pb-1.5 pr-2 font-semibold">Label</th>
                    <th className="pb-1.5 pr-2 font-semibold">Sumber</th>
                    <th className="pb-1.5 pr-2 font-semibold">Key</th>
                    <th className="pb-1.5 pr-2 font-semibold">Cara</th>
                    <th className="pb-1.5 pr-2 font-semibold">Nilai locator</th>
                    <th className="pb-1.5 pr-2 font-semibold">Fmt</th>
                    <th className="pb-1.5 pr-2 font-semibold">→</th>
                    <th className="pb-1.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => {
                    const row = preview.rows[i + 1];
                    const kind = f.source.kind;
                    return (
                      <tr key={f.id} className="border-t border-outline-variant/50 align-middle">
                        <td className="py-1 pr-2"><input className={`${inputCls} w-[130px] py-1`} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} /></td>
                        <td className="py-1 pr-2"><Select className="w-[104px]" aria-label="Source kind" value={kind} onChange={(v) => changeKind(i, v)} options={KIND_OPTS} /></td>
                        <td className="py-1 pr-2">
                          {kind === 'record' ? (
                            <Select className="w-[150px]" aria-label="Record field" value={f.source.key} onChange={(v) => setFieldSource(i, { key: v })} options={RECORD_OPTS} />
                          ) : (
                            <input key={f.id + kind} className={`${inputCls} w-[110px] py-1 font-mono`} defaultValue={f.source.key} onBlur={(e) => commitKey(i, f.source.key, e.target.value)} />
                          )}
                        </td>
                        <td className="py-1 pr-2"><Select className="w-[112px]" aria-label="Locator method" value={f.by} onChange={(v) => setField(i, { by: v })} options={BY_OPTS} /></td>
                        <td className="py-1 pr-2"><input className={`${inputCls} w-[150px] py-1 font-mono`} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} /></td>
                        <td className="py-1 pr-2"><Select className="w-[92px]" aria-label="Format" value={f.format || 'text'} onChange={(v) => setField(i, { format: v === 'text' ? undefined : v })} options={FMT_OPTS} /></td>
                        <td className="py-1 pr-2">{row?.col ? <span className="rounded bg-secondary-container px-1.5 py-0.5 font-bold text-on-secondary-container">{row.col}</span> : <span className="italic text-status-open">—</span>}</td>
                        <td className="py-1">
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => moveField(i, -1)} disabled={i === 0} className="grid h-6 w-6 place-items-center rounded text-on-surface-variant hover:bg-surface-container disabled:opacity-30" title="Naik"><Icon name="chevron_right" className="-rotate-90 text-[16px]" /></button>
                            <button onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} className="grid h-6 w-6 place-items-center rounded text-on-surface-variant hover:bg-surface-container disabled:opacity-30" title="Turun"><Icon name="chevron_right" className="rotate-90 text-[16px]" /></button>
                            <button onClick={() => removeField(i)} className="grid h-6 w-6 place-items-center rounded text-on-surface-variant hover:bg-error/10 hover:text-error" title="Hapus"><Icon name="close" className="text-[16px]" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-on-surface-variant"><b>Record</b> = data bawaan · <b>Const</b> = konstanta export · <b>Custom</b> = atribut per-comment (muncul di detail drawer). Key Const/Custom bisa di-rename (data ikut dipindah). Cari kolom <b>by header</b> (tahan geser), <b>by name</b> (Defined Name), atau <b>by column</b>.</p>
          </div>

          {/* custom attribute defaults (drives the drawer) */}
          {attrFieldsList.length > 0 && (
            <div className="rounded-2xl border border-outline-variant bg-surface p-4">
              <div className="mb-1 text-sm font-semibold">Atribut custom</div>
              <p className="mb-3 text-xs text-on-surface-variant">Field ber-sumber <b>Custom</b> otomatis jadi input yang bisa diisi per-comment di detail drawer. Atur nilai default &amp; multiline.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-on-surface-variant"><th className="pb-1.5 pr-3 font-semibold">Key</th><th className="pb-1.5 pr-3 font-semibold">Default</th><th className="pb-1.5 font-semibold">Multiline</th></tr></thead>
                  <tbody>
                    {attrFieldsList.map(({ f, i }) => (
                      <tr key={f.id} className="border-t border-outline-variant/50">
                        <td className="py-1.5 pr-3 font-mono text-on-surface-variant">{f.source.key}</td>
                        <td className="py-1.5 pr-3"><input className={`${inputCls} w-full py-1`} value={f.default || ''} onChange={(e) => setField(i, { default: e.target.value })} placeholder="(kosong)" /></td>
                        <td className="py-1.5"><input type="checkbox" checked={!!f.multiline} onChange={(e) => setField(i, { multiline: e.target.checked })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* detail cell locators */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-3 text-sm font-semibold">Sheet detail — sel yang diisi tool</div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[['itemNumber', 'Nomor item (N2)'], ['imageBefore', 'Gambar Before'], ['imageAfter', 'Gambar After']].map(([key, label]) => (
                <div key={key} className="text-xs font-medium text-on-surface-variant">
                  {label}
                  <div className="mt-1 flex gap-1">
                    <Select className="w-[104px]" aria-label={`${label} locator`} value={cfg.detail[key].by} onChange={(v) => setDetailLoc(key, { by: v })} options={CELL_BY} />
                    <input className={`${inputCls} min-w-0 flex-1 font-mono`} value={cfg.detail[key].value} onChange={(e) => setDetailLoc(key, { value: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
            <label className="mt-3 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!cfg.detail?.vlookupAutoRepair} onChange={(e) => setDetailFlag('vlookupAutoRepair', e.target.checked)} />
              Auto-repair VLOOKUP (jadikan formula detail mengikuti header — tahan pindah kolom)
            </label>
          </div>

          {/* constants (auto from const-kind fields) */}
          {constFields.length > 0 && (
            <div className="rounded-2xl border border-outline-variant bg-surface p-4">
              <div className="mb-3 text-sm font-semibold">Konstanta (isi kolom bertipe Const)</div>
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

          {/* export + mapping io */}
          <div className="flex flex-wrap items-center gap-3">
            <Button icon="download" onClick={doExport} disabled={busy || !records.length}>{busy ? 'Menyusun…' : 'Export pakai template'}</Button>
            <input ref={jsonRef} type="file" accept=".json" className="sr-only" onChange={importMapping} />
            <Button variant="text" icon="folder_open" onClick={() => jsonRef.current?.click()}>Import mapping</Button>
            <Button variant="text" icon="upload_file" onClick={exportMapping}>Export mapping</Button>
            <span className="w-full text-xs text-on-surface-variant">{records.length} comment → {records.length} baris log + {records.length} sheet detail.</span>
            {records.length > 150 && (
              <span className="w-full text-xs text-status-review">⚠ {records.length} comment akan membuat {records.length} sheet detail — file besar &amp; proses agak lama. Untuk uji cepat, filter/kurangi data dulu.</span>
            )}
          </div>
        </>
      )}
    </div>
  );

  function setDetailLoc(key, patch) {
    setTemplateExport((c) => ({ ...c, detail: { ...c.detail, [key]: { ...c.detail[key], ...patch } } }));
  }
}
