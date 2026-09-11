import { useMemo, useState } from 'react';
import { useStore } from '../store/store.jsx';
import { useSettings } from '../store/settings.jsx';
import { DISCIPLINES } from '../lib/parser.js';
import { Icon, Card, Button, SegmentedButtons, DisciplineBadge } from '../components/ui.jsx';

const APP_VERSION = '1.1.0';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// A sensible starter palette for colouring disciplines.
const SWATCHES = ['#1768f7', '#1f7a4d', '#a9730a', '#b3261e', '#7b3fe4', '#0e7490', '#c026d3', '#475569'];

export default function Settings() {
  const { records } = useStore();
  const { settings, setThemeMode, setDisciplineColor, addDiscipline, removeDiscipline, addCommenter, removeCommenter, resetSettings } = useSettings();
  const [newDisc, setNewDisc] = useState('');
  const [newComm, setNewComm] = useState('');

  // Commenters found in the data (auto-detected from comment text) unioned with
  // the user's own additions — custom ones flagged; count = comments assigned.
  const commenters = useMemo(() => {
    const inData = new Set();
    for (const r of records) if (r.commenter) inData.add(r.commenter);
    const names = new Set([...inData, ...settings.customCommenters]);
    return [...names].sort().map((name) => ({
      name,
      custom: !inData.has(name),
      count: records.filter((r) => r.commenter === name).length,
    }));
  }, [records, settings.customCommenters]);
  const addNewComm = () => {
    const clean = newComm.trim();
    if (clean) addCommenter(clean);
    setNewComm('');
  };

  // Everything colourable: the built-in disciplines, anything present in the
  // data, and the user's own additions — de-duplicated, custom ones flagged.
  const disciplines = useMemo(() => {
    const inData = new Set(records.map((r) => r.discipline));
    const builtin = new Set(DISCIPLINES);
    const names = new Set([...DISCIPLINES, ...inData, ...settings.customDisciplines]);
    return [...names].sort().map((name) => ({
      name,
      custom: !builtin.has(name),
      count: records.filter((r) => r.discipline === name).length,
    }));
  }, [records, settings.customDisciplines]);

  const addNew = () => {
    const clean = newDisc.trim().toUpperCase();
    if (clean) addDiscipline(clean);
    setNewDisc('');
  };

  return (
    <div className="canvas-w space-y-6">
      {/* Appearance */}
      <Card className="p-6">
        <SectionTitle icon="dark_mode" title="Appearance" sub="How Tabelin looks. Saved to this browser." />
        <div className="max-w-md">
          <div className="mb-1 text-xs font-medium text-on-surface-variant">Theme</div>
          <SegmentedButtons aria-label="Theme" value={settings.themeMode} onChange={setThemeMode} options={THEME_OPTIONS} />
          <p className="mt-2 text-xs text-on-surface-variant">
            “System” follows your operating-system light/dark preference.
          </p>
        </div>
      </Card>

      {/* Disciplines */}
      <Card className="p-6">
        <SectionTitle icon="table_view" title="Disciplines" sub="Assign a colour to each discipline, and add or remove your own. Colours apply to the badges across the app." />

        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-on-surface-variant">
            Add a discipline
            <input
              value={newDisc}
              onChange={(e) => setNewDisc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addNew()}
              placeholder="e.g. CIVIL"
              className="mt-1 block w-48 rounded-control border border-outline bg-surface-container px-3 py-2 text-sm uppercase text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <Button variant="tonal" icon="upload_file" onClick={addNew} disabled={!newDisc.trim()}>Add</Button>
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
                    <button
                      key={c}
                      onClick={() => setDisciplineColor(d.name, c)}
                      aria-label={`Set ${d.name} colour ${c}`}
                      className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${color.toLowerCase() === c ? 'border-on-surface ring-2 ring-primary' : 'border-outline-variant'}`}
                      style={{ background: c }}
                    />
                  ))}
                  <label className="ml-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-outline-variant" title="Custom colour" style={color ? { background: `color-mix(in srgb, ${color} 20%, transparent)` } : undefined}>
                    <Icon name="image" className="text-[15px] text-on-surface-variant" />
                    <input type="color" value={color || '#1768f7'} onChange={(e) => setDisciplineColor(d.name, e.target.value)} className="sr-only" />
                  </label>
                  {color && (
                    <button onClick={() => setDisciplineColor(d.name, null)} aria-label={`Clear ${d.name} colour`} className="rounded-full p-1 text-on-surface-variant hover:text-error" title="Reset to default colour">
                      <Icon name="restart_alt" className="text-[16px]" />
                    </button>
                  )}
                  {d.custom && d.count === 0 && (
                    <button onClick={() => removeDiscipline(d.name)} aria-label={`Remove ${d.name}`} className="rounded-full p-1 text-on-surface-variant hover:text-error" title="Remove discipline">
                      <Icon name="close" className="text-[16px]" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-on-surface-variant">A custom discipline can be removed only while no comment uses it.</p>
      </Card>

      {/* Commenters */}
      <Card className="p-6">
        <SectionTitle icon="person" title="Commenters" sub="The people who wrote the comments — auto-detected from the “Name:” prefix in the comment text. Add or remove names here; assign one to any comment in the detail drawer." />

        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-on-surface-variant">
            Add a commenter
            <input
              value={newComm}
              onChange={(e) => setNewComm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addNewComm()}
              placeholder="e.g. CPY_Dito"
              className="mt-1 block w-56 rounded-control border border-outline bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <Button variant="tonal" icon="upload_file" onClick={addNewComm} disabled={!newComm.trim()}>Add</Button>
        </div>

        {commenters.length ? (
          <ul className="divide-y divide-outline-variant/50">
            {commenters.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="inline-flex items-center gap-2 font-medium">
                  <Icon name="person" className="text-[18px] text-on-surface-variant" /> {c.name}
                </span>
                <span className="text-xs text-on-surface-variant tabular-nums">{c.count} comment{c.count === 1 ? '' : 's'}</span>
                {c.custom && <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-medium text-on-secondary-container">added</span>}
                {c.custom && c.count === 0 && (
                  <button onClick={() => removeCommenter(c.name)} aria-label={`Remove ${c.name}`} className="ml-auto rounded-full p-1 text-on-surface-variant hover:text-error" title="Remove commenter">
                    <Icon name="close" className="text-[16px]" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-on-surface-variant">No commenters detected yet.</p>
        )}
        <p className="mt-3 text-xs text-on-surface-variant">An added commenter can be removed only while no comment uses it.</p>
      </Card>

      {/* About / reset */}
      <Card className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <div className="font-semibold">Tabelin v{APP_VERSION}</div>
          <p className="mt-0.5 text-xs text-on-surface-variant">Runs fully in your browser · settings saved locally · nothing uploaded.</p>
        </div>
        <Button
          variant="outlined"
          icon="restart_alt"
          onClick={() => { if (window.confirm('Restore all settings to defaults?')) resetSettings(); }}
        >
          Restore defaults
        </Button>
      </Card>
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
