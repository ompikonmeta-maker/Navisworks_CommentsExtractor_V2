import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { Icon, Button, InfoTip } from './ui.jsx';
import { CUSTOM_PREFIX } from '../lib/templateExcel.js';

const inputCls =
  'rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';

// Custom fields are stored as the attr-kind rows of the export mapping, so this
// editor, the comment drawer and the Template mapping all share one registry.
// "Pull from template" turns the template columns that have no data field yet
// into custom fields; "Add field" makes one by hand.
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
  const addField = () => patchFields((fs) => [...fs, { id: `f${Date.now()}`, label: 'New field', source: { kind: 'attr', key: `${CUSTOM_PREFIX}field_${fs.length + 1}` }, by: 'header', value: '', default: '' }]);
  const pullFromTemplate = () => patchFields((fs) => fs.map((f) => (f.source.kind === 'blank' ? { ...f, source: { kind: 'attr', key: f.suggestKey || CUSTOM_PREFIX + slug(f.label) }, default: '' } : f)));
  const commitKey = (i, oldKey, raw) => {
    const newKey = slug(raw);
    if (!newKey || newKey === oldKey) return;
    patchFields((fs) => fs.map((f, j) => (j === i ? { ...f, source: { ...f.source, key: newKey } } : f)));
    renameAttr(oldKey, newKey);
  };

  return (
    <>
      <p className="mb-3 text-xs text-on-surface-variant">Extra fields that aren’t in the Navisworks report — you fill them per comment in the detail drawer, and they export into your template columns. Most come from your template; add more by hand if needed.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="tonal" icon="download" onClick={pullFromTemplate} disabled={blankCount === 0}>Pull from template{blankCount > 0 ? ` (${blankCount})` : ''}</Button>
        <Button variant="text" icon="upload_file" onClick={addField}>Add field</Button>
        {blankCount === 0 && attrList.length === 0 && <span className="text-[11px] text-on-surface-variant">Import a template in the Template tab to pull its columns.</span>}
      </div>

      {attrList.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-on-surface-variant">
                <th className="pb-1.5 pr-3 font-semibold">Key</th>
                <th className="pb-1.5 pr-3 font-semibold">Label</th>
                <th className="pb-1.5 pr-3 font-semibold"><span className="inline-flex items-center gap-1">Default <InfoTip label="About default">Starting value for every comment. Leave empty to fill each one by hand.</InfoTip></span></th>
                <th className="pb-1.5 pr-3 font-semibold"><span className="inline-flex items-center gap-1">Multi-line <InfoTip label="About multi-line">Makes the drawer input a bigger, multi-line box for long text.</InfoTip></span></th>
                <th className="pb-1.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {attrList.map(({ f, i }) => (
                <tr key={f.id} className="border-t border-outline-variant/50">
                  <td className="py-1.5 pr-3"><input key={f.id + f.source.key} className={`${inputCls} w-[150px] py-1 font-mono`} defaultValue={f.source.key} onBlur={(e) => commitKey(i, f.source.key, e.target.value)} /></td>
                  <td className="py-1.5 pr-3"><input className={`${inputCls} w-[150px] py-1`} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} /></td>
                  <td className="py-1.5 pr-3"><input className={`${inputCls} w-full py-1`} value={f.default || ''} onChange={(e) => setField(i, { default: e.target.value })} placeholder="(empty)" /></td>
                  <td className="py-1.5 pr-3"><input type="checkbox" checked={!!f.multiline} onChange={(e) => setField(i, { multiline: e.target.checked })} /></td>
                  <td className="py-1.5"><button onClick={() => removeField(i)} className="grid h-7 w-7 place-items-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error" title="Remove field"><Icon name="close" className="text-[16px]" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-on-surface-variant">No custom fields yet. Import a template in the Template tab and Pull from template, or Add one by hand.</p>
      )}
      <p className="mt-3 text-xs text-on-surface-variant">These appear in the comment drawer. The template columns they fill are set under <span className="font-medium">Template › Column mapping</span>.</p>
    </>
  );
}
