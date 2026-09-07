import { useEffect, useRef } from 'react';
import { useStore } from '../store/store.jsx';
import { DISCIPLINES, STATUSES } from '../lib/parser.js';
import { Icon, Select, StatusBadge, DisciplineBadge } from './ui.jsx';

// Editable review detail rendered as a right-side drawer overlay.
export default function DetailPanel({ record, onClose }) {
  const { updateRecord } = useStore();
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch) => updateRecord(record.ID, patch);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Comment detail">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col rounded-l-card bg-surface shadow-md-3 animate-[slideIn_.24s_cubic-bezier(0.05,0.7,0.1,1)]">
        <style>{`@keyframes slideIn{from{transform:translateX(24px);opacity:.5}to{transform:none;opacity:1}}`}</style>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant/60 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DisciplineBadge discipline={record.discipline} />
              <StatusBadge status={record.status} />
            </div>
            <h2 className="mt-2 truncate text-lg font-semibold">{record.viewpoint}</h2>
            <p className="text-xs text-on-surface-variant">
              {record.commentId ? `#${record.commentId} · ` : ''}{record.commentDate}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="rounded-control p-2 text-on-surface-variant hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Icon name="close" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="overflow-hidden rounded-card border border-outline-variant/60 bg-surface-container">
            {record.imageData ? (
              <img src={record.imageData} alt={`Viewpoint ${record.viewpoint}`} className="max-h-64 w-full object-contain" />
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-1 text-on-surface-variant">
                <Icon name="image_not_supported" className="text-[28px]" />
                <span className="text-xs">{record.imageRef ? `${record.imageRef} unavailable` : 'No image'}</span>
              </div>
            )}
            {record.cameraPosition && (
              <div className="flex items-center gap-2 border-t border-outline-variant/60 px-3 py-2 text-xs text-on-surface-variant">
                <Icon name="videocam" className="text-[16px]" /> {record.cameraPosition}
              </div>
            )}
          </div>

          <p className="whitespace-pre-line text-sm leading-relaxed">{record.commentText}</p>

          {record.authorCode && (
            <div className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant">
              <Icon name="person" className="text-[18px]" /> {record.authorCode}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-on-surface-variant">
              Discipline
              <Select className="mt-1 w-full" aria-label="Change discipline" value={record.discipline} onChange={(v) => set({ discipline: v })} options={DISCIPLINES} />
            </label>
            <label className="text-xs font-medium text-on-surface-variant">
              Status
              <Select className="mt-1 w-full" aria-label="Change status" value={record.status} onChange={(v) => set({ status: v })} options={STATUSES} />
            </label>
          </div>

          <label className="block text-xs font-medium text-on-surface-variant">
            Resolution
            <textarea
              value={record.resolution}
              onChange={(e) => set({ resolution: e.target.value })}
              rows={4}
              placeholder="Decision or follow-up…"
              className="mt-1 w-full resize-y rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
        </div>

        {/* Status stepper */}
        <div className="flex items-center gap-2 border-t border-outline-variant/60 px-5 py-3">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => set({ status: s })}
              className={`flex-1 rounded-control px-3 py-2 text-xs font-medium transition-colors ${
                record.status === s ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-variant'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
