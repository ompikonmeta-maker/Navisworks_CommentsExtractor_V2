import { useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { openLabel } from '../lib/status.js';
import { Icon, Button } from './ui.jsx';

const SWATCHES = ['#bf0031', '#c2410c', '#9a6800', '#1f7a4d', '#0e7490', '#1768f7', '#7b3fe4', '#5b5f77'];

export default function StatusEditor() {
  const { records, remapStatus, notify } = useStore();
  const { settings, addStatus, updateStatus, removeStatus, moveStatus } = useSettings();
  const list = settings.statuses;
  const [newLabel, setNewLabel] = useState('');
  const countOf = (label) => records.filter((r) => r.status === label).length;

  const rename = (s, raw) => {
    const label = String(raw || '').trim();
    if (!label || label === s.label) return;
    if (list.some((x) => x.key !== s.key && x.label.toLowerCase() === label.toLowerCase())) {
      notify(`A status named “${label}” already exists.`, 'error');
      return;
    }
    remapStatus(s.label, label); // migrate records first…
    updateStatus(s.key, { label }); // …then the registry
  };

  const remove = (s) => {
    const n = countOf(s.label);
    const home = openLabel(list);
    if (n > 0 && !window.confirm(`Delete “${s.label}”? ${n} comment${n === 1 ? '' : 's'} will move to “${home}”.`)) return;
    if (n > 0) remapStatus(s.label, home);
    removeStatus(s.key);
  };

  const add = () => { const l = newLabel.trim(); if (l) { addStatus(l); setNewLabel(''); } };

  return (
    <>
      <p className="mb-4 text-xs text-on-surface-variant">The status buttons on every comment. <b>Open</b> and <b>Closed</b> are always here — you can rename and recolour them, but not remove them. Add or remove the ones in between. Colours are used everywhere a status appears.</p>

      <ul className="divide-y divide-outline-variant/50">
        {list.map((s, i) => {
          const middle = s.role === 'middle';
          const count = countOf(s.label);
          return (
            <li key={s.key} className="flex flex-wrap items-center gap-3 py-3">
              <span className="inline-flex w-6 flex-col items-center gap-0.5">
                <button onClick={() => moveStatus(s.key, -1)} disabled={!middle || i <= 1} className="grid h-4 w-5 place-items-center rounded text-on-surface-variant hover:bg-surface-container disabled:opacity-25" title="Move up"><Icon name="chevron_right" className="-rotate-90 text-[14px]" /></button>
                <button onClick={() => moveStatus(s.key, 1)} disabled={!middle || i >= list.length - 2} className="grid h-4 w-5 place-items-center rounded text-on-surface-variant hover:bg-surface-container disabled:opacity-25" title="Move down"><Icon name="chevron_right" className="rotate-90 text-[14px]" /></button>
              </span>

              <input
                key={s.key + s.label}
                defaultValue={s.label}
                onBlur={(e) => rename(s, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="w-40 rounded-control border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container focus:border-primary focus:bg-surface focus:outline-none"
                aria-label={`Rename ${s.label}`}
              />

              {!middle && <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">required</span>}
              <span className="text-xs text-on-surface-variant tabular-nums">{count} comment{count === 1 ? '' : 's'}</span>

              <div className="ml-auto flex items-center gap-1.5">
                {SWATCHES.map((c) => (
                  <button key={c} onClick={() => updateStatus(s.key, { color: c })} aria-label={`Set ${s.label} colour ${c}`} className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${s.color.toLowerCase() === c ? 'border-on-surface ring-2 ring-primary' : 'border-outline-variant'}`} style={{ background: c }} />
                ))}
                <label className="ml-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-outline-variant" title="Custom colour" style={{ background: `color-mix(in srgb, ${s.color} 20%, transparent)` }}>
                  <Icon name="image" className="text-[15px] text-on-surface-variant" />
                  <input type="color" value={s.color} onChange={(e) => updateStatus(s.key, { color: e.target.value })} className="sr-only" />
                </label>
                {middle && <button onClick={() => remove(s)} aria-label={`Remove ${s.label}`} className="rounded-full p-1 text-on-surface-variant hover:text-error" title="Remove status"><Icon name="close" className="text-[16px]" /></button>}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-on-surface-variant">
          Add a status
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Submitted" className="mt-1 block w-48 rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        </label>
        <Button variant="tonal" icon="upload_file" onClick={add} disabled={!newLabel.trim()}>Add</Button>
      </div>
      <p className="mt-3 text-xs text-on-surface-variant">New statuses are added between Open and Closed. Deleting a status moves its comments to Open.</p>
    </>
  );
}
