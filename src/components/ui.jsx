// Small Material-flavored UI primitives shared across views.
import { forwardRef, useState, useRef, useEffect, useCallback } from 'react';

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

const STATUS_STYLES = {
  Open: 'text-status-open border-status-open/40 bg-status-open/10',
  'In Review': 'text-status-review border-status-review/40 bg-status-review/10',
  Closed: 'text-status-closed border-status-closed/40 bg-status-closed/10',
};

export function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status] || 'text-on-surface-variant border-outline-variant bg-surface-variant'}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function DisciplineBadge({ discipline }) {
  return (
    <span className="inline-flex items-center rounded-md bg-tertiary-container px-2 py-0.5 text-xs font-medium text-on-tertiary-container">
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
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const current = opts.find((o) => o.value === value);

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
      if (!rootRef.current?.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, close]);

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
      {(open || closing) && (
        <ul role="listbox" aria-label={ariaLabel} className={`dd-menu ${open ? 'open' : 'closing'}`}>
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
        </ul>
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
