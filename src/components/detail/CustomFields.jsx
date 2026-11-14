// Custom per-comment fields for the template export — driven by the Export
// mapping's attr fields (label, type, options, default). Blank falls back to
// the field's default at export time.
import { attrType } from '../../lib/templateExcel.js';
import { Select } from '../ui.jsx';

export default function CustomFields({ attrs, extra, onChange }) {
  if (!attrs.length) return null;
  return (
    <details className="rounded-control border border-outline-variant bg-surface-container/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-on-surface-variant">Custom fields (template export)</summary>
      <div className="space-y-3 px-3 pb-3">
        {attrs.map((a) => {
          const key = a.source.key;
          const type = attrType(a);
          const val = extra?.[key];
          const setExtra = (v) => onChange({ ...(extra || {}), [key]: v });
          const inputCls = 'mt-1 w-full rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
          if (type === 'checkbox') {
            const arr = Array.isArray(val) ? val : [];
            const toggle = (opt) => setExtra(arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt]);
            return (
              <div key={a.id} className="text-xs font-medium text-on-surface-variant">
                {a.label}
                <div className="mt-1 flex flex-col gap-1.5">
                  {(a.options || []).length ? a.options.map((opt) => (
                    <label key={opt} className="flex items-center gap-2 font-normal text-on-surface">
                      <input type="checkbox" checked={arr.includes(opt)} onChange={() => toggle(opt)} /> {opt}
                    </label>
                  )) : <span className="font-normal italic">No options set.</span>}
                </div>
              </div>
            );
          }
          if (type === 'select') {
            return (
              <div key={a.id} className="text-xs font-medium text-on-surface-variant">
                {a.label}
                <Select className="mt-1 w-full" aria-label={a.label} value={val ?? ''} onChange={setExtra}
                  options={[{ value: '', label: '— none —' }, ...(a.options || []).map((o) => ({ value: o, label: o }))]} />
              </div>
            );
          }
          return (
            <label key={a.id} className="block text-xs font-medium text-on-surface-variant">
              {a.label}
              {type === 'multiline' ? (
                <textarea rows={2} value={val ?? ''} onChange={(e) => setExtra(e.target.value)} placeholder={a.default || ''} className={`${inputCls} resize-y`} />
              ) : (
                <input value={val ?? ''} onChange={(e) => setExtra(e.target.value)} placeholder={a.default || ''} className={inputCls} />
              )}
            </label>
          );
        })}
      </div>
    </details>
  );
}
