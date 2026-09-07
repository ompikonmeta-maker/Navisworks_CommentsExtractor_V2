import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { DISCIPLINES, STATUSES } from '../lib/parser.js';
import { Icon, Select, StatusBadge, DisciplineBadge } from './ui.jsx';

// Non-modal detail drawer. It is always mounted and slides in/out via a
// `transform` transition (no flicker, no mount/unmount). The main table is
// never dimmed and stays interactive: clicking another row swaps the
// drawer's content in place; clicking anywhere else closes it.
export default function DetailPanel({ record, onClose }) {
  const { updateRecord } = useStore();
  const open = !!record;
  const [shown, setShown] = useState(record); // persists during the exit slide
  const closeRef = useRef(null);

  useEffect(() => {
    if (record) setShown(record);
  }, [record]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open, shown?.ID]);

  // Esc + click-outside close. A click on a table row is a switch, not a close.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e) => {
      if (e.target.closest('[data-drawer]')) return; // inside the drawer
      if (e.target.closest('tbody tr')) return; // row → handled as a switch
      onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose]);

  const rec = shown;
  const set = (patch) => rec && updateRecord(rec.ID, patch);

  // Enter uses emphasized-decelerate; exit uses emphasized-accelerate.
  const style = {
    transform: open ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
    transition: `transform ${open ? 300 : 250}ms ${open ? 'cubic-bezier(0.05,0.7,0.1,1)' : 'cubic-bezier(0.3,0,0.8,0.15)'}`,
  };

  return (
    <div
      data-drawer
      role="dialog"
      aria-modal="false"
      aria-label="Viewpoint detail"
      aria-hidden={!open}
      style={style}
      className={`fixed bottom-3 right-3 top-3 z-40 flex w-[min(420px,92vw)] flex-col overflow-hidden rounded-card border border-outline-variant/60 bg-surface shadow-md-3 ${
        open ? '' : 'pointer-events-none'
      }`}
    >
      {rec && (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-outline-variant/60 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DisciplineBadge discipline={rec.discipline} />
                <StatusBadge status={rec.status} />
              </div>
              <h2 className="mt-2 truncate text-lg font-semibold">{rec.viewpoint}</h2>
              <p className="text-xs text-on-surface-variant">
                {rec.commentId ? `#${rec.commentId} · ` : ''}{rec.commentDate}
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

          {/* Body — re-keyed by record so switching rows cross-fades in place */}
          <div key={rec.ID} className="drawer-swap flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="overflow-hidden rounded-card border border-outline-variant/60 bg-surface-container">
              {rec.imageData ? (
                <img src={rec.imageData} alt={`Viewpoint ${rec.viewpoint}`} className="max-h-64 w-full object-contain" />
              ) : (
                <div className="flex h-32 flex-col items-center justify-center gap-1 text-on-surface-variant">
                  <Icon name="image_not_supported" className="text-[28px]" />
                  <span className="text-xs">{rec.imageRef ? `${rec.imageRef} unavailable` : 'No image'}</span>
                </div>
              )}
              {rec.cameraPosition && (
                <div className="flex items-center gap-2 border-t border-outline-variant/60 px-3 py-2 text-xs text-on-surface-variant">
                  <Icon name="videocam" className="text-[16px]" /> {rec.cameraPosition}
                </div>
              )}
            </div>

            <p className="whitespace-pre-line text-sm leading-relaxed">{rec.commentText}</p>

            {rec.authorCode && (
              <div className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant">
                <Icon name="person" className="text-[18px]" /> {rec.authorCode}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-on-surface-variant">
                Discipline
                <Select className="mt-1 w-full" aria-label="Change discipline" value={rec.discipline} onChange={(v) => set({ discipline: v })} options={DISCIPLINES} />
              </label>
              <label className="text-xs font-medium text-on-surface-variant">
                Status
                <Select className="mt-1 w-full" aria-label="Change status" value={rec.status} onChange={(v) => set({ status: v })} options={STATUSES} />
              </label>
            </div>

            <label className="block text-xs font-medium text-on-surface-variant">
              Resolution
              <textarea
                value={rec.resolution}
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
                  rec.status === s ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-variant'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
