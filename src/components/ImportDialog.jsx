import { Dialog, Icon, Button } from './ui.jsx';

// Shown when a report is imported into a review that already has comments:
// what the new report changes, before anything is saved.
export default function ImportDialog({ state, onChange, onCancel, onConfirm, busy }) {
  const plan = state?.plan;
  const rows = plan ? [
    {
      icon: 'check_circle', tone: 'var(--tabelin-good)', n: plan.matched.length, title: 'Already in this review',
      note: `Status, photos and resolutions are kept.${plan.changed ? ` ${plan.changed} have new text from Navisworks.` : ''}`,
    },
    { icon: 'add', tone: 'var(--md-sys-color-primary)', n: plan.added.length, title: 'New comments', note: 'Added as Open.' },
    { icon: 'remove', tone: 'var(--tabelin-warn)', n: plan.missing.length, title: 'No longer in the report', missing: true },
  ] : [];
  return (
    <Dialog open={!!state} onClose={busy ? undefined : onCancel} labelledBy="imp-title" width={560}>
      {plan && (
        <>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-primary-container text-on-primary-container"><Icon name="restart_alt" className="text-[22px]" /></span>
            <div className="min-w-0">
              <h2 id="imp-title" className="text-lg font-semibold">Update from a new report</h2>
              <p className="truncate text-xs text-on-surface-variant">{state.fileName} · matched by comment ID</p>
            </div>
          </div>
          <div className="mt-4">
            {rows.map((r) => (
              <div key={r.title} className="grid grid-cols-[36px_1fr_auto] items-center gap-3 border-t border-outline-variant py-3">
                <span className="grid h-9 w-9 place-items-center rounded-[12px]" style={{ background: `color-mix(in srgb, ${r.tone} 14%, transparent)`, color: r.tone }}><Icon name={r.icon} className="text-[19px]" /></span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{r.title}</div>
                  {r.missing ? (
                    r.n > 0 ? (
                      <div role="radiogroup" aria-label="Comments no longer in the report" className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                        {[['keep', 'Keep as they are'], ['close', 'Mark as closed']].map(([v, l]) => (
                          <label key={v} className="inline-flex cursor-pointer items-center gap-2">
                            <input type="radio" name="imp-missing" value={v} checked={state.missingAction === v} onChange={() => onChange({ ...state, missingAction: v })} className="accent-[var(--md-sys-color-primary)]" />{l}
                          </label>
                        ))}
                      </div>
                    ) : <div className="text-xs text-on-surface-variant">Every comment is still in the report.</div>
                  ) : <div className="text-xs text-on-surface-variant">{r.note}</div>}
                </div>
                <b className="text-xl tabular-nums">{r.n}</b>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="text" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button variant="filled" onClick={onConfirm} disabled={busy} data-autofocus>{busy ? 'Updating…' : 'Update review'}</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
