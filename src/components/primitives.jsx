// Workbench primitives (Phase 4). With Button, Select, Dialog, InfoTip and
// Toast from ui.jsx these are the ten building blocks of the Work screen:
//   Button · Field · Select · Dialog · Menu (ExportButton) · Chip (StatusBadge,
//   DisciplineBadge) · ListRow (CommentRow, QueueItem) · Pane · Toast · Tooltip (InfoTip)
// They read only the --wb-* tokens and the MD3 colour roles (index.css).
import { forwardRef } from 'react';
import { Icon } from './ui.jsx';

/** A white surface that scrolls inside itself. `as` = section | aside | div. */
export const Pane = forwardRef(function Pane({ as: Tag = 'section', label, className = '', children, ...rest }, ref) {
  return <Tag ref={ref} aria-label={label} className={`wb-pane ${className}`} {...rest}>{children}</Tag>;
});

/** Title (+ count) and a one-line reason, with room for actions on the right. */
export function PaneHeader({ title, count, sub, right, children }) {
  return (
    <div className="wb-pane-head">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[length:var(--wb-text-xl)] font-bold leading-tight tracking-[-0.01em]">{title}</h2>
        {count != null && <span className="text-[length:var(--wb-text-md)] tabular-nums text-on-surface-variant">{count}</span>}
        {right && <div className="ml-auto flex items-center gap-1">{right}</div>}
      </div>
      {sub && <p className="mt-1 text-[length:var(--wb-text-md)] text-on-surface-variant">{sub}</p>}
      {children}
    </div>
  );
}

/** One queue: rank (or icon) · label · count. Pressed = selected. */
export function QueueItem({ rank, icon, label, n, on, onClick, title }) {
  return (
    <button type="button" className="wb-queue" aria-pressed={on} data-empty={n === 0} onClick={onClick} title={title}>
      <span className="wb-queue-rank">{rank ?? <Icon name={icon} className="text-[15px]" />}</span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="wb-queue-n">{n}</span>
    </button>
  );
}

/** Keyboard key hint. */
export function Kbd({ children }) {
  return <kbd className="wb-kbd">{children}</kbd>;
}

/** Text input in the workbench style (quiet until hover / focus). */
export const Field = forwardRef(function Field({ className = '', ...props }, ref) {
  return <input ref={ref} className={`wb-field ${className}`} {...props} />;
});
