import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { DISCIPLINES } from '../lib/parser.js';
import { Icon, Card, Button, SegmentedButtons, DisciplineBadge } from '../components/ui.jsx';
import DetectionEditor from '../components/DetectionEditor.jsx';
import TemplateExportPanel from '../components/TemplateExportPanel.jsx';
import CustomFieldsEditor from '../components/CustomFieldsEditor.jsx';
import StatusEditor from '../components/StatusEditor.jsx';
import Reveal from '../components/Reveal.jsx';
import { setRevealDir } from '../lib/motion.js';

const APP_VERSION = '1.1.0';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const SWATCHES = ['#1768f7', '#1f7a4d', '#a9730a', '#b3261e', '#7b3fe4', '#0e7490', '#c026d3', '#475569'];

// The Settings sub-sections. These now live in the sidebar (nested under
// Settings): an accordion when the rail is expanded, a flyout when collapsed.
// Ordered along the data journey: pick a Template → define Labels & fields →
// tune Detection → Appearance → About. Exported so App can drive the nav.
export const SECTIONS = [
  { id: 'template', label: 'Template', icon: 'download' },
  { id: 'labels', label: 'Labels', icon: 'table_view' },
  { id: 'detection', label: 'Detection', icon: 'search' },
  { id: 'appearance', label: 'Appearance', icon: 'dark_mode' },
  { id: 'about', label: 'About', icon: 'info' },
];

