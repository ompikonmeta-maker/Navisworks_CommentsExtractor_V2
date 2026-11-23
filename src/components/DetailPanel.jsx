import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { DISCIPLINES } from '../lib/parser.js';
import { attrFields } from '../lib/templateExcel.js';
import { doneLabel as doneLabelOf } from '../lib/status.js';
import { Icon, Select, StatusBadge, DisciplineBadge, Dialog, Button, discOptions } from './ui.jsx';
import ImageCropper from './ImageCropper.jsx';
import { fmtStamp } from '../lib/overview.js';
import { useData, data } from '../data/index.js';
import Lightbox from './Lightbox.jsx';
import History from './detail/History.jsx';
import StatusPicker from './detail/StatusPicker.jsx';
import CustomFields from './detail/CustomFields.jsx';

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
// docked: shown as the right pane of the Work screen (no slide, no close, no
// click-outside); otherwise a drawer over the list.
// nav: { index, total, prev, next, hasPrev?, hasNext? } over the list shown;
// onClosedOut(id) is called when this comment moves to the done status (the
// list can then move on); onDelete(id) removes the comment.
export default function DetailPanel({ record, onClose, nav, onClosedOut, onDelete, docked = false, empty = null }) {
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
    if (open && !docked) closeRef.current?.focus();
  }, [open, shown?.ID, docked]);
  const hasNext = nav ? (nav.hasNext ?? (nav.index >= 0 && nav.index < nav.total - 1)) : false;
  const hasPrev = nav ? (nav.hasPrev ?? nav.index > 0) : false;

  // Esc + click-outside close. A click on a table row is a switch, not a close.
  useEffect(() => {
    if (!open || docked) return undefined;
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
  }, [open, onClose, docked]);

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
      if (hasNext) { e.preventDefault(); nav.next(); }
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
  // "Snip" (Windows): opens the Snipping Tool's area picker through the
  // ms-screenclip: link; the snip lands on the clipboard. Back in the tab,
  // Ctrl+V pastes it into After — or, where the browser lets the page read the
  // clipboard (localhost, the offline file), it is picked up on its own.
  const [snipping, setSnipping] = useState(false);
  const canSnip = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent || '');
  const startSnip = () => { setPasteTo('after'); setSnipping(true); };
  useEffect(() => { setSnipping(false); }, [record?.ID]);
  useEffect(() => {
    if (!snipping) return undefined;
    const onFocus = async () => {
      if (!window.isSecureContext || !navigator.clipboard?.read) return;
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            setSnipping(false);
            pickImage([new File([blob], 'snip.png', { type })], 'after');
            return;
          }
        }
      } catch { /* not allowed — Ctrl+V still works */ }
    };
    window.addEventListener('focus', onFocus);
    const stop = setTimeout(() => setSnipping(false), 120000);
    return () => { window.removeEventListener('focus', onFocus); clearTimeout(stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snipping, rec?.ID]);
  const pasteRef = useRef('after');
  pasteRef.current = pasteTo;
  useEffect(() => { setPasteTo('after'); }, [record?.ID]);
  useEffect(() => {
    if (!open) return undefined;
    const onPaste = (e) => {
      if (document.querySelector('.t-dlg, .crop-card')) return; // a dialog has it
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); setSnipping(false); pickImage([item.getAsFile()], pasteRef.current); }
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

  const Shell = docked ? 'section' : 'div';
  const shellProps = docked
    ? { 'aria-label': 'Comment details', 'data-drawer': true, className: 'wb-pane h-full' }
    : {
      'data-drawer': true, role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Viewpoint detail', 'aria-hidden': !open, style,
      className: `fixed bottom-3 right-3 top-3 z-40 flex w-[min(483px,92vw)] flex-col overflow-hidden rounded-card border border-outline-variant/60 bg-surface shadow-md-3 ${open ? '' : 'pointer-events-none'}`,
    };

  return (
   <>
    <Shell {...shellProps}>
      {docked && !record && empty}
      {(docked ? record : rec) && (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-outline-variant/60 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DisciplineBadge discipline={rec.discipline} />
                <StatusBadge status={rec.status} />
              </div>
              {/* Comment no., date, camera and Navisworks user stay in the tooltip,
                  not as labels (they are rarely needed while closing a comment). */}
              <h2 className="mt-2 truncate text-lg font-semibold"
                title={[rec.commentId && `Comment #${rec.commentId}`, rec.commentDate && fmtStamp(rec.commentDate), rec.cameraPosition && `Camera ${rec.cameraPosition}`, rec.authorCode && `Navisworks user ${rec.authorCode}`].filter(Boolean).join('\n')}>
                {rec.viewpoint}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {nav && nav.total > 0 && (hasPrev || hasNext) && (
                <>
                  {nav.index >= 0 && <span className="mr-1.5 text-[13px] tabular-nums text-on-surface-variant">{nav.index + 1} of {nav.total}</span>}
                  <span role="group" aria-label="Move between comments" className="flex gap-0.5 rounded-[14px] bg-surface-container p-[3px]">
                    <button type="button" onClick={nav.prev} disabled={!hasPrev} aria-label="Previous comment (K)" title="Previous · K"
                      className="dr-nav t-press grid h-9 w-9 place-items-center rounded-[11px] text-on-surface disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <Icon name="keyboard_arrow_up" className="text-[24px]" />
                    </button>
                    <button type="button" onClick={nav.next} disabled={!hasNext} aria-label="Next comment (J)" title="Next · J"
                      className="dr-nav t-press grid h-9 w-9 place-items-center rounded-[11px] text-on-surface disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <Icon name="keyboard_arrow_down" className="text-[24px]" />
                    </button>
                  </span>
                </>
              )}
              {!docked && <button
                ref={closeRef}
                onClick={onClose}
                aria-label="Close" title="Close · Esc"
                className="t-press ml-1 grid h-10 w-10 place-items-center rounded-[14px] text-on-surface hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name="close" className="text-[24px]" />
              </button>}
            </div>
          </div>

          {/* Body — re-keyed by record so switching rows cross-fades in place */}
          <div key={rec.ID} className={`${docked ? 'wb-detail-swap' : 'drawer-swap'} wb-scroll flex-1 space-y-5 overflow-y-auto px-5 py-4`}>
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
                      <span className="flex items-center gap-1.5">
                        {!readOnly && canSnip && slot.target === 'after' && (
                          <a href="ms-screenclip:" onClick={startSnip} title="Snip an area of the screen (Snipping Tool), then press Ctrl+V here"
                            className="t-press inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            <Icon name="photo_camera" className="text-[15px]" />Snip
                          </a>
                        )}
                        {!readOnly && <kbd className={`ba-kbd ${pasteTo === slot.target ? 'on' : ''}`} title={`Ctrl+V pastes a snapshot here`}>Ctrl V</kbd>}
                      </span>
                    </span>
                    {snipping && slot.target === 'after' && (
                      <div role="status" className="rounded-[10px] bg-primary-container px-2.5 py-1.5 text-[12px] font-medium text-on-primary-container">
                        Pick the area, then come back and press <b>Ctrl+V</b>.
                        <button type="button" onClick={() => setSnipping(false)} className="ml-1 underline">Cancel</button>
                      </div>
                    )}
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

              {!rec.afterImageData && !readOnly && !docked && (
                <p className="text-xs text-on-surface-variant">An after photo is cropped to a uniform size and marks this comment Closed.</p>
              )}
            </div>

            <p className="whitespace-pre-line text-sm leading-relaxed">{rec.commentText}</p>


            <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <StatusPicker statuses={settings.statuses} value={rec.status} onPick={pickStatus} readOnly={readOnly} />

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

            {/* Custom attributes for the template export (Export mapping's attr fields). */}
            <CustomFields attrs={exportAttrs} extra={rec.extra} onChange={(extra) => set({ extra })} />
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
            {hasNext && (
              <button type="button" onClick={nav.next} title="Next comment · Ctrl+Enter" aria-keyshortcuts="Control+Enter"
                className={`t-press inline-flex h-10 items-center gap-2 rounded-control pl-4 pr-3 text-[14px] font-semibold hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${docked ? 'bg-primary text-on-primary' : 'bg-secondary-container text-on-secondary-container'}`}>
                Next comment<Icon name="arrow_forward" className="text-[20px]" />
              </button>
            )}
          </div>
        </>
      )}
    </Shell>

    <Dialog open={askDelete} onClose={() => setAskDelete(false)} labelledBy="del-title" width={420}>
      <h2 id="del-title" className="text-lg font-semibold">{data().caps.trash ? 'Move this comment to the Trash?' : 'Delete this comment?'}</h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        {data().caps.trash
          ? `${rec?.viewpoint} and its photos disappear for everyone. An admin can restore it from the Trash within 30 days.`
          : `${rec?.viewpoint} and its photos are removed${data().caps.shared ? ' for everyone' : ''}. This can’t be undone.`}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="text" onClick={() => setAskDelete(false)}>Cancel</Button>
        <Button variant="danger" onClick={() => { setAskDelete(false); onDelete?.(rec.ID); }}>{data().caps.trash ? 'Move to Trash' : 'Delete comment'}</Button>
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

