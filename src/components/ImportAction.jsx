// Import a Navisworks report — shared by Work and Insights. Into an empty
// review (or over the offline sample) it's a plain load; into a review with
// comments it first shows what the new report changes (ImportDialog) and then
// merges by comment ID. Either way it can be undone from the toast. The data
// source applies it (in memory offline, on the server otherwise).
import { useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { useData } from '../data/index.js';
import { ingestFiles } from '../lib/ingest.js';
import { planMerge } from '../lib/merge.js';
import { doneLabel as doneLabelOf } from '../lib/status.js';
import ImportDialog from './ImportDialog.jsx';

/** → { pick(): open the file picker, ui: the hidden input + merge dialog, busy } */
export function useImport() {
  const source = useData();
  const { records, meta, notify, setData } = useStore();
  const { settings } = useSettings();
  const inputRef = useRef(null);
  const [merge, setMerge] = useState(null); // { plan, stats, fileName, missingAction }
  const [busy, setBusy] = useState(false);
  // Progress of a running import: { step, done, total, phase } — phase 1 reads
  // the files here, phase 2 saves to the data source (photos one by one).
  const [progress, setProgress] = useState(null);

  const runImport = async (plan, stats, missingAction) => {
    const doneLabel = doneLabelOf(settings.statuses);
    setBusy(true);
    try {
      setProgress({ step: 'Saving', done: 0, total: 1, phase: 2 });
      const res = await source.importMerge(plan, { missingAction, doneLabel, onProgress: (p) => setProgress({ ...p, phase: 2 }) }, { records, source: meta.source });
      setData(res.records, res.source, stats);
      const undo = async () => {
        const back = await res.undo();
        setData(back.records, back.source, { comments: back.records.length, html: 0, images: 0, linked: 0 });
      };
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
      setProgress(null);
    }
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      const { records: recs, stats, errors } = await ingestFiles(files, (p) => setProgress({ ...p, phase: 1 }));
      setProgress(null);
      if (recs.length === 0) { notify(errors[0] || 'No comments could be imported.', 'error'); return; }
      const fileName = files.find((f) => /\.html?$/i.test(f.name))?.name || files[0].name;
      if (source.isFreshImport(records, meta)) await runImport(planMerge([], recs), stats, 'keep');
      else setMerge({ plan: planMerge(records, recs), stats, fileName, missingAction: 'keep' });
    } catch (e) {
      setProgress(null);
      notify(`Import failed: ${e.message}`, 'error');
    }
  };

  const ui = (
    <>
      <input ref={inputRef} type="file" multiple accept=".html,.htm,.jpg,.jpeg,.png,.zip" className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      <ImportDialog state={merge} onChange={setMerge} onCancel={() => setMerge(null)} busy={busy}
        onConfirm={() => runImport(merge.plan, merge.stats, merge.missingAction)} />
      <ImportProgress progress={progress} />
    </>
  );
  return { pick: () => inputRef.current?.click(), ui, busy, fresh: source.isFreshImport(records, meta) };
}

// A small card while an import runs: what it is doing, a bar, "12 of 40".
// Step 1 of 2 reads the files in this browser; step 2 saves them (on the
// server that includes uploading each before-photo).
function ImportProgress({ progress }) {
  if (!progress) return null;
  const { step, done, total, phase } = progress;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  const pct = Math.round(((phase === 1 ? 0 : 0.5) + frac / 2) * 100);
  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 rounded-card bg-surface p-4 shadow-md-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-semibold">Importing · {step}</span>
        <span className="shrink-0 tabular-nums text-on-surface-variant">{total > 1 ? `${done} of ${total}` : `${pct}%`}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-high" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <div className="mt-2 text-[12px] text-on-surface-variant">Step {phase} of 2 · {phase === 1 ? 'reading the report' : 'saving'} — keep this tab open.</div>
    </div>
  );
}