export default function Settings({ section = 'template', setSection = () => {} }) {
  const { records } = useStore();
  const { settings, setThemeMode, setDisciplineColor, addDiscipline, removeDiscipline, addCommenter, removeCommenter, resetSettings } = useSettings();
  const [labelTab, setLabelTab] = useState('disciplines');
  const [newDisc, setNewDisc] = useState('');
  const [newComm, setNewComm] = useState('');

  const commenters = useMemo(() => {
    const inData = new Set();
    for (const r of records) if (r.commenter) inData.add(r.commenter);
    const names = new Set([...inData, ...settings.customCommenters]);
    return [...names].sort().map((name) => ({ name, custom: !inData.has(name), count: records.filter((r) => r.commenter === name).length }));
  }, [records, settings.customCommenters]);

  const disciplines = useMemo(() => {
    const inData = new Set(records.map((r) => r.discipline));
    const builtin = new Set(DISCIPLINES);
    const names = new Set([...DISCIPLINES, ...inData, ...settings.customDisciplines]);
    return [...names].sort().map((name) => ({ name, custom: !builtin.has(name), count: records.filter((r) => r.discipline === name).length }));
  }, [records, settings.customDisciplines]);

  const addNewDisc = () => { const c = newDisc.trim().toUpperCase(); if (c) addDiscipline(c); setNewDisc(''); };
  const addNewComm = () => { const c = newComm.trim(); if (c) addCommenter(c); setNewComm(''); };

  return (
    <div className="canvas-w">
      {/* Section switcher — sidebar-nested on desktop; a compact horizontal
          strip here on phones, where the sidebar is a top bar with no room. */}
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-card border border-outline-variant/60 bg-surface-low p-2 md:hidden">
        {SECTIONS.map((s) => {
          const on = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => { setRevealDir(SECTIONS.findIndex((x) => x.id === s.id) < SECTIONS.findIndex((x) => x.id === section) ? -1 : 1); setSection(s.id); }}
              aria-current={on ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl px-3.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              <Icon name={s.icon} className="shrink-0 text-[19px]" />
              <span>{s.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Panel — card reveal re-plays on every section change */}
      <Reveal className="space-y-6" deps={[section]}>
        {section === 'appearance' && (
          <Card className="p-6">
            <SectionTitle icon="dark_mode" title="Appearance" sub="How Tabelin looks. Saved to this browser." />
            <div className="max-w-md">
              <div className="mb-1 text-xs font-medium text-on-surface-variant">Theme</div>
              <SegmentedButtons aria-label="Theme" value={settings.themeMode} onChange={setThemeMode} options={THEME_OPTIONS} />
              <p className="mt-2 text-xs text-on-surface-variant">“System” follows your operating-system light/dark preference.</p>
            </div>
          </Card>
        )}

        {section === 'labels' && (
          <Card className="p-6">
            <SectionTitle icon="table_view" title="Labels" sub="Your taxonomy — disciplines (with colours), the people who comment, and custom fields for export." />
            <div className="mb-4 inline-flex overflow-hidden rounded-full border border-outline text-sm">
              {[['disciplines', 'Disciplines'], ['commenters', 'Commenters'], ['status', 'Status'], ['custom', 'Custom fields']].map(([k, label]) => (
                <button key={k} onClick={() => setLabelTab(k)} className={`px-4 py-1.5 font-medium ${labelTab === k ? 'bg-primary text-on-primary' : 'text-on-surface hover:bg-surface-container'}`}>{label}</button>
              ))}
            </div>

            <div key={labelTab} className="drawer-swap">
              {labelTab === 'status' ? (
                <StatusEditor />
              ) : labelTab === 'custom' ? (
                <CustomFieldsEditor />
              ) : labelTab === 'disciplines' ? (
                <>
                  <div className="mb-4 flex flex-wrap items-end gap-2">
                    <label className="text-xs font-medium text-on-surface-variant">
                      Add a discipline
                      <input value={newDisc} onChange={(e) => setNewDisc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNewDisc()} placeholder="e.g. CIVIL" className="mt-1 block w-48 rounded-control border border-outline bg-surface-container px-3 py-2 text-sm uppercase text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
                    </label>
                    <Button variant="tonal" icon="upload_file" onClick={addNewDisc} disabled={!newDisc.trim()}>Add</Button>
                  </div>
                  <ul className="divide-y divide-outline-variant/50">
                    {disciplines.map((d) => {
                      const color = settings.disciplineColors?.[d.name] || '';
                      return (
                        <li key={d.name} className="flex flex-wrap items-center gap-3 py-2.5">
                          <DisciplineBadge discipline={d.name} />
                          <span className="text-xs text-on-surface-variant tabular-nums">{d.count} comment{d.count === 1 ? '' : 's'}</span>
                          {d.custom && <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-medium text-on-secondary-container">custom</span>}
                          <div className="ml-auto flex items-center gap-1.5">
                            {SWATCHES.map((c) => (
                              <button key={c} onClick={() => setDisciplineColor(d.name, c)} aria-label={`Set ${d.name} colour ${c}`} className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${color.toLowerCase() === c ? 'border-on-surface ring-2 ring-primary' : 'border-outline-variant'}`} style={{ background: c }} />
                            ))}
                            <label className="ml-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-outline-variant" title="Custom colour" style={color ? { background: `color-mix(in srgb, ${color} 20%, transparent)` } : undefined}>
                              <Icon name="image" className="text-[15px] text-on-surface-variant" />
                              <input type="color" value={color || '#1768f7'} onChange={(e) => setDisciplineColor(d.name, e.target.value)} className="sr-only" />
                            </label>
                            {color && <button onClick={() => setDisciplineColor(d.name, null)} aria-label={`Clear ${d.name} colour`} className="rounded-full p-1 text-on-surface-variant hover:text-error" title="Reset to default colour"><Icon name="restart_alt" className="text-[16px]" /></button>}
                            {d.custom && d.count === 0 && <button onClick={() => removeDiscipline(d.name)} aria-label={`Remove ${d.name}`} className="rounded-full p-1 text-on-surface-variant hover:text-error" title="Remove discipline"><Icon name="close" className="text-[16px]" /></button>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-on-surface-variant">A custom discipline can be removed only while no comment uses it.</p>
                </>
              ) : (
                <>
                  <p className="mb-3 text-xs text-on-surface-variant">People who wrote the comments — auto-detected from the “Name:” prefix. Add or remove names; assign one to any comment in the detail drawer.</p>
                  <div className="mb-4 flex flex-wrap items-end gap-2">
                    <label className="text-xs font-medium text-on-surface-variant">
                      Add a commenter
                      <input value={newComm} onChange={(e) => setNewComm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNewComm()} placeholder="e.g. CPY_Dito" className="mt-1 block w-56 rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
                    </label>
                    <Button variant="tonal" icon="upload_file" onClick={addNewComm} disabled={!newComm.trim()}>Add</Button>
                  </div>
                  {commenters.length ? (
                    <ul className="divide-y divide-outline-variant/50">
                      {commenters.map((c) => (
                        <li key={c.name} className="flex flex-wrap items-center gap-3 py-2.5">
                          <span className="inline-flex items-center gap-2 font-medium"><Icon name="person" className="text-[18px] text-on-surface-variant" /> {c.name}</span>
                          <span className="text-xs text-on-surface-variant tabular-nums">{c.count} comment{c.count === 1 ? '' : 's'}</span>
                          {c.custom && <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-medium text-on-secondary-container">added</span>}
                          {c.custom && c.count === 0 && <button onClick={() => removeCommenter(c.name)} aria-label={`Remove ${c.name}`} className="ml-auto rounded-full p-1 text-on-surface-variant hover:text-error" title="Remove commenter"><Icon name="close" className="text-[16px]" /></button>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-6 text-center text-sm text-on-surface-variant">No commenters detected yet.</p>
                  )}
                  <p className="mt-3 text-xs text-on-surface-variant">An added commenter can be removed only while no comment uses it.</p>
                </>
              )}
            </div>
          </Card>
        )}

        {section === 'detection' && (
          <Card className="p-6">
            <SectionTitle icon="search" title="Detection rules" sub="How commenter and discipline are extracted from the comment text — user-editable so a future project with a different format needs no code change. Preview updates live; Apply writes to the current data." />
            <DetectionEditor />
          </Card>
        )}

        {section === 'template' && (
          <Card className="p-6">
            <SectionTitle icon="download" title="Template" sub="Fill your Excel template from the comment data — a log sheet plus one detail sheet per Tag View, with before/after photos. The template’s layout, logos and styling stay exactly as they are." />
            <TemplateExportPanel />
          </Card>
        )}

        {section === 'about' && (
          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <div className="font-semibold">Tabelin v{APP_VERSION}</div>
                <p className="mt-0.5 text-xs text-on-surface-variant">Runs fully in your browser · settings saved locally · nothing uploaded.</p>
              </div>
              <Button variant="outlined" icon="restart_alt" onClick={() => { if (window.confirm('Restore all settings to defaults?')) resetSettings(); }}>Restore defaults</Button>
            </Card>

            <Card className="p-6">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="table_view" className="text-[18px] text-primary" /> Where the data comes from
              </h3>
              <p className="mt-1 text-xs text-on-surface-variant">
                A Navisworks report only stores a few things per comment. Everything else is worked out
                or added by Tabelin. Here is what each field is.
              </p>

              <FieldGroup
                title="Straight from the HTML"
                sub="The real fields Navisworks writes into the report."
                rows={[
                  ['Viewpoint', 'The viewpoint name (the tag view title).'],
                  ['Image ref', 'The picture file name for that viewpoint.'],
                  ['Camera position', 'The saved camera position.'],
                  ['Comment ID', 'The comment number inside the viewpoint.'],
                  ['Author code', 'The Navisworks “User” code (the “Author” column).'],
                  ['Comment text (raw)', 'The original comment, still with its “Name:” prefix.'],
                  ['Status (raw)', 'The status word as written, e.g. “New”.'],
                  ['Comment date', 'The date shown at the end of the comment.'],
                ]}
              />

              <FieldGroup
                title="Worked out from the text"
                sub="Not real fields — Tabelin reads these out of the comment text. You can tune how in Detection."
                rows={[
                  ['Comment text', 'The clean comment, with the “Name:” prefix removed.'],
                  ['Commenter', 'The person who wrote it, read from the “Name:” at the start.'],
                  ['Discipline', 'Guessed from the text. Navisworks has no discipline field.'],
                  ['Status', 'The raw status tidied up into Open / In Review / Closed.'],
                ]}
              />

              <FieldGroup
                title="Added by Tabelin"
                sub="These are not in the report at all — they are yours to fill in."
                rows={[
                  ['Resolution', 'Empty at first; you type it in.'],
                  ['Closed at', 'The report has no close date. It is stamped when you set a comment to Closed here.'],
                  ['Before / after photos', 'The before image is linked from the companion files; the after photo you upload in the drawer.'],
                  ['Custom fields', 'Your own extra fields (evidence, remarks, …) added for the template export.'],
                  ['Source', 'The name of the HTML file the comment came from.'],
                ]}
              />

              <p className="mt-4 text-xs text-on-surface-variant">
                Any of these can be sent to a column in your Excel template from the <strong>Template</strong> page.
              </p>
            </Card>
          </div>
        )}
      </Reveal>
    </div>
  );
}

function FieldGroup({ title, sub, rows }) {
  return (
    <div className="mt-4">
      <div className="text-xs font-semibold text-on-surface">{title}</div>
      {sub && <p className="mt-0.5 text-[11px] text-on-surface-variant">{sub}</p>}
      <dl className="mt-2 divide-y divide-outline-variant/40 rounded-control bg-surface-variant/30 px-3">
        {rows.map(([name, desc]) => (
          <div key={name} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
            <dt className="shrink-0 text-xs font-medium text-on-surface sm:w-40">{name}</dt>
            <dd className="text-xs text-on-surface-variant">{desc}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SectionTitle({ icon, title, sub }) {
  return (
    <div className="mb-5">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon name={icon} className="text-[20px] text-primary" /> {title}
      </h2>
      {sub && <p className="mt-1 text-xs text-on-surface-variant">{sub}</p>}
    </div>
  );
}
