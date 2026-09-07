// Small Material-flavored UI primitives shared across views.
import { forwardRef } from 'react';

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

export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-card bg-surface-low border border-outline-variant/60 ${className}`}>
      {children}
    </div>
  );
}

export function Select({ value, onChange, options, className = '', 'aria-label': ariaLabel }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-10 rounded-control border border-outline bg-surface-container px-3 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
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
