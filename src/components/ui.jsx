// Small Material-flavored UI primitives shared across views.
import { forwardRef, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../store/settings.jsx';
import { statusColor, chipStyle } from '../lib/status.js';

// Icons not in the embedded Material Symbols subset render as inline SVG so we
// don't have to re-subset the font. Sized in `em` to follow the text size set
// on the span (e.g. text-[22px]).
const INLINE_SVG = {
  settings: (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.13.22.39.3.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
    </svg>
  ),
};

// Material Symbols codepoints for the icons this app uses. Rendering by
// codepoint (not ligature) lets the embedded font subset stay ~4 KB and
// work fully offline. Keep this map in sync with the font subset in
// index.css when adding a new icon.
const ICON_CODEPOINTS = {
  bar_chart: 'e26b',
  check_circle: 'f0be',
  chevron_right: 'e5cc',
  close: 'e5cd',
  cloud_upload: 'e2c3',
  dark_mode: 'e51c',
  dashboard: 'e871',
  description: 'e873',
  donut_large: 'e917',
  download: 'f090',
  error: 'f8b6',
  fact_check: 'f0c5',
  filter_alt_off: 'eb32',
  folder_open: 'e2c8',
  format_list_bulleted: 'e241',
  forum: 'e8af',
  hourglass_top: 'ea5b',
  image: 'e3f4',
  image_not_supported: 'f116',
  info: 'e88e',
  insights: 'f092',
  light_mode: 'e518',
  link: 'e250',
  memory: 'e322',
  person: 'f0d3',
  radio_button_unchecked: 'e836',
  restart_alt: 'f053',
  search: 'ef7a',
  search_off: 'ea76',
  table_view: 'f1be',
  timeline: 'e922',
  upload_file: 'e9fc',
  videocam: 'e04b',
  warning: 'f083',
};

export function Icon({ name, className = '', style }) {
  if (INLINE_SVG[name]) {
    return (
      <span className={`msym inline-flex ${className}`} style={style} aria-hidden="true">
        {INLINE_SVG[name]}
      </span>
    );
  }
  const cp = ICON_CODEPOINTS[name];
  return (
    <span className={`msym ${className}`} style={style} aria-hidden="true">
      {cp ? String.fromCodePoint(parseInt(cp, 16)) : name}
    </span>
  );
}

const VARIANTS = {
  filled: 'bg-primary text-on-primary hover:shadow-md-1 disabled:opacity-40',
  tonal: 'bg-secondary-container text-on-secondary-container hover:shadow-md-1 disabled:opacity-40',
  outlined: 'border border-outline text-primary hover:bg-primary/10 disabled:opacity-40',
  text: 'text-primary hover:bg-primary/10 disabled:opacity-40',
  danger: 'bg-error text-on-error hover:shadow-md-1 disabled:opacity-40',
};

export const Button = forwardRef(function Button(
  { variant = 'filled', icon, children, className = '', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-control px-5 h-10 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} className="text-[20px]" />}
      {children}
    </button>
  );
});

export function StatusBadge({ status }) {
  const { settings } = useSettings();
  const color = statusColor(settings.statuses, status);
  return (
    <span
      style={chipStyle(color)}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function DisciplineBadge({ discipline }) {
  const { settings } = useSettings();
  const c = settings.disciplineColors?.[discipline];
  const style = c ? { background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c } : undefined;
  return (
    <span
      style={style}
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${c ? '' : 'bg-tertiary-container text-on-tertiary-container'}`}
    >
      {discipline}
    </span>
  );
}

export const Card = forwardRef(function Card({ children, className = '' }, ref) {
  return (
    <div ref={ref} className={`rounded-card bg-surface-low border border-outline-variant/60 ${className}`}>
      {children}
    </div>
  );
});

// MD3 exposed dropdown menu — an outlined field that opens an anchored menu
// (surface-container, elevation 2, spring open). Same props as the old
// native <select> so all call sites keep working. Chevron + check are inline
// SVG so they render offline without enlarging the icon-font subset.
export function Select({ value, onChange, options, className = '', 'aria-label': ariaLabel }) {
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const current = opts.find((o) => o.value === value);

  // The menu is rendered in a portal with fixed positioning so it can never be
  // clipped by a scrollable/overflow ancestor (e.g. a mapping table).
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const minW = Math.max(r.width, 180);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - minW));
    setPos({ top: r.bottom + 6, left, width: r.width });
  }, []);

  const close = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) {
        setClosing(true);
        setTimeout(() => setClosing(false), 140);
      }
      return false;
    });
  }, []);
  const openMenu = () => {
    setClosing(false);
    place();
    setOpen(true);
    setActive(Math.max(0, opts.findIndex((o) => o.value === value)));
  };
  const choose = (v) => {
    onChange(v);
    close();
    btnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      close();
    };
    const reposition = () => place();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, close, place]);

  const onKey = (e) => {
    if (e.key === 'Escape') return close();
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      return openMenu();
    }
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(opts.length - 1, a + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(opts.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (active >= 0) choose(opts[active].value); }
    }
    return undefined;
  };

  return (
    <div ref={rootRef} className={`dd ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKey}
        className="dd-trigger"
      >
        <span className="truncate">{current ? current.label : ''}</span>
        <svg className="dd-chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {(open || closing) && createPortal(
        <ul
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className={`dd-menu ${open ? 'open' : 'closing'}`}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 180) }}
        >
          {opts.map((o, i) => {
            const sel = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={sel}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
                className={`dd-item ${sel ? 'selected' : ''} ${i === active ? 'active' : ''}`}
              >
                <span className="dd-lead">
                  {sel && (
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                    </svg>
                  )}
                </span>
                {o.label}
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}

// MD3 segmented button group — a single connected, outlined control for a
// small set of mutually-exclusive choices. The selected segment fills with
// the secondary container and shows a check (inline SVG so it works offline
// without adding to the icon-font subset).
export function SegmentedButtons({ value, onChange, options, 'aria-label': ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="seg-group">
      {options.map((o) => {
        const val = o.value ?? o;
        const label = o.label ?? o;
        const on = val === value;
        return (
          <button
            key={val}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(val)}
            className={`seg-btn ${on ? 'on' : ''}`}
          >
            <span className="seg-chk">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
              </svg>
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-outline-variant bg-surface-low p-10 text-center">
      <Icon name={icon} className="text-[48px] text-on-surface-variant" />
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="max-w-md text-sm text-on-surface-variant">{children}</p>
      {action}
    </div>
  );
}

// Small "i" affordance that reveals a tooltip bubble on hover/focus. Styling
// lives in index.css (`.info-tip` / `.info-bubble`), with the ~0.4s hover
// delay. Use it to keep long explanations out of the way.
export function InfoTip({ children, label = 'More info' }) {
  return (
    <span className="info-tip" tabIndex={0} role="button" aria-label={label}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="8" r="1.3" fill="currentColor" />
        <path d="M12 11v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="info-bubble" role="tooltip">{children}</span>
    </span>
  );
}
