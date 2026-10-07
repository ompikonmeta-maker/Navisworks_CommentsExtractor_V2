import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Icon, Button, Select } from './ui.jsx';
import { DISCIPLINES, detectCommenter, inferDiscipline, cleanComment } from '../lib/parser.js';
import { MANUAL } from '../lib/merge.js';

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

// "2026/10/7 14:05:09" — the same shape Navisworks writes, so dates sort and
// age the same as imported comments.
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const inputCls = 'mt-1 w-full rounded-control border border-outline-variant bg-surface-low px-3 text-sm text-on-surface placeholder:text-on-surface-variant hover:border-outline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

// A comment typed in by hand — for issues raised outside Navisworks (a site
// walk, a meeting). It joins the review as Open and is kept on re-import.
export default function AddCommentDialog({ open, onClose, onAdd, records, customCommenters, openStatus }) {
  const [text, setText] = useState('');
  const [viewpoint, setViewpoint] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [commenter, setCommenter] = useState('');
  const [photo, setPhoto] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setText(''); setViewpoint(''); setDiscipline(''); setCommenter(''); setPhoto(''); setBusy(false);
  }, [open]);

  const commenters = useMemo(() => {
    const set = new Set();
    for (const r of records) if (r.commenter) set.add(r.commenter);
    for (const c of customCommenters || []) set.add(c);
    return [...set].sort();
  }, [records, customCommenters]);
  const viewpoints = useMemo(() => [...new Set(records.map((r) => r.viewpoint).filter(Boolean))].sort(), [records]);

  // Blank dropdowns follow the text, the way an import reads it.
  const autoDisc = text.trim() ? inferDiscipline(text) : '';
  const autoCommenter = text.trim() ? detectCommenter(text) : '';

  const takePhoto = async (files) => {
    const f = Array.from(files || []).find((x) => x.type.startsWith('image/'));
    if (f) { try { setPhoto(await readAsDataURL(f)); } catch { /* unreadable */ } }
  };
  // A snapshot on the clipboard goes straight in (Ctrl+V anywhere in the dialog).
  useEffect(() => {
    if (!open) return undefined;
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); takePhoto([item.getAsFile()]); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open]);

  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    const who = commenter || autoCommenter;
    // Keep the "Name:" prefix in the raw text so detection can be re-run.
    const raw = commenter && cleanComment(body) === body ? `${commenter}: ${body}` : body;
    const rec = {
      commentId: '',
      viewpoint: viewpoint.trim() || 'Manual',
      discipline: discipline || autoDisc || 'OTHER',
      commenter: who,
      commentRaw: raw,
      commentText: cleanComment(raw) || body,
      resolution: '',
      status: openStatus,
      rawStatus: openStatus,
      closedAt: null,
      commentDate: nowStamp(),
      authorCode: '',
      cameraPosition: '',
      imageRef: '',
      imageData: photo,
      afterImageData: '',
      extra: {},
      source: MANUAL,
    };
    setBusy(true);
    try { await onAdd(rec); } finally { setBusy(false); }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} labelledBy="add-title" width={560}>
      <div onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-primary-container text-on-primary-container"><Icon name="add" className="text-[22px]" /></span>
          <h2 id="add-title" className="text-lg font-semibold">Add comment</h2>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_132px] gap-3 max-[479px]:grid-cols-1">
          <label className="block min-w-0 text-xs font-medium text-on-surface-variant">
            Comment
            <textarea data-autofocus value={text} onChange={(e) => setText(e.target.value)} rows={5}
              placeholder="e.g. CPY_Dito: Provide access platform for the valve"
              className={`${inputCls} resize-none py-2 leading-relaxed`} />
          </label>
          <div className="min-w-0 text-xs font-medium text-on-surface-variant">
            Before photo
            <div
              className={`ba-thumb relative mt-1 flex flex-col items-center justify-center gap-1 overflow-hidden ${over ? 'drop-over' : ''}`}
              style={{ height: 'calc(5 * 1.625em + 18px)' }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); takePhoto(e.dataTransfer.files); }}
            >
              {photo ? (
                <>
                  <img src={photo} alt="Before" className="absolute inset-0 h-full w-full object-cover" />
                  <button type="button" onClick={() => setPhoto('')} aria-label="Remove photo"
                    className="t-press absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white hover:bg-black/70">
                    <Icon name="close" className="text-[16px]" />
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-1 text-on-surface-variant">
                  <Icon name="cloud_upload" className="text-[24px] text-primary" />
                  <span className="text-xs font-medium">Upload</span>
                  <span className="text-[10px] font-normal">or Ctrl+V a snapshot</span>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png" className="hidden" onChange={(e) => { takePhoto(e.target.files); e.target.value = ''; }} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 max-[479px]:grid-cols-1">
          <label className="block min-w-0 text-xs font-medium text-on-surface-variant">
            Viewpoint
            <input value={viewpoint} onChange={(e) => setViewpoint(e.target.value)} list="add-vps" placeholder="Manual" className={`${inputCls} h-10`} />
            <datalist id="add-vps">{viewpoints.slice(0, 400).map((v) => <option key={v} value={v} />)}</datalist>
          </label>
          <label className="block min-w-0 text-xs font-medium text-on-surface-variant">
            Discipline
            <Select className="mt-1 w-full" aria-label="Discipline" value={discipline} onChange={setDiscipline}
              options={[{ value: '', label: autoDisc ? `Auto · ${autoDisc}` : 'Auto' }, ...DISCIPLINES.map((d) => ({ value: d, label: d }))]} />
          </label>
          <label className="block min-w-0 text-xs font-medium text-on-surface-variant">
            Commenter
            <Select className="mt-1 w-full" aria-label="Commenter" value={commenter} onChange={setCommenter}
              options={[{ value: '', label: autoCommenter ? `Auto · ${autoCommenter}` : 'Auto' }, ...commenters.map((c) => ({ value: c, label: c }))]} />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="filled" onClick={save} disabled={!text.trim() || busy}>{busy ? 'Adding…' : 'Add comment'}</Button>
        </div>
      </div>
    </Dialog>
  );
}
