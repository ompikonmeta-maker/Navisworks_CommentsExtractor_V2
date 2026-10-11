import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { DISCIPLINES } from '../lib/parser.js';
import { Icon, Card, Button, SegmentedButtons, DisciplineBadge, DISC_PALETTE, discColor, InfoTip } from '../components/ui.jsx';
import DetectionEditor from '../components/DetectionEditor.jsx';
import TemplateExportPanel from '../components/TemplateExportPanel.jsx';
import CustomFieldsEditor from '../components/CustomFieldsEditor.jsx';
import StatusEditor from '../components/StatusEditor.jsx';
import UsersEditor from '../components/UsersEditor.jsx';
import Reveal from '../components/Reveal.jsx';
import { setRevealDir } from '../lib/motion.js';
import { isReadOnly } from '../lib/server.js';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// The Settings sub-sections. These now live in the sidebar (nested under
// Settings): an accordion when the rail is expanded, a flyout when collapsed.
// Ordered along the data journey: pick a Template → define Labels & fields →
// tune Detection → Appearance (About lives in Help). Exported so App can drive the nav.
export const SECTIONS = [
  { id: 'template', label: 'Template', icon: 'download' },
  { id: 'labels', label: 'Labels', icon: 'table_view' },
  { id: 'detection', label: 'Detection', icon: 'search' },
  { id: 'appearance', label: 'Appearance', icon: 'dark_mode' },
];

