import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store/store.jsx';
import { ingestFiles } from '../lib/ingest.js';
import { loadSampleData } from '../lib/sample.js';
import { Icon, Button, Card } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';

export default function ImportView({ go }) {
  const { setData, toast } = useStore();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      setBusy(true);
      setResult(null);
      try {
        const { records, stats, errors } = await ingestFiles(files);
        if (records.length === 0) {
          setResult({ stats, errors });
          toast(errors[0] || 'No comments could be imported.', 'error');
        } else {
          setData(records, 'user', stats);
          setResult({ stats, errors });
          toast(`Imported ${stats.comments} comments from ${stats.html} HTML · ${stats.linked} images linked.`, 'success');
        }
      } catch (e) {
        toast(`Import failed: ${e.message}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [setData, toast]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const restoreSample = async () => {
    setBusy(true);
    try {
      const { records, stats } = await loadSampleData();
      setData(records, 'sample', stats);
      toast('Sample data restored.', 'info');
      setResult(null);
    } catch (e) {
      toast(`Couldn’t load sample: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Reveal className="mx-auto max-w-3xl space-y-6" deps={[]}>
      <Card className="p-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? 'border-primary bg-primary/10' : 'border-outline-variant bg-surface-low'
          }`}
        >
          <Icon name={busy ? 'hourglass_top' : 'cloud_upload'} className={`text-[44px] text-primary ${busy ? 'animate-pulse' : ''}`} />
          <div className="text-sm">Drop files here, or</div>
          <Button icon="folder_open" onClick={() => inputRef.current?.click()} disabled={busy}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".html,.htm,.jpg,.jpeg,.png,.zip"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <p className="text-xs text-on-surface-variant">.html · .jpg · .png · .zip — processed in your browser</p>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button variant="text" icon="restart_alt" onClick={restoreSample} disabled={busy}>
            Restore sample
          </Button>
        </div>
      </Card>

      {result && (
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="HTML" value={result.stats.html} icon="description" />
            <Stat label="Comments" value={result.stats.comments} icon="forum" />
            <Stat label="Images" value={result.stats.images} icon="image" />
            <Stat label="Linked" value={result.stats.linked} icon="link" />
          </div>

          {result.errors.length > 0 && (
            <div className="mt-4 rounded-control border border-error/40 bg-error-container p-3 text-sm text-on-error-container">
              <ul className="list-inside list-disc space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {result.stats.comments > 0 && (
            <div className="mt-4 flex gap-2">
              <Button icon="format_list_bulleted" onClick={() => go('comments')}>Viewpoints</Button>
              <Button variant="tonal" icon="dashboard" onClick={() => go('dashboard')}>Overview</Button>
            </div>
          )}
        </Card>
      )}
    </Reveal>
  );
}

function Stat({ label, value, icon }) {
  return (
    <div className="rounded-control bg-surface-container p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-on-surface-variant">{label}</span>
        <Icon name={icon} className="text-[18px] text-on-surface-variant" />
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
