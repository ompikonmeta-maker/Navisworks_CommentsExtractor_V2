import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { DISCIPLINES } from '../lib/parser.js';
import { attrFields, attrType } from '../lib/templateExcel.js';
import { chipStyle, statusColor, doneLabel as doneLabelOf } from '../lib/status.js';
import { Icon, Select, StatusBadge, DisciplineBadge, Dialog, Button, discOptions, discLabel } from './ui.jsx';
import ImageCropper from './ImageCropper.jsx';
import { fmtStamp } from '../lib/overview.js';
import { useData, data } from '../data/index.js';
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
// "2024-10-07T…" → "2 hours ago" (falls back to a date after a week).
function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// nav: { index, total, prev, next } over the list as filtered on Viewpoints;
// onClosedOut(id) is called when this comment moves to the done status (the
// list can then move on); onDelete(id) removes the comment.
export default function DetailPanel({ record, onClose, nav, onClosedOut, onDelete }) {
  const { updateRecord, records } = useStore();
  const [askDelete, setAskDelete] = useState(false);
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
      if (e.key === 'Escape' && !document.querySelector('.t-dlg, .crop-card')) onClose(); // a dialog on top closes first
    };
    const onDown = (e) => {
      if (e.target.closest('[data-drawer]')) return; // inside the drawer
      if (e.target.closest('.t-dlg, .t-pop')) return; // a dialog or menu above it
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
  const pickStatus = (label) => {
    if (!rec || rec.status === label) return;
    if (label === doneLabel) onClosedOut?.(rec.ID);
    set({ status: label });
  };

  // Keys while the drawer is open: 1…9 pick a status (not while typing),
  // Ctrl/⌘+Enter moves to the next comment (edits are already saved).
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (!rec || document.querySelector('.t-dlg, .crop-card')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (nav && nav.index >= 0 && nav.index < nav.total - 1) { e.preventDefault(); nav.next(); }
      return;
    }
    if (readOnly || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= Math.min(9, settings.statuses.length)) { e.preventDefault(); pickStatus(settings.statuses[n - 1].label); }
  };
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => keyRef.current?.(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);
  // Viewers on the server see everything but can't change it.
  const { caps } = useData();
  const readOnly = !caps.canReview;
  const canDelete = caps.canAdmin; // deleting a comment is for admins
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
    if (readOnly) return;
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
      if (crop.target === 'after' && rec.status !== doneLabel) onClosedOut?.(rec.ID);
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

  // Paste an image anywhere in the drawer (Ctrl+V after a snapshot). It goes
  // to the photo slot last pointed at or focused — After by default.
  const [pasteTo, setPasteTo] = useState('after');
  const pasteRef = useRef('after');
  pasteRef.current = pasteTo;
  useEffect(() => { setPasteTo('after'); }, [record?.ID]);
  useEffect(() => {
    if (!open) return undefined;
    const onPaste = (e) => {
      if (document.querySelector('.t-dlg, .crop-card')) return; // a dialog has it
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); pickImage([item.getAsFile()], pasteRef.current); }
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
              <p className="text-[13px] text-on-surface-variant" title={rec.commentDate}>
                {rec.commentId ? `#${rec.commentId} · ` : ''}{fmtStamp(rec.commentDate)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {nav && nav.total > 1 && nav.index >= 0 && (
                <>
                  <span className="mr-1.5 text-[13px] tabular-nums text-on-surface-variant">{nav.index + 1} of {nav.total}</span>
                  <span role="group" aria-label="Move between comments" className="flex gap-0.5 rounded-[14px] bg-surface-container p-[3px]">
                    <button type="button" onClick={nav.prev} disabled={nav.index <= 0} aria-label="Previous comment (K)" title="Previous · K"
                      className="dr-nav t-press grid h-9 w-9 place-items-center rounded-[11px] text-on-surface disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <Icon name="keyboard_arrow_up" className="text-[24px]" />
                    </button>
                    <button type="button" onClick={nav.next} disabled={nav.index >= nav.total - 1} aria-label="Next comment (J)" title="Next · J"
                      className="dr-nav t-press grid h-9 w-9 place-items-center rounded-[11px] text-on-surface disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <Icon name="keyboard_arrow_down" className="text-[24px]" />
                    </button>
                  </span>
                </>
              )}
              <button
                ref={closeRef}
                onClick={onClose}
                aria-label="Close" title="Close · Esc"
                className="t-press ml-1 grid h-10 w-10 place-items-center rounded-[14px] text-on-surface hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name="close" className="text-[24px]" />
              </button>
            </div>
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
                  <div key={slot.target} className="ba-cell" {...dropProps(slot.target)}
                    onMouseEnter={() => setPasteTo(slot.target)} onFocus={() => setPasteTo(slot.target)}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="ba-cap">{slot.caption}</span>
                      {!readOnly && <kbd className={`ba-kbd ${pasteTo === slot.target ? 'on' : ''}`} title={`Ctrl+V pastes a snapshot here`}>Ctrl V</kbd>}
                    </span>
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
                    ) : readOnly ? (
                      <div className="ba-thumb flex flex-col items-center justify-center gap-1 text-on-surface-variant">
                        <Icon name="image_not_supported" className="text-[24px]" />
                        <span className="text-xs">No photo</span>
                      </div>
                    ) : (
                      <button
                        className={`ba-thumb flex flex-col items-center justify-center gap-1 text-on-surface-variant ${dropOver === slot.target ? 'drop-over' : ''}`}
                        onClick={() => slot.inputRef.current?.click()}
                      >
                        <Icon name="cloud_upload" className="text-[26px] text-primary" />
                        <span className="text-xs font-medium">Upload</span>
                        <span className="text-[12px]">or drop a file</span>
                      </button>
                    )}
                    {slot.src && !readOnly && undo?.target !== slot.target && (
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

              {!rec.afterImageData && !readOnly && (
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

            <fieldset disabled={readOnly} className="contents">
            <div className="grid grid-cols-2 gap-3">
              <label className="block min-w-0 text-xs font-medium text-on-surface-variant">
                Discipline
                <Select className="mt-1 w-full" aria-label="Change discipline" value={rec.discipline || 'OTHER'} onChange={(v) => set({ discipline: v })} options={discOptions(DISCIPLINES)} />
              </label>
              <label className="block min-w-0 text-xs font-medium text-on-surface-variant">
                Commenter
                <Select className="mt-1 w-full" aria-label="Change commenter" value={rec.commenter || ''} onChange={(v) => set({ commenter: v })} options={commenterOptions} />
              </label>
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-on-surface-variant">Status</div>
              <div role="group" aria-label="Status" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(settings.statuses.length, 4)}, minmax(0, 1fr))` }}>
                {settings.statuses.map((s, i) => {
                  const on = rec.status === s.label;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={on}
                      aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                      title={i < 9 ? `${s.label} · ${i + 1}` : s.label}
                      onClick={() => pickStatus(s.label)}
                      style={on ? chipStyle(s.color) : undefined}
                      className={`t-press inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-[12px] border px-2 text-[14px] font-semibold transition-colors ${
                        on ? '' : 'border-outline-variant text-on-surface hover:bg-surface-container'
                      }`}
                    >
                      {i < 9 && !readOnly && <kbd className="st-kbd">{i + 1}</kbd>}
                      <span className="truncate">{s.label}</span>
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
                  className="mt-1 w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="mt-1 block text-[12px] font-normal text-on-surface-variant">Set automatically when closed — edit if the fix happened earlier.</span>
              </label>
            )}

            <label className="block text-xs font-medium text-on-surface-variant">
              Resolution
              <textarea
                value={rec.resolution}
                onChange={(e) => set({ resolution: e.target.value })}
                rows={4}
                placeholder="Decision or follow-up…"
                className="mt-1 w-full resize-y rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                    const inputCls = 'mt-1 w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
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
            </fieldset>

            <History rec={rec} />
          </div>

          {/* Footer: auto-advance, delete, next */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-outline-variant/60 px-5 py-3 text-[13px] text-on-surface-variant">
            {nav && !readOnly && (
              <label className="inline-flex cursor-pointer items-center gap-2" title="After a comment is closed, open the next one in the list">
                <input type="checkbox" checked={nav.autoNext} onChange={(e) => nav.setAutoNext(e.target.checked)} className="h-4 w-4 accent-[var(--md-sys-color-primary)]" />
                Next after closing
              </label>
            )}
            <span className="flex-1" />
            {onDelete && canDelete && (
              <button type="button" onClick={() => setAskDelete(true)} aria-label="Delete this comment" title="Delete this comment"
                className="t-press grid h-10 w-10 place-items-center rounded-[12px] hover:bg-surface-container hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <Icon name="delete" className="text-[20px]" />
              </button>
            )}
            {nav && nav.index >= 0 && nav.index < nav.total - 1 && (
              <button type="button" onClick={nav.next} title="Next comment · Ctrl+Enter" aria-keyshortcuts="Control+Enter"
                className="t-press inline-flex h-10 items-center gap-2 rounded-control bg-secondary-container pl-4 pr-3 text-[14px] font-semibold text-on-secondary-container hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                Next comment<Icon name="arrow_forward" className="text-[20px]" />
              </button>
            )}
          </div>
        </>
      )}
    </div>

    <Dialog open={askDelete} onClose={() => setAskDelete(false)} labelledBy="del-title" width={420}>
      <h2 id="del-title" className="text-lg font-semibold">Delete this comment?</h2>
      <p className="mt-2 text-sm text-on-surface-variant">{rec?.viewpoint} and its photos are removed{data().caps.shared ? ' for everyone' : ''}. This can’t be undone.</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="text" onClick={() => setAskDelete(false)}>Cancel</Button>
        <Button variant="danger" onClick={() => { setAskDelete(false); onDelete?.(rec.ID); }}>Delete comment</Button>
      </div>
    </Dialog>

    {crop && (
      <ImageCropper src={crop.src} onDone={cropDone} onCancel={() => setCrop(null)} />
    )}
    {lightbox && (
      <Lightbox src={lightbox.src} alt={lightbox.alt} from={lightbox.from} onClose={() => setLightbox(null)} />
    )}
   </>
  );
}

// ---- History (server only): who changed what, newest first ----
const SOURCE_KEYS = ['commentRaw', 'commentText', 'viewpoint', 'commentDate', 'authorCode', 'cameraPosition', 'imageRef'];
function describe(ev) {
  const d = ev.detail || {};
  if (ev.action === 'import') return d.source === 'manual' ? 'added this comment' : `imported it${d.source ? ` from ${d.source}` : ''}`;
  if (ev.action === 'photo') return `${d.op === 'remove' ? 'removed' : 'added'} the ${d.kind === 'after' ? 'after' : 'before'}-photo`;
  const f = d.fields || [];
  const parts = [];
  if (f.includes('status')) parts.push(`set status to ${d.status || '—'}`);
  if (f.includes('discipline')) parts.push(`set discipline to ${discLabel(d.discipline)}`);
  if (f.includes('commenter')) parts.push(d.commenter ? `set commenter to ${d.commenter}` : 'cleared the commenter');
  if (f.includes('resolution')) parts.push('wrote the resolution');
  if (f.includes('closedAt') && !f.includes('status')) parts.push('changed the close date');
  if (f.includes('extra')) parts.push('filled in custom fields');
  if (f.some((k) => SOURCE_KEYS.includes(k))) parts.push('updated it from a new report');
  return parts.join(', ') || 'edited it';
}
function History({ rec }) {
  const source = useData();
  const { settings } = useSettings();
  const [items, setItems] = useState(null);
  const [all, setAll] = useState(false);
  const lastId = useRef(null);
  const id = rec?.ID;
  useEffect(() => { setItems(null); setAll(false); }, [id]);
  useEffect(() => {
    if (!source.caps.hasHistory || id == null) return undefined;
    let live = true;
    // Wait a moment after an edit so the batched save has reached the server.
    const sameRecord = lastId.current === id;
    lastId.current = id;
    const t = setTimeout(() => { source.history(id).then((x) => live && setItems(x)).catch(() => live && setItems([])); }, sameRecord ? 1500 : 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rec?.changedAt, rec?.imageData, rec?.afterImageData]);
  if (!source.caps.hasHistory) return null;
  // Typing is saved in bursts: fold repeats by the same person within 10 minutes.
  const rows = [];
  for (const ev of items || []) {
    const text = describe(ev);
    const prev = rows[rows.length - 1];
    if (prev && prev.user === ev.user && prev.text === text && Math.abs(Date.parse(prev.at) - Date.parse(ev.at)) < 600000) continue;
    rows.push({ ...ev, text });
  }
  const shown = all ? rows : rows.slice(0, 5);
  const dot = (ev) => (ev.action === 'import' ? 'var(--md-sys-color-outline)' : ev.detail?.status ? statusColor(settings.statuses, ev.detail.status) : 'var(--md-sys-color-primary)');
  return (
    <section aria-label="History">
      <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><Icon name="history" className="text-[18px] text-on-surface-variant" />History</h3>
      {items == null ? <div className="skeleton h-12 w-full rounded-control" /> : rows.length === 0 ? (
        <p className="text-[13px] text-on-surface-variant">No changes recorded yet.</p>
      ) : (
        <ol className="hist space-y-2.5">
          {shown.map((ev, i) => (
            <li key={i} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-2.5 text-[13px]">
              <span className="h-2 w-2 translate-y-[1px] rounded-full" style={{ background: dot(ev) }} />
              <span className="min-w-0"><b className="font-semibold">{ev.user || 'Someone'}</b> {ev.text}</span>
              <span className="whitespace-nowrap text-on-surface-variant" title={new Date(ev.at).toLocaleString()}>{timeAgo(ev.at)}</span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 5 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 rounded-full px-2 py-1 text-[13px] font-medium text-primary hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {all ? 'Show less' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
