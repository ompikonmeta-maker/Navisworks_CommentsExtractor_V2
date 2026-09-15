import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { Icon, Button } from './ui.jsx';
import { inspectTemplate, resolveMapping, fillTemplate, DEFAULT_TEMPLATE_MAPPING } from '../lib/templateExcel.js';

const BY_OPTIONS = [
  ['header', 'By header'],
  ['name', 'By name'],
  ['column', 'By column'],
];
const CELL_BY = [
  ['cell', 'By cell'],
  ['name', 'By name'],
];
import { saveTemplate, loadTemplate, clearTemplate } from '../lib/persist.js';

const inputCls =
  'rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function download(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
  const { records, notify } = useStore();
  const { settings, setTemplateExport } = useSettings();
  const cfg = settings.templateExport;
  const [tpl, setTpl] = useState(null); // { name, bytes }
  const [info, setInfo] = useState(null); // inspect result
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  // restore a previously-saved template on mount
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

  // Re-inspect when the header row changes so the preview reads the right row.
  useEffect(() => {
    if (!tpl) return;
    (async () => {
      try { setInfo(await inspectTemplate(tpl.bytes, cfg.logSheet.headerRow)); } catch (e) { setErr(e.message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.logSheet.headerRow]);

  // Once a template is inspected, pin the mapping's log sheet to the detected
  // one (unless the user already chose a valid sheet), so the picker + fill
  // agree and the preview isn't stuck on a stale default name.
  useEffect(() => {
    if (!info) return;
    const chosen = cfg.logSheet?.name;
    if (!info.candidateLogSheets?.includes(chosen)) {
      setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, name: info.logSheet } }));
    }
    if (info.detailSheets?.length && !info.detailSheets.includes(cfg.detail?.patternSheet)) {
      setTemplateExport((c) => ({ ...c, detail: { ...c.detail, patternSheet: info.detailSheets[0] } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  const setLogSheet = (name) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, name } }));
  const setPattern = (name) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, patternSheet: name } }));

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr('');
    const bytes = new Uint8Array(await f.arrayBuffer());
    setTpl({ name: f.name, bytes });
    await saveTemplate(f.name, bytes);
    try {
      setInfo(await inspectTemplate(bytes));
    } catch (er) {
      setErr(`Couldn’t read template: ${er.message}`);
      setInfo(null);
    }
  };

  const removeTpl = async () => {
    await clearTemplate();
    setTpl(null);
    setInfo(null);
  };

  const setConst = (k, v) => setTemplateExport((c) => ({ ...c, constants: { ...c.constants, [k]: v } }));
  const setDetailFlag = (k, v) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, [k]: v } }));
  const setLog = (patch) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, ...patch } }));
  const setItemCol = (patch) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, itemColumn: { ...c.logSheet.itemColumn, ...patch } } }));
  const setField = (i, patch) =>
    setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, fields: c.logSheet.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) } }));
  const setDetailLoc = (key, patch) => setTemplateExport((c) => ({ ...c, detail: { ...c.detail, [key]: { ...c.detail[key], ...patch } } }));
  const resetMapping = () => setTemplateExport(() => JSON.parse(JSON.stringify(DEFAULT_TEMPLATE_MAPPING)));

  const doExport = async () => {
    if (!tpl) return;
    setBusy(true);
    setErr('');
    try {
      const { bytes, stats } = await fillTemplate(tpl.bytes, records, cfg, cfg.constants || {}, cfg.extraDefaults || {});
      const stamp = new Date().toISOString().slice(0, 10);
      download(bytes, `3D-review-log-${stamp}.xlsx`);
      notify(`Template export: ${stats.logRows} rows · ${stats.detailSheets} detail sheets · ${stats.images} images.`, 'success');
    } catch (e) {
      setErr(e.message);
      notify(`Template export failed: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
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
              <select className={`${inputCls} mt-1 block w-full`} value={cfg.logSheet?.name || info.logSheet} onChange={(e) => setLogSheet(e.target.value)}>
                {(info.candidateLogSheets || []).map((n) => (
                  <option key={n} value={n}>{n}{n === info.logSheet ? ' (auto)' : ''}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-on-surface-variant">
              Sheet pola detail
              <select className={`${inputCls} mt-1 block w-full`} value={cfg.detail?.patternSheet || info.detailSheets[0] || ''} onChange={(e) => setPattern(e.target.value)}>
                {(info.detailSheets || []).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
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
          {/* structure — everything auto-detected is editable here */}
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
                  <select className={`${inputCls} w-[92px]`} value={cfg.logSheet.itemColumn.by} onChange={(e) => setItemCol({ by: e.target.value })}>
                    {BY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input className={`${inputCls} min-w-0 flex-1`} value={cfg.logSheet.itemColumn.value} onChange={(e) => setItemCol({ value: e.target.value })} />
                </div>
              </div>
            </div>
          </div>

          {/* editable field mapping */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-2 text-sm font-semibold">Field → lokasi kolom</div>
            <p className="mb-3 text-xs text-on-surface-variant">Tiap field dicari <b>by header</b> (teks header, tahan geser kolom), <b>by name</b> (Defined Name), atau <b>by column</b> (huruf kolom tetap). Ubah bila layout template berbeda.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-on-surface-variant">
                    <th className="pb-1.5 pr-2 font-semibold">Field</th>
                    <th className="pb-1.5 pr-2 font-semibold">Cara</th>
                    <th className="pb-1.5 pr-2 font-semibold">Nilai (header / name / kolom)</th>
                    <th className="pb-1.5 font-semibold">→</th>
                  </tr>
                </thead>
                <tbody>
                  {cfg.logSheet.fields.map((f, i) => {
                    const row = preview.rows[i + 1];
                    return (
                      <tr key={f.field} className="border-t border-outline-variant/50">
                        <td className="py-1 pr-2 font-semibold">{f.field}</td>
                        <td className="py-1 pr-2">
                          <select className={`${inputCls} py-1`} value={f.by} onChange={(e) => setField(i, { by: e.target.value })}>
                            {BY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </td>
                        <td className="py-1 pr-2">
                          <input className={`${inputCls} w-full py-1 font-mono`} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} />
                        </td>
                        <td className="py-1">
                          {row?.col ? (
                            <span className="rounded bg-secondary-container px-1.5 py-0.5 font-bold text-on-secondary-container">{row.col}</span>
                          ) : (
                            <span className="italic text-status-open">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* detail-sheet cell locators */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-3 text-sm font-semibold">Sheet detail — sel yang diisi tool</div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['itemNumber', 'Nomor item (N2)'],
                ['imageBefore', 'Gambar Before'],
                ['imageAfter', 'Gambar After'],
              ].map(([key, label]) => (
                <div key={key} className="text-xs font-medium text-on-surface-variant">
                  {label}
                  <div className="mt-1 flex gap-1">
                    <select className={`${inputCls} w-[86px]`} value={cfg.detail[key].by} onChange={(e) => setDetailLoc(key, { by: e.target.value })}>
                      {CELL_BY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
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

          {/* constants */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-3 text-sm font-semibold">Konstanta (diisi ke kolom @unit / @phase)</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-on-surface-variant">
                Unit
                <input className={`${inputCls} mt-1 block w-full`} value={cfg.constants?.unit || ''} onChange={(e) => setConst('unit', e.target.value)} placeholder="2800-OFA" />
              </label>
              <label className="text-xs font-medium text-on-surface-variant">
                Phase
                <input className={`${inputCls} mt-1 block w-full`} value={cfg.constants?.phase ?? ''} onChange={(e) => setConst('phase', e.target.value)} placeholder="0.9 atau 90%" />
              </label>
            </div>
          </div>

          {/* export */}
          <div className="flex flex-wrap items-center gap-3">
            <Button icon="download" onClick={doExport} disabled={busy || !records.length}>
              {busy ? 'Menyusun…' : 'Export pakai template'}
            </Button>
            <span className="text-xs text-on-surface-variant">
              {records.length} comment → {records.length} baris log + {records.length} sheet detail.
            </span>
            {records.length > 150 && (
              <span className="w-full text-xs text-status-review">
                ⚠ {records.length} comment akan membuat {records.length} sheet detail — file besar &amp; proses agak lama. Untuk uji cepat, filter/kurangi data dulu.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
