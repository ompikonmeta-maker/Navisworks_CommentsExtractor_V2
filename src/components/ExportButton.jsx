import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

// The main export action: "Export log sheet" (the Excel template — the
// review's deliverable), with Quick Excel behind the arrow.
export default function ExportButton({ onLogSheet, onQuick, quickNote = 'All comments', disabled }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const run = (fn) => async () => {
    setOpen(false);
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const off = disabled || busy;
  return (
    <div ref={ref} className="relative inline-flex shrink-0" data-nosnap>
      <button type="button" onClick={run(onLogSheet)} disabled={off}
        className="t-press inline-flex h-10 items-center gap-2 rounded-l-control bg-primary pl-4 pr-3 text-sm font-medium text-on-primary hover:shadow-md-1 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        <Icon name="description" className="text-[19px]" />{busy ? 'Exporting…' : 'Export log sheet'}
      </button>
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={off} aria-label="More export options" aria-haspopup="menu" aria-expanded={open}
        className="t-press ml-px inline-flex h-10 w-9 items-center justify-center rounded-r-control bg-primary text-on-primary hover:shadow-md-1 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        <Icon name="expand_more" className={`text-[20px] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div role="menu" className={`t-pop absolute right-0 top-12 z-30 w-64 rounded-[16px] bg-surface p-1.5 ${open ? 'show' : ''}`}>
        <button role="menuitem" className="t-menuitem" onClick={run(onLogSheet)}>
          <Icon name="description" className="text-[19px]" />
          <span><span className="block font-medium">Log sheet</span><span className="block text-xs text-on-surface-variant">From your Excel template</span></span>
        </button>
        <button role="menuitem" className="t-menuitem" onClick={run(onQuick)}>
          <Icon name="download" className="text-[19px]" />
          <span><span className="block font-medium">Quick Excel</span><span className="block text-xs text-on-surface-variant">{quickNote}</span></span>
        </button>
      </div>
    </div>
  );
}
