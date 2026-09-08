import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { DISCIPLINES, STATUSES } from '../lib/parser.js';
import { Icon, Select, SegmentedButtons, StatusBadge, DisciplineBadge } from './ui.jsx';
import ImageCropper from './ImageCropper.jsx';
import Lightbox from './Lightbox.jsx';

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

// A square thumbnail that enlarges to the lightbox when tapped.
function Thumb({ caption, src, alt, onEnlarge }) {
  return (
    <div className="ba-cell">
      <span className="ba-cap">{caption}</span>
      <button
        type="button"
        className="ba-thumb"
        onClick={(e) => onEnlarge(src, alt, e.currentTarget.querySelector('img'))}
        aria-label={`Enlarge ${caption.toLowerCase()} image`}
      >
        <img src={src} alt={alt} />
        <span className="ba-zoom">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              d="M9 4H5a1 1 0 0 0-1 1v4m11-5h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4m11 5h4a1 1 0 0 0 1-1v-4" />
          </svg>
        </span>
      </button>
    </div>
  );
}

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
  const afterInputRef = useRef(null);
  const [cropSrc, setCropSrc] = useState(null); // data URL being cropped
  const [lightbox, setLightbox] = useState(null); // { src, alt, from }

  const enlarge = (src, alt, imgEl) => {
    const r = imgEl.getBoundingClientRect();
    setLightbox({ src, alt, from: { x: r.left, y: r.top, w: r.width, h: r.height } });
  };

  const handleAfter = async (fileList) => {
    const file = Array.from(fileList || [])[0];
    if (!file || !rec) return;
    try {
      setCropSrc(await readAsDataURL(file)); // open the crop dialog
    } catch {
      /* ignore read errors */
    }
  };

  const cropDone = (dataUrl) => {
    // A cropped after photo implies the issue is resolved → Closed.
    if (rec) updateRecord(rec.ID, { afterImageData: dataUrl, status: 'Closed' });
    setCropSrc(null);
  };

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
            {/* Before / after — side-by-side squares, tap to enlarge; the
                after upload passes through the crop dialog and marks Closed. */}
            <div className="space-y-2">
              <div className="ba-grid">
                {rec.imageData ? (
                  <Thumb caption="Before" src={rec.imageData} alt={`Before — ${rec.viewpoint}`} onEnlarge={enlarge} />
                ) : (
                  <div className="ba-cell">
                    <span className="ba-cap">Before</span>
                    <div className="ba-thumb flex flex-col items-center justify-center gap-1 text-on-surface-variant" style={{ cursor: 'default' }}>
                      <Icon name="image_not_supported" className="text-[24px]" />
                      <span className="px-2 text-center text-[11px]">{rec.imageRef ? `${rec.imageRef} unavailable` : 'No image'}</span>
                    </div>
                  </div>
                )}

                {rec.afterImageData ? (
                  <Thumb caption="After" src={rec.afterImageData} alt="After" onEnlarge={enlarge} />
                ) : (
                  <div className="ba-cell">
                    <span className="ba-cap">After</span>
                    <button className="ba-thumb flex flex-col items-center justify-center gap-1 text-on-surface-variant" onClick={() => afterInputRef.current?.click()}>
                      <Icon name="cloud_upload" className="text-[26px] text-primary" />
                      <span className="text-xs font-medium">Upload</span>
                    </button>
                  </div>
                )}
              </div>

              {rec.afterImageData && (
                <button
                  onClick={() => afterInputRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Icon name="restart_alt" className="text-[15px]" /> Replace after photo
                </button>
              )}
              {!rec.afterImageData && (
                <p className="text-xs text-on-surface-variant">Uploading an after photo crops it to a uniform size and marks this comment Closed.</p>
              )}
              {rec.cameraPosition && (
                <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <Icon name="videocam" className="text-[16px]" /> {rec.cameraPosition}
                </div>
              )}
              <input
                ref={afterInputRef}
                type="file"
                accept=".jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => { handleAfter(e.target.files); e.target.value = ''; }}
              />
            </div>

            <p className="whitespace-pre-line text-sm leading-relaxed">{rec.commentText}</p>

            {rec.authorCode && (
              <div className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant">
                <Icon name="person" className="text-[18px]" /> {rec.authorCode}
              </div>
            )}

            <label className="block text-xs font-medium text-on-surface-variant">
              Discipline
              <Select className="mt-1 w-full" aria-label="Change discipline" value={rec.discipline} onChange={(v) => set({ discipline: v })} options={DISCIPLINES} />
            </label>

            <div>
              <div className="mb-1 text-xs font-medium text-on-surface-variant">Status</div>
              <SegmentedButtons aria-label="Change status" value={rec.status} onChange={(v) => set({ status: v })} options={STATUSES} />
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
        </>
      )}
    </div>

    {cropSrc && (
      <ImageCropper src={cropSrc} onDone={cropDone} onCancel={() => setCropSrc(null)} />
    )}
    {lightbox && (
      <Lightbox src={lightbox.src} alt={lightbox.alt} from={lightbox.from} onClose={() => setLightbox(null)} />
    )}
   </>
  );
}
