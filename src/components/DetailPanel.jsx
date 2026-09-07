import { useEffect, useRef } from 'react';
import { useStore } from '../store/store.jsx';
import { DISCIPLINES, STATUSES } from '../lib/parser.js';
import { Icon, Button, Select, StatusBadge, DisciplineBadge } from './ui.jsx';

// Editable review detail rendered as a right-side drawer / modal overlay.
export default function DetailPanel({ record, onClose }) {
  const { updateRecord, toast } = useStore();
  const closeRef = useRef(null);

  // Close on Escape; focus the close button on open.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch) => updateRecord(record.ID, patch);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Detail komentar">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-md-3 animate-[slideIn_.2s_ease-out]">
        <style>{`@keyframes slideIn{from{transform:translateX(16px);opacity:.6}to{transform:none;opacity:1}}`}</style>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant/60 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DisciplineBadge discipline={record.discipline} />
              <StatusBadge status={record.status} />
            </div>
            <h2 className="mt-2 truncate text-lg font-semibold">{record.viewpoint}</h2>
            <p className="text-xs text-on-surface-variant">
              {record.commentId ? `Comment ${record.commentId} · ` : ''}{record.commentDate}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Tutup detail"
            className="rounded-full p-2 text-on-surface-variant hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Icon name="close" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Image / camera */}
          <div className="overflow-hidden rounded-lg border border-outline-variant/60 bg-surface-container">
            {record.imageData ? (
              <img src={record.imageData} alt={`Viewpoint ${record.viewpoint}`} className="max-h-64 w-full object-contain" />
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-1 text-on-surface-variant">
                <Icon name="image_not_supported" className="text-[28px]" />
                <span className="text-xs">
                  {record.imageRef ? `Gambar ${record.imageRef} tidak tersedia` : 'Tanpa gambar'}
                </span>
              </div>
            )}
            {record.cameraPosition && (
              <div className="flex items-center gap-2 border-t border-outline-variant/60 px-3 py-2 text-xs text-on-surface-variant">
                <Icon name="videocam" className="text-[16px]" /> {record.cameraPosition}
              </div>
            )}
          </div>

          <Field label="Komentar">
            <p className="whitespace-pre-line text-sm leading-relaxed">{record.commentText}</p>
          </Field>

          {record.authorCode && (
            <Field label="Penulis">
              <span className="inline-flex items-center gap-1.5 text-sm">
                <Icon name="person" className="text-[18px] text-on-surface-variant" /> {record.authorCode}
              </span>
            </Field>
          )}

          {/* Editable controls */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-on-surface-variant">Disiplin</label>
              <Select
                aria-label="Ubah disiplin"
                className="w-full"
                value={record.discipline}
                onChange={(v) => set({ discipline: v })}
                options={DISCIPLINES}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-on-surface-variant">Status</label>
              <Select
                aria-label="Ubah status"
                className="w-full"
                value={record.status}
                onChange={(v) => set({ status: v })}
                options={STATUSES}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-on-surface-variant">Resolusi / tindak lanjut</label>
            <textarea
              value={record.resolution}
              onChange={(e) => set({ resolution: e.target.value })}
              rows={4}
              placeholder="Catat keputusan atau tindak lanjut…"
              className="w-full resize-y rounded-md border border-outline bg-surface-container px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        {/* Footer status stepper */}
        <div className="border-t border-outline-variant/60 px-5 py-3">
          <div className="flex items-center gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => { set({ status: s }); toast(`Status → ${s}`, 'info'); }}
                className={`flex-1 rounded-full px-3 py-2 text-xs font-medium transition-colors ${
                  record.status === s
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-variant'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-on-surface-variant">{label}</div>
      {children}
    </div>
  );
}
