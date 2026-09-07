import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store/store.jsx';
import { ingestFiles } from '../lib/ingest.js';
import { loadSampleData } from '../lib/sample.js';
import { Icon, Button, Card } from '../components/ui.jsx';

export default function ImportView({ go }) {
  const { setData, toast } = useStore();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { stats, errors }
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
          toast(errors[0] || 'Tidak ada komentar yang dapat diimpor.', 'error');
        } else {
          setData(records, 'user', stats);
          setResult({ stats, errors });
          toast(
            `${stats.comments} komentar berhasil diimpor dari ${stats.html} HTML;\n${stats.linked} gambar diproses.`,
            'success'
          );
        }
      } catch (e) {
        toast(`Impor gagal: ${e.message}`, 'error');
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
      toast('Data sample dipulihkan.', 'info');
      setResult(null);
    } catch (e) {
      toast(`Gagal memuat sample: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="p-6">
        <h2 className="text-lg font-semibold">Impor laporan Navisworks</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          Pilih satu atau beberapa berkas <code className="rounded bg-surface-container px-1">.html</code>,
          gambar viewpoint <code className="rounded bg-surface-container px-1">.jpg/.png</code>, atau satu paket{' '}
          <code className="rounded bg-surface-container px-1">.zip</code>. Semua diproses di browser—tidak ada unggahan ke server.
        </p>

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-5 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? 'border-primary bg-primary/10' : 'border-outline-variant bg-surface-low'
          }`}
        >
          <Icon name={busy ? 'hourglass_top' : 'cloud_upload'} className={`text-[44px] text-primary ${busy ? 'animate-pulse' : ''}`} />
          <div className="text-sm">
            <span className="font-medium">Tarik & lepas berkas</span> di sini, atau
          </div>
          <Button icon="folder_open" onClick={() => inputRef.current?.click()} disabled={busy}>
            Pilih berkas
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".html,.htm,.jpg,.jpeg,.png,.zip"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <p className="text-xs text-on-surface-variant">Format didukung: .html · .htm · .jpg · .jpeg · .png · .zip</p>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-on-surface-variant">
            Memuat ulang halaman mengembalikan data ke sample awal.
          </p>
          <Button variant="text" icon="restart_alt" onClick={restoreSample} disabled={busy}>
            Pulihkan sample
          </Button>
        </div>
      </Card>

      {/* Result feedback */}
      {result && (
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Icon name="fact_check" className="text-primary" /> Hasil impor
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="HTML" value={result.stats.html} icon="description" />
            <Stat label="Komentar" value={result.stats.comments} icon="forum" />
            <Stat label="Gambar" value={result.stats.images} icon="image" />
            <Stat label="Tertaut" value={result.stats.linked} icon="link" />
          </div>

          {result.errors.length > 0 && (
            <div className="mt-4 rounded-md border border-error/40 bg-error-container p-3 text-sm text-on-error-container">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <Icon name="warning" className="text-[18px]" /> Catatan
              </div>
              <ul className="list-inside list-disc space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {result.stats.comments > 0 && (
            <div className="mt-4 flex gap-2">
              <Button icon="format_list_bulleted" onClick={() => go('comments')}>Lihat komentar</Button>
              <Button variant="tonal" icon="dashboard" onClick={() => go('dashboard')}>Ke dashboard</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, icon }) {
  return (
    <div className="rounded-md bg-surface-container p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-on-surface-variant">{label}</span>
        <Icon name={icon} className="text-[18px] text-on-surface-variant" />
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
