// =====================================================================
// Re-import: merge a newer Navisworks report into a review that already has
// comments, instead of appending duplicates.
//
// Comments are matched by their Navisworks comment ID (unique per report;
// viewpoint + raw text when a report has no IDs). For a matched comment only
// the fields that come from Navisworks are refreshed — the work done in
// Tabelin (status, closedAt, resolution, discipline, commenter, custom fields,
// after-photo) is kept. A before-photo is filled in only when it was missing.
// =====================================================================

export const SOURCE_FIELDS = ['commentRaw', 'viewpoint', 'commentDate', 'authorCode', 'cameraPosition', 'imageRef'];

export const recordKey = (r) =>
  r.commentId ? `id:${r.commentId}` : `vp:${r.viewpoint || ''}|${String(r.commentRaw ?? r.commentText ?? '').trim()}`;

const same = (a, b) => (a ?? '') === (b ?? '');

// What a newer report changes on an existing comment.
function sourcePatch(old, inc) {
  const patch = {};
  for (const f of SOURCE_FIELDS) if (!same(old[f], inc[f])) patch[f] = inc[f] ?? '';
  // The cleaned body follows the raw text when Navisworks changed it.
  if ('commentRaw' in patch) patch.commentText = inc.commentText ?? '';
  if (!old.imageData && inc.imageData) patch.imageData = inc.imageData;
  return patch;
}

// → { matched: [{ old, patch }], added: [incoming], missing: [existing], changed }
export function planMerge(existing, incoming) {
  const byKey = new Map();
  for (const r of existing) if (!byKey.has(recordKey(r))) byKey.set(recordKey(r), r);
  const seen = new Set();
  const matched = [];
  const added = [];
  for (const inc of incoming) {
    const k = recordKey(inc);
    const old = byKey.get(k);
    if (old && !seen.has(k)) {
      seen.add(k);
      matched.push({ old, patch: sourcePatch(old, inc) });
    } else {
      added.push(inc);
    }
  }
  const missing = existing.filter((r) => !seen.has(recordKey(r)));
  const changed = matched.filter((m) => Object.keys(m.patch).some((f) => f !== 'imageData')).length;
  return { matched, added, missing, changed };
}

// Offline: the merged record list. New comments get fresh IDs after the
// existing ones; missing ones are kept or moved to the done status.
export function applyMergeLocal(existing, plan, { missingAction, doneLabel }) {
  const patchById = new Map(plan.matched.map((m) => [m.old.ID, m.patch]));
  const missingIds = new Set(plan.missing.map((r) => r.ID));
  const now = new Date().toISOString();
  const merged = existing.map((r) => {
    const p = patchById.get(r.ID);
    if (p && Object.keys(p).length) return { ...r, ...p };
    if (missingAction === 'close' && missingIds.has(r.ID) && r.status !== doneLabel) return { ...r, status: doneLabel, closedAt: now };
    return r;
  });
  let next = existing.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0);
  return [...merged, ...plan.added.map((r) => ({ ...r, ID: (next += 1) }))];
}
