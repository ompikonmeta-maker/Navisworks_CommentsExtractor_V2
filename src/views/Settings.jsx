import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { DISCIPLINES } from '../lib/parser.js';
import { Icon, Card, Button, SegmentedButtons, DisciplineBadge } from '../components/ui.jsx';
import DetectionEditor from '../components/DetectionEditor.jsx';
import TemplateExportPanel from '../components/TemplateExportPanel.jsx';
import CustomFieldsEditor from '../components/CustomFieldsEditor.jsx';
import Reveal from '../components/Reveal.jsx';
import { setRevealDir } from '../lib/motion.js';

const APP_VERSION = '1.1.0';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const SWATCHES = ['#1768f7', '#1f7a4d', '#a9730a', '#b3261e', '#7b3fe4', '#0e7490', '#c026d3', '#475569'];

// Category rail — one focused panel each, so the page never scrolls endlessly.
// Ordered along the data journey: pick a Template → define Labels & fields →
// tune Detection → Appearance → About.
const SECTIONS = [
  { id: 'template', label: 'Template', icon: 'download' },
  { id: 'labels', label: 'Labels', icon: 'table_view' },
  { id: 'detection', label: 'Detection', icon: 'search' },
  { id: 'appearance', label: 'Appearance', icon: 'dark_mode' },
  { id: 'about', label: 'About', icon: 'info' },
];

export default function Settings() {
  const { records } = useStore();
  const { settings, setThemeMode, setDisciplineColor, addDiscipline, removeDiscipline, addCommenter, removeCommenter, resetSettings } = useSettings();
  const [section, setSection] = useState('template');
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
    <div className="canvas-w grid gap-4 md:grid-cols-[216px_1fr] md:items-start">
      {/* Category rail */}
      <nav className="flex gap-1 overflow-x-auto rounded-card border border-outline-variant/60 bg-surface-low p-2 md:sticky md:top-3 md:flex-col md:overflow-visible">
        {SECTIONS.map((s) => {
          const on = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => { setRevealDir(SECTIONS.findIndex((x) => x.id === s.id) < SECTIONS.findIndex((x) => x.id === section) ? -1 : 1); setSection(s.id); }}
              aria-current={on ? 'page' : undefined}
              className={`flex items-center gap-3 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              <Icon name={s.icon} className="shrink-0 text-[20px]" />
              <span>{s.label}</span>
              {s.soon && <span className="ml-auto text-[9.5px] font-bold uppercase tracking-wide opacity-70">soon</span>}
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
              {[['disciplines', 'Disciplines'], ['commenters', 'Commenters'], ['custom', 'Custom fields']].map(([k, label]) => (
                <button key={k} onClick={() => setLabelTab(k)} className={`px-4 py-1.5 font-medium ${labelTab === k ? 'bg-primary text-on-primary' : 'text-on-surface hover:bg-surface-container'}`}>{label}</button>
              ))}
            </div>

            <div key={labelTab} className="drawer-swap">
              {labelTab === 'custom' ? (
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
          <Card className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <div className="font-semibold">Tabelin v{APP_VERSION}</div>
              <p className="mt-0.5 text-xs text-on-surface-variant">Runs fully in your browser · settings saved locally · nothing uploaded.</p>
            </div>
            <Button variant="outlined" icon="restart_alt" onClick={() => { if (window.confirm('Restore all settings to defaults?')) resetSettings(); }}>Restore defaults</Button>
          </Card>
        )}
      </Reveal>
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
