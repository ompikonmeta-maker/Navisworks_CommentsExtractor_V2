// =====================================================================
// Status registry. Statuses used to be a fixed enum (Open / In Review /
// Closed). They are now configurable in Settings: an admin can rename or
// recolour any status, and add or remove the "middle" ones. Two roles are
// mandatory and always present:
//   • role 'open'  — the status new comments start in (first).
//   • role 'done'  — the "finished" status that stamps closedAt (last).
// Everything between them is role 'middle' and fully editable.
// Records store the status LABEL; renaming migrates records in the store.
// =====================================================================

// Open is orange (work to do, not an error), the middle violet, Closed green —
// a set checked for colour-blind separation. Red stays free for "late".
export const DEFAULT_STATUSES = [
  { key: 'open', label: 'Open', color: '#e8590c', role: 'open' },
  { key: 'review', label: 'In Review', color: '#6a4fd8', role: 'middle' },
  { key: 'closed', label: 'Closed', color: '#12946a', role: 'done' },
];

// The previous default colours. A status still wearing one moves to the new
// default for its slot; colours the user picked themselves are left alone.
const OLD_DEFAULT_COLORS = { '#bf0031': '#e8590c', '#9a6800': '#6a4fd8', '#1f7a4d': '#12946a' };
const upgradeColor = (s) => {
  const next = OLD_DEFAULT_COLORS[String(s.color || '').toLowerCase()];
  return next ? { ...s, color: next } : s;
};

// Guarantee a well-formed list: exactly one 'open' first, one 'done' last,
// middles in between. Repairs anything malformed (e.g. an old saved session).
export function normalizeStatuses(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_STATUSES.map((s) => ({ ...s }));
  const open = list.find((s) => s.role === 'open') || { ...DEFAULT_STATUSES[0] };
  const done = list.find((s) => s.role === 'done') || { ...DEFAULT_STATUSES[2] };
  const middles = list.filter((s) => s !== open && s !== done && s.role !== 'open' && s.role !== 'done');
  return [{ ...open, role: 'open' }, ...middles.map((s) => ({ ...s, role: 'middle' })), { ...done, role: 'done' }].map(upgradeColor);
}

export const statusLabels = (list) => (list || []).map((s) => s.label);
export const openStatus = (list) => (list || []).find((s) => s.role === 'open') || DEFAULT_STATUSES[0];
export const doneStatus = (list) => (list || []).find((s) => s.role === 'done') || DEFAULT_STATUSES[2];
export const openLabel = (list) => openStatus(list).label;
export const doneLabel = (list) => doneStatus(list).label;
export const statusColor = (list, label) => ((list || []).find((s) => s.label === label)?.color) || '#8b93a3';

// Map an incoming status label onto the current registry. Handles data parsed
// to the default labels after the user renamed a status: a default label
// resolves to whatever now holds the same role; anything unknown falls to Open.
export function resolveStatus(label, list) {
  if ((list || []).some((s) => s.label === label)) return label;
  const def = DEFAULT_STATUSES.find((s) => s.label === label);
  if (def) {
    const cur = (list || []).find((s) => s.role === def.role);
    if (cur) return cur.label;
  }
  return openLabel(list);
}

// Inline styles (statuses are dynamic, so we can't use fixed Tailwind classes).
export const chipStyle = (color) => ({
  color: `color-mix(in srgb, ${color} var(--tabelin-status-ink), var(--md-sys-color-on-surface))`,
  borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
  background: `color-mix(in srgb, ${color} 10%, transparent)`,
});