export default function Settings({ section = 'template', setSection = () => {}, sections = SECTIONS, remoteUser = null }) {
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

  // Viewers on the server can look but not change shared settings; the theme
  // (this browser only) stays theirs.
  const readOnly = isReadOnly();
  const locked = readOnly && (section === 'labels' || section === 'detection');

  const addNewDisc = () => { const c = newDisc.trim().toUpperCase(); if (c) addDiscipline(c); setNewDisc(''); };
  const addNewComm = () => { const c = newComm.trim(); if (c) addCommenter(c); setNewComm(''); };

  return (
    <div className="canvas-w">
      {/* Section switcher — sidebar-nested on desktop; a compact horizontal
          strip here on phones, where the sidebar is a top bar with no room. */}
      <nav className="mb-4 flex gap-1 overflow-x-auto t-card rounded-card bg-surface p-2 md:hidden">
        {sections.map((s) => {
          const on = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => { setRevealDir(sections.findIndex((x) => x.id === s.id) < sections.findIndex((x) => x.id === section) ? -1 : 1); setSection(s.id); }}
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

      {locked && (
        <p className="mb-3 flex items-center gap-2 text-xs text-on-surface-variant">
          <Icon name="info" className="text-[16px]" /> View only. An admin can change these settings.
        </p>
      )}

      {/* Panel — card reveal re-plays on every section change */}
      <fieldset disabled={locked} className="contents">
      <Reveal className="space-y-6" deps={[section]}>
        {section === 'users' && (
          <Card className="p-6">
            <UsersEditor me={remoteUser} />
          </Card>
        )}

        {section === 'appearance' && (
          <Card className="p-6">
            <SectionTitle icon="dark_mode" title="Appearance" sub="How Tabelin looks. Saved to this browser." />
            <div className="max-w-md">
              <div className="mb-1 text-xs font-medium text-on-surface-variant">Theme</div>
              <SegmentedButtons aria-label="Theme" value={settings.themeMode} onChange={setThemeMode} options={THEME_OPTIONS} />
              <p className="mt-2 text-xs text-on-surface-variant">“System” follows your operating-system light/dark preference.</p>
            </div>
            {!readOnly && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant pt-4">
                <p className="text-xs text-on-surface-variant">Put labels, detection, template mapping and statuses back to the defaults.</p>
                <Button variant="text" icon="restart_alt" onClick={() => { if (window.confirm('Restore all settings to defaults?')) resetSettings(); }}>Restore defaults</Button>
              </div>
            )}
          </Card>
        )}

        {section === 'labels' && (
          <Card className="p-6">
            <SectionTitle icon="table_view" title="Labels" sub="Disciplines with their colours, the people who comment, statuses, and custom fields for the export."
              right={
                <div role="tablist" aria-label="Labels" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-[14px] bg-surface-container p-1 text-[13px]">
                  {[['disciplines', 'Disciplines'], ['commenters', 'Commenters'], ['status', 'Status'], ['custom', 'Custom fields']].map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={labelTab === k} onClick={() => setLabelTab(k)}
                      className={`shrink-0 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${labelTab === k ? 't-card bg-surface text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}>{label}</button>
                  ))}
                </div>
              } />

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
                      <input value={newDisc} onChange={(e) => setNewDisc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNewDisc()} placeholder="e.g. CIVIL" className="mt-1 block w-48 rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm uppercase text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
                    </label>
                    <Button variant="tonal" icon="add" onClick={addNewDisc} disabled={!newDisc.trim()}>Add</Button>
                  </div>
                  <ul className="divide-y divide-outline-variant/50">
                    {disciplines.map((d) => {
                      const color = settings.disciplineColors?.[d.name] || '';
                      return (
                        <li key={d.name} className="flex flex-wrap items-center gap-3 py-2">
                          <span className="w-28"><DisciplineBadge discipline={d.name} /></span>
                          <span className="text-xs text-on-surface-variant tabular-nums">{d.count}</span>
                          {d.custom && <span className="text-[12px] font-semibold text-primary">custom</span>}
                          <div className="ml-auto flex items-center gap-1">
                            <DiscColorButton name={d.name} color={color || discColor(d.name)} custom={!!color} onPick={(c) => setDisciplineColor(d.name, c)} />
                            {d.custom && d.count === 0 && <button onClick={() => removeDiscipline(d.name)} aria-label={`Remove ${d.name}`} className="t-press rounded-full p-1.5 text-on-surface-variant hover:bg-surface-container hover:text-error" title="Remove discipline"><Icon name="close" className="text-[16px]" /></button>}
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
                      <input value={newComm} onChange={(e) => setNewComm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNewComm()} placeholder="e.g. CPY_Dito" className="mt-1 block w-56 rounded-control border border-outline-variant bg-surface-low hover:border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
                    </label>
                    <Button variant="tonal" icon="upload_file" onClick={addNewComm} disabled={!newComm.trim()}>Add</Button>
                  </div>
                  {commenters.length ? (
                    <ul className="divide-y divide-outline-variant/50">
                      {commenters.map((c) => (
                        <li key={c.name} className="flex flex-wrap items-center gap-3 py-2.5">
                          <span className="inline-flex items-center gap-2 font-medium"><Icon name="person" className="text-[18px] text-on-surface-variant" /> {c.name}</span>
                          <span className="text-xs text-on-surface-variant tabular-nums">{c.count} comment{c.count === 1 ? '' : 's'}</span>
                          {c.custom && <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[12px] font-medium text-on-secondary-container">added</span>}
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

      </Reveal>
      </fieldset>
    </div>
  );
}

function SectionTitle({ icon, title, sub, right }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon name={icon} className="text-[20px] text-primary" /> {title}
        {sub && <InfoTip label={`About ${title}`}>{sub}</InfoTip>}
      </h2>
      {right}
    </div>
  );
}

// One swatch per discipline; the palette opens on demand instead of a row of
// dots on every line. "Custom" takes any colour; "Default" resets it.
function DiscColorButton({ name, color, custom, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (c) => { onPick(c); setOpen(false); };
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open} aria-label={`${name} colour`} title="Colour"
        className="t-press flex h-8 items-center gap-1 rounded-full pl-1.5 pr-1 text-on-surface-variant hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className="h-5 w-5 rounded-full" style={{ background: color }} />
        <Icon name="expand_more" className="text-[18px]" />
      </button>
      <div className={`t-pop absolute right-0 top-10 z-30 w-[188px] rounded-[18px] bg-surface p-3 ${open ? 'show' : ''}`}>
        <div className="grid grid-cols-5 gap-2">
          {DISC_PALETTE.map((c) => (
            <button key={c} type="button" onClick={() => pick(c)} aria-label={`Use ${c}`}
              className={`t-press h-7 w-7 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${color.toLowerCase() === c ? 'ring-2 ring-on-surface ring-offset-2 ring-offset-surface' : ''}`} style={{ background: c }} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-outline-variant pt-2">
          <label className="t-press inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container">
            <Icon name="palette" className="text-[16px]" />Custom
            <input type="color" value={color} onChange={(e) => onPick(e.target.value)} className="sr-only" />
          </label>
          {custom && <button type="button" onClick={() => pick(null)} className="t-press inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container"><Icon name="restart_alt" className="text-[15px]" />Default</button>}
        </div>
      </div>
    </div>
  );
}
