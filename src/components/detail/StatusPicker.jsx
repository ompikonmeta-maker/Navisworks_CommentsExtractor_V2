// The status buttons of a comment, in registry order; keys 1–9 pick them
// (the key handler lives in DetailPanel).
import { chipStyle } from '../../lib/status.js';

export default function StatusPicker({ statuses, value, onPick, readOnly }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-on-surface-variant">Status</div>
      <div role="group" aria-label="Status" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(statuses.length, 4)}, minmax(0, 1fr))` }}>
        {statuses.map((s, i) => {
          const on = value === s.label;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
              title={i < 9 ? `${s.label} · ${i + 1}` : s.label}
              onClick={() => onPick(s.label)}
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
  );
}
