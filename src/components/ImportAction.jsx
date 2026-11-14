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

  const runImport = async (plan, stats, missingAction) => {
    const doneLabel = doneLabelOf(settings.statuses);
    setBusy(true);
    try {
      const res = await source.importMerge(plan, { missingAction, doneLabel }, { records, source: meta.source });
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
    }
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      const { records: recs, stats, errors } = await ingestFiles(files);
      if (recs.length === 0) { notify(errors[0] || 'No comments could be imported.', 'error'); return; }
      const fileName = files.find((f) => /\.html?$/i.test(f.name))?.name || files[0].name;
      if (source.isFreshImport(records, meta)) await runImport(planMerge([], recs), stats, 'keep');
      else setMerge({ plan: planMerge(records, recs), stats, fileName, missingAction: 'keep' });
    } catch (e) {
      notify(`Import failed: ${e.message}`, 'error');
    }
  };

  const ui = (
    <>
      <input ref={inputRef} type="file" multiple accept=".html,.htm,.jpg,.jpeg,.png,.zip" className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      <ImportDialog state={merge} onChange={setMerge} onCancel={() => setMerge(null)} busy={busy}
        onConfirm={() => runImport(merge.plan, merge.stats, merge.missingAction)} />
    </>
  );
  return { pick: () => inputRef.current?.click(), ui, busy, fresh: source.isFreshImport(records, meta) };
}
