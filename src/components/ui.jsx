// Small Material-flavored UI primitives shared across views.
import { forwardRef } from 'react';

export function Icon({ name, className = '', style }) {
  return (
    <span className={`msym ${className}`} style={style} aria-hidden="true">
      {name}
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
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 h-10 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${VARIANTS[variant]} ${className}`}
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
    <div className={`rounded-lg bg-surface-low border border-outline-variant/60 ${className}`}>
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
      className={`h-10 rounded-md border border-outline bg-surface-container px-3 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-outline-variant bg-surface-low p-10 text-center">
      <Icon name={icon} className="text-[48px] text-on-surface-variant" />
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="max-w-md text-sm text-on-surface-variant">{children}</p>
      {action}
    </div>
  );
}
