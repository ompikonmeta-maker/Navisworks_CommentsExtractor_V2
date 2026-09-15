import { useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { Icon, Button, InfoTip } from './ui.jsx';
import { CUSTOM_PREFIX, attrType } from '../lib/templateExcel.js';

const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
const quiet = 'rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-on-surface transition-colors hover:bg-surface-container focus:border-primary focus:bg-surface focus:outline-none';

const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'multiline', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkboxes' },
];

// Compact MD3 segmented control for the field type.
function TypeSeg({ value, onChange }) {
  return (
    <span className="inline-flex rounded-full border border-outline-variant bg-surface-low p-0.5">
      {TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          aria-pressed={value === t.value}
          className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${value === t.value ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}
        >
          {t.label}
        </button>
      ))}
    </span>
  );
}

// Chips of options with add / remove, for Dropdown and Checkboxes.
function OptionsEditor({ options, onChange, pick }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !options.includes(v)) onChange([...options, v]); setDraft(''); };
  return (
    <div className="mt-2 rounded-xl bg-surface-low p-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Options ({pick})</div>
      <div className="flex flex-wrap items-center gap-2">
        {options.map((o) => (
          <span key={o} className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface py-1 pl-3 pr-1.5 text-xs">
            {o}
            <button onClick={() => onChange(options.filter((x) => x !== o))} className="grid h-4 w-4 place-items-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error" aria-label={`Remove ${o}`}><Icon name="close" className="text-[13px]" /></button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="+ add option"
          className="min-w-[110px] flex-1 rounded-full border border-dashed border-outline-variant bg-transparent px-3 py-1 text-xs text-on-surface placeholder:text-primary focus:border-primary focus:outline-none"
        />
      </div>
    </div>
  );
}

export default function CustomFieldsEditor() {
  const { renameAttr } = useStore();
  const { settings, setTemplateExport } = useSettings();
  const cfg = settings.templateExport;
  const fields = cfg.logSheet.fields;
  const attrList = fields.map((f, i) => ({ f, i })).filter((x) => x.f.source.kind === 'attr');
  const blankCount = fields.filter((f) => f.source.kind === 'blank').length;

  const patchFields = (fn) => setTemplateExport((c) => ({ ...c, logSheet: { ...c.logSheet, fields: fn(c.logSheet.fields) } }));
  const setField = (i, patch) => patchFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const removeField = (i) => patchFields((fs) => fs.filter((_, j) => j !== i));
  const addField = () => patchFields((fs) => [...fs, { id: `f${Date.now()}`, label: 'New field', source: { kind: 'attr', key: `${CUSTOM_PREFIX}field_${fs.length + 1}` }, by: 'header', value: '', ftype: 'text', default: '' }]);
  const pullFromTemplate = () => patchFields((fs) => fs.map((f) => (f.source.kind === 'blank' ? { ...f, source: { kind: 'attr', key: f.suggestKey || CUSTOM_PREFIX + slug(f.label) }, ftype: 'text', default: '' } : f)));
  const commitKey = (i, oldKey, raw) => {
    const newKey = slug(raw);
    if (!newKey || newKey === oldKey) return;
    patchFields((fs) => fs.map((f, j) => (j === i ? { ...f, source: { ...f.source, key: newKey } } : f)));
    renameAttr(oldKey, newKey);
  };
  const changeType = (i, ftype) => setField(i, { ftype, ...(ftype === 'select' || ftype === 'checkbox' ? { options: fields[i].options || [] } : {}) });

  return (
    <>
      <p className="mb-3 text-xs text-on-surface-variant">Extra fields that aren’t in the Navisworks report — you fill them per comment in the detail drawer, and they export into your template columns. Most come from your template; add more by hand if needed.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="tonal" icon="download" onClick={pullFromTemplate} disabled={blankCount === 0}>Pull from template{blankCount > 0 ? ` (${blankCount})` : ''}</Button>
        <Button variant="text" icon="upload_file" onClick={addField}>Add field</Button>
        {blankCount === 0 && attrList.length === 0 && <span className="text-[11px] text-on-surface-variant">Import a template in the Template tab to pull its columns.</span>}
      </div>

      {attrList.length ? (
        <div>
          {attrList.map(({ f, i }) => {
            const type = attrType(f);
            const hasOptions = type === 'select' || type === 'checkbox';
            return (
              <div key={f.id} className="border-t border-outline-variant/50 py-3 first:border-t-0">
                <div className="flex flex-wrap items-center gap-2">
                  <input key={f.id + f.source.key} defaultValue={f.source.key} onBlur={(e) => commitKey(i, f.source.key, e.target.value)} className={`${quiet} w-[170px] font-mono text-[12px] text-on-surface-variant`} aria-label="Field key" />
                  <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} className={`${quiet} w-[150px] font-medium`} aria-label="Field label" />
                  <TypeSeg value={type} onChange={(v) => changeType(i, v)} />
                  <button onClick={() => removeField(i)} className="ml-auto grid h-7 w-7 place-items-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error" title="Remove field"><Icon name="close" className="text-[16px]" /></button>
                </div>

                {hasOptions ? (
                  <div className="ml-1">
                    <OptionsEditor options={f.options || []} onChange={(options) => setField(i, { options })} pick={type === 'checkbox' ? 'tick any' : 'pick one'} />
                    {type === 'checkbox' && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-1 text-xs text-on-surface-variant">
                        <span className="inline-flex items-center gap-1">When more than one is ticked, write them as <InfoTip label="About checkbox output"><b>Comma</b> puts them on one line (Photo, Drawing). <b>Numbered list</b> stacks them in the cell (1. Photo / 2. Drawing).</InfoTip></span>
                        <span className="inline-flex rounded-full border border-outline-variant bg-surface-low p-0.5">
                          {[['comma', 'Comma'], ['list', 'Numbered list']].map(([v, label]) => (
                            <button key={v} onClick={() => setField(i, { join: v })} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${(f.join || 'comma') === v ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>{label}</button>
                          ))}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="ml-1 mt-2 flex items-center gap-2 pl-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-on-surface-variant">Default <InfoTip label="About default">Starting value for every comment. Leave empty to fill each one by hand.</InfoTip></span>
                    <input value={f.default || ''} onChange={(e) => setField(i, { default: e.target.value })} placeholder="(empty)" className={`${quiet} w-full max-w-md flex-1 text-[12px]`} aria-label="Default value" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-on-surface-variant">No custom fields yet. Import a template in the Template tab and Pull from template, or Add one by hand.</p>
      )}
      <p className="mt-3 text-xs text-on-surface-variant">These appear in the comment drawer. The template columns they fill are set under <span className="font-medium">Template › Column mapping</span>.</p>
    </>
  );
}
