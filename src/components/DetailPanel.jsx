import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { DISCIPLINES } from '../lib/parser.js';
import { attrFields, attrType } from '../lib/templateExcel.js';
import { chipStyle, doneLabel as doneLabelOf } from '../lib/status.js';
import { Icon, Select, StatusBadge, DisciplineBadge } from './ui.jsx';
import ImageCropper from './ImageCropper.jsx';
import Lightbox from './Lightbox.jsx';

// ISO ⇄ <input type="datetime-local"> (which works in the viewer's local time).
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

// A square thumbnail button that enlarges to the lightbox when tapped.
function Thumb({ src, alt, onEnlarge }) {
  return (
    <button
      type="button"
      className="ba-thumb"
      onClick={(e) => onEnlarge(src, alt, e.currentTarget.querySelector('img'))}
      aria-label={`Enlarge ${alt}`}
    >
      <img src={src} alt={alt} />
      <span className="ba-zoom">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            d="M9 4H5a1 1 0 0 0-1 1v4m11-5h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4m11 5h4a1 1 0 0 0 1-1v-4" />
        </svg>
      </span>
    </button>
  );
}

// Small text action (replace / remove) shown under a thumbnail.
function MiniAction({ danger, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs font-medium hover:underline ${danger ? 'text-error' : 'text-primary'}`}
    >
      {children}
    </button>
  );
}

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      d="M4 7h16M9 7V5h6v2m-7 0 1 13h6l1-13" />
  </svg>
);

// Non-modal detail drawer. It is always mounted and slides in/out via a
// `transform` transition (no flicker, no mount/unmount). The main table is
// never dimmed and stays interactive: clicking another row swaps the
// drawer's content in place; clicking anywhere else closes it.
export default function DetailPanel({ record, onClose }) {
  const { updateRecord, records } = useStore();
  const { settings } = useSettings();
  const doneLabel = doneLabelOf(settings.statuses);
  // Commenter dropdown options: everyone found in the data plus any names
  // added in Settings, sorted; "" is the unassigned choice.
  const commenterOptions = useMemo(() => {
    const set = new Set();
    for (const r of records) if (r.commenter) set.add(r.commenter);
    for (const c of settings.customCommenters || []) set.add(c);
    return [{ value: '', label: '— Unassigned —' }, ...[...set].sort().map((c) => ({ value: c, label: c }))];
  }, [records, settings.customCommenters]);
  // Custom export attributes (from the Export mapping) → editable inputs here.
  const exportAttrs = useMemo(() => attrFields(settings.templateExport), [settings.templateExport]);
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
      if (e.target.closest('[data-toast]')) return; // toast action (e.g. Undo)
      onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose]);

  // While open, render the live store record so edits (image add/remove,
  // undo) reflect immediately; `shown` is only the frozen copy kept for the
  // exit slide, when `record` has already gone null.
  const rec = record || shown;
  const set = (patch) => rec && updateRecord(rec.ID, patch);
  const beforeInputRef = useRef(null);
  const afterInputRef = useRef(null);
  const [crop, setCrop] = useState(null); // { src, target: 'before'|'after' }
  const [lightbox, setLightbox] = useState(null); // { src, alt, from }
  const [dropOver, setDropOver] = useState(null); // slot being dragged over
  const [undo, setUndo] = useState(null); // { target, field, prev, id } — inline Undo card
  const undoTimer = useRef(null);
  const UNDO_MS = 5000;

  const clearUndo = () => { clearTimeout(undoTimer.current); setUndo(null); };
  // Drop the pending Undo when the drawer switches records or closes.
  useEffect(() => {
    clearUndo();
    return () => clearTimeout(undoTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.ID, open]);

  const enlarge = (src, alt, imgEl) => {
    const r = imgEl.getBoundingClientRect();
    setLightbox({ src, alt, from: { x: r.left, y: r.top, w: r.width, h: r.height } });
  };

  // Any image source (file picker, drop, or paste) opens the crop dialog for
  // the given slot; the crop result is written on "Use photo".
  const pickImage = async (fileList, target) => {
    const file = Array.from(fileList || []).find((f) => f.type.startsWith('image/'));
    if (!file || !rec) return;
    try {
      setCrop({ src: await readAsDataURL(file), target });
    } catch {
      /* ignore read errors */
    }
  };

  const cropDone = (dataUrl) => {
    if (rec) {
      // A cropped after photo implies the issue is resolved → Closed.
      const patch = crop.target === 'after'
        ? { afterImageData: dataUrl, status: doneLabel }
        : { imageData: dataUrl };
      updateRecord(rec.ID, patch);
    }
    setCrop(null);
  };

  // Removing a photo empties its slot and turns it into an inline Undo card
  // (right where the eye is) with a countdown ring; it clears itself after a
  // few seconds. Undo restores the exact image.
  const removeImage = (target) => {
    if (!rec) return;
    const field = target === 'after' ? 'afterImageData' : 'imageData';
    const prev = rec[field];
    const id = rec.ID;
    updateRecord(id, { [field]: null });
    clearTimeout(undoTimer.current);
    setUndo({ target, field, prev, id });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const doUndo = () => {
    if (undo) updateRecord(undo.id, { [undo.field]: undo.prev });
    clearUndo();
  };

  // Paste an image anywhere in the drawer → treat it as an after photo.
  useEffect(() => {
    if (!open) return undefined;
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) pickImage([item.getAsFile()], 'after');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rec?.ID]);

  const dropProps = (target) => ({
    onDragOver: (e) => { e.preventDefault(); setDropOver(target); },
    onDragLeave: () => setDropOver((t) => (t === target ? null : t)),
    onDrop: (e) => { e.preventDefault(); setDropOver(null); pickImage(e.dataTransfer.files, target); },
  });

  // Enter uses emphasized-decelerate; exit uses emphasized-accelerate.
  const style = {
    transform: open ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
    transition: `transform ${open ? 300 : 250}ms ${open ? 'cubic-bezier(0.05,0.7,0.1,1)' : 'cubic-bezier(0.3,0,0.8,0.15)'}`,
  };

  return (
   <>
    <div
      data-drawer
      role="dialog"
      aria-modal="false"
      aria-label="Viewpoint detail"
      aria-hidden={!open}
      style={style}
      className={`fixed bottom-3 right-3 top-3 z-40 flex w-[min(483px,92vw)] flex-col overflow-hidden rounded-card border border-outline-variant/60 bg-surface shadow-md-3 ${
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
            {/* Before / after — side-by-side squares, tap to enlarge; the
                after upload passes through the crop dialog and marks Closed. */}
            <div className="space-y-2">
              <div className="ba-grid">
                {[
                  { target: 'before', caption: 'Before', src: rec.imageData, alt: `Before — ${rec.viewpoint}`, inputRef: beforeInputRef },
                  { target: 'after', caption: 'After', src: rec.afterImageData, alt: 'After', inputRef: afterInputRef },
                ].map((slot) => (
                  <div key={slot.target} className="ba-cell" {...dropProps(slot.target)}>
                    <span className="ba-cap">{slot.caption}</span>
                    {undo?.target === slot.target ? (
                      <div className="ba-thumb ba-undo">
                        <span className="ba-undo-msg">Photo removed</span>
                        <button type="button" className="ba-undo-btn" onClick={doUndo}>
                          <span className="ba-undo-ring" style={{ animationDuration: `${UNDO_MS}ms` }} />
                          Undo
                        </button>
                      </div>
                    ) : slot.src ? (
                      <Thumb src={slot.src} alt={slot.alt} onEnlarge={enlarge} />
                    ) : (
                      <button
                        className={`ba-thumb flex flex-col items-center justify-center gap-1 text-on-surface-variant ${dropOver === slot.target ? 'drop-over' : ''}`}
                        onClick={() => slot.inputRef.current?.click()}
                      >
                        <Icon name="cloud_upload" className="text-[26px] text-primary" />
                        <span className="text-xs font-medium">Upload</span>
                        <span className="text-[10px]">or drop / paste</span>
                      </button>
                    )}
                    {slot.src && undo?.target !== slot.target && (
                      <div className="flex items-center gap-4">
                        <MiniAction onClick={() => slot.inputRef.current?.click()}>
                          <Icon name="restart_alt" className="text-[15px]" /> Replace
                        </MiniAction>
                        <MiniAction danger onClick={() => removeImage(slot.target)}>
                          <TrashIcon /> Remove
                        </MiniAction>
                      </div>
                    )}
                    <input
                      ref={slot.inputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => { pickImage(e.target.files, slot.target); e.target.value = ''; }}
                    />
                  </div>
                ))}
              </div>

              {!rec.afterImageData && (
                <p className="text-xs text-on-surface-variant">An after photo is cropped to a uniform size and marks this comment Closed.</p>
              )}
              {rec.cameraPosition && (
                <div className="flex items-center gap-2 text-xs text-on-surface-variant">
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
              <label className="block min-w-0 text-xs font-medium text-on-surface-variant">
                Discipline
                <Select className="mt-1 w-full" aria-label="Change discipline" value={rec.discipline} onChange={(v) => set({ discipline: v })} options={DISCIPLINES} />
              </label>
              <label className="block min-w-0 text-xs font-medium text-on-surface-variant">
                Commenter
                <Select className="mt-1 w-full" aria-label="Change commenter" value={rec.commenter || ''} onChange={(v) => set({ commenter: v })} options={commenterOptions} />
              </label>
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-on-surface-variant">Status</div>
              <div className="flex flex-wrap gap-2">
                {settings.statuses.map((s) => {
                  const on = rec.status === s.label;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ status: s.label })}
                      style={on ? chipStyle(s.color) : undefined}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        on ? '' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {rec.status === doneLabel && (
              <label className="block text-xs font-medium text-on-surface-variant">
                Closed at
                <input
                  type="datetime-local"
                  value={toLocalInput(rec.closedAt)}
                  onChange={(e) => set({ closedAt: fromLocalInput(e.target.value) })}
                  className="mt-1 w-full rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="mt-1 block text-[11px] font-normal text-on-surface-variant">Set automatically when closed — edit if the fix happened earlier.</span>
              </label>
            )}

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

            {/* Custom attributes for the template export — driven by the Export
                mapping's Custom (attr) fields. Blank falls back to the field's
                default at export time. */}
            {exportAttrs.length > 0 && (
              <details className="rounded-control border border-outline-variant bg-surface-container/40">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-on-surface-variant">Custom fields (template export)</summary>
                <div className="space-y-3 px-3 pb-3">
                  {exportAttrs.map((a) => {
                    const key = a.source.key;
                    const type = attrType(a);
                    const val = rec.extra?.[key];
                    const setExtra = (v) => set({ extra: { ...(rec.extra || {}), [key]: v } });
                    const inputCls = 'mt-1 w-full rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
                    if (type === 'checkbox') {
                      const arr = Array.isArray(val) ? val : [];
                      const toggle = (opt) => setExtra(arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt]);
                      return (
                        <div key={a.id} className="text-xs font-medium text-on-surface-variant">
                          {a.label}
                          <div className="mt-1 flex flex-col gap-1.5">
                            {(a.options || []).length ? a.options.map((opt) => (
                              <label key={opt} className="flex items-center gap-2 font-normal text-on-surface">
                                <input type="checkbox" checked={arr.includes(opt)} onChange={() => toggle(opt)} /> {opt}
                              </label>
                            )) : <span className="font-normal italic">No options set.</span>}
                          </div>
                        </div>
                      );
                    }
                    if (type === 'select') {
                      return (
                        <div key={a.id} className="text-xs font-medium text-on-surface-variant">
                          {a.label}
                          <Select className="mt-1 w-full" aria-label={a.label} value={val ?? ''} onChange={setExtra}
                            options={[{ value: '', label: '— none —' }, ...(a.options || []).map((o) => ({ value: o, label: o }))]} />
                        </div>
                      );
                    }
                    return (
                      <label key={a.id} className="block text-xs font-medium text-on-surface-variant">
                        {a.label}
                        {type === 'multiline' ? (
                          <textarea rows={2} value={val ?? ''} onChange={(e) => setExtra(e.target.value)} placeholder={a.default || ''} className={`${inputCls} resize-y`} />
                        ) : (
                          <input value={val ?? ''} onChange={(e) => setExtra(e.target.value)} placeholder={a.default || ''} className={inputCls} />
                        )}
                      </label>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        </>
      )}
    </div>

    {crop && (
      <ImageCropper src={crop.src} onDone={cropDone} onCancel={() => setCrop(null)} />
    )}
    {lightbox && (
      <Lightbox src={lightbox.src} alt={lightbox.alt} from={lightbox.from} onClose={() => setLightbox(null)} />
    )}
   </>
  );
}
