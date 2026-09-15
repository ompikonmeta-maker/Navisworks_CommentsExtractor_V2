import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { Icon, Button } from './ui.jsx';
import { inspectTemplate, resolveMapping, fillTemplate } from '../lib/templateExcel.js';
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
          <p className="mt-2 text-xs text-on-surface-variant">
            Log sheet: <b>{info.logSheet}</b> · detail pattern sheets: <b>{info.detailSheets.join(', ') || '—'}</b> · saved in this browser, reused next time.
          </p>
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
          {/* resolve preview */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-2 text-sm font-semibold">Field → kolom (mapping by header)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-on-surface-variant">
                    <th className="pb-1.5 pr-3 font-semibold">Field</th>
                    <th className="pb-1.5 pr-3 font-semibold">Header di template</th>
                    <th className="pb-1.5 font-semibold">Kolom</th>
                  </tr>
                </thead>
                <tbody>
                  {cfg.logSheet.fields.map((f, i) => {
                    const row = preview.rows[i + 1];
                    return (
                      <tr key={f.field} className="border-t border-outline-variant/50">
                        <td className="py-1.5 pr-3 font-semibold">{f.field}</td>
                        <td className="py-1.5 pr-3 font-mono text-on-surface-variant">{f.value}</td>
                        <td className="py-1.5">
                          {row?.col ? (
                            <span className="rounded bg-secondary-container px-1.5 py-0.5 font-bold text-on-secondary-container">{row.col}</span>
                          ) : (
                            <span className="italic text-status-open">tak ketemu</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* constants + options */}
          <div className="rounded-2xl border border-outline-variant bg-surface p-4">
            <div className="mb-3 text-sm font-semibold">Konstanta &amp; opsi</div>
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
            <label className="mt-3 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!cfg.detail?.vlookupAutoRepair} onChange={(e) => setDetailFlag('vlookupAutoRepair', e.target.checked)} />
              Auto-repair VLOOKUP (jadikan formula detail mengikuti header — tahan pindah kolom)
            </label>
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
