// The offline data source: one person, records autosaved in this browser
// (IndexedDB) and optionally mirrored to a session folder they pick. Nothing
// leaves the machine. Wraps lib/persist.js.
//
// Every data source has these members (serverSource.js has the same):
//   kind                 'local' | 'server' — only for telling the user how the app runs
//   caps                 what this source allows / offers (see below)
//   place, user          the open Project › Review and the signed-in user (null offline)
//   scopeKey             a short key for per-review browser preferences
//   loadRecords()        → { records, source, stats } to start with
//   persistSession(records, source)  autosave (offline only; no-op on the server)
//   resetToSample()      → { records, source, stats } (offline only)
//   folder               session-folder helpers, or null
//   saveRecord(id, patch, version)   → { version }; throws code 409 + record on a conflict
//   saveMany(updates)    → { versions, conflicts }
//   addRecord(rec, existing)          → the new record with its id
//   deleteRecords(ids)
//   changes(since)       → { records, ids, next } or null when there is no refresh
//   history(id)          → history rows, newest first ([] when there is none)
//   editStamp()          → { changedBy, changedAt } for a local edit, or null
//   isFreshImport(records, meta)      → true when an import simply replaces the list
//   importMerge(plan, opts, current)  → { records, source, undo: () => { records, source } }
//   imports()            → summaries of past imports, newest first (lib/importSummary.js)
//   recordImport(summary) / markImportUndone(id)   keep that log
//   loadTemplate() / saveTemplate(name, bytes) / clearTemplate() / hasTemplate()
//   loadSharedSettings() → { project, review } config maps, or null when not shared
//   saveSharedSetting(scope, key, value)   scope 'project' | 'review'
//   teamSize()           → colleagues besides the user (0 offline)
//   trash()              → { reviews, records, days } of what can still be restored (empty offline)
//   restore(pick) / purge(pick)   pick = { reviews: [ids], records: [ids] }
//   restoreRecord(id)    → the comment back from the Trash (for an Undo), or null
//   backupUrl            → where an admin downloads a backup, or null
//
// caps: canAdmin (import, add/delete comments, settings, template), canReview
// (edit comments), hasHistory, shared (others see the same data), autosave,
// sessionFolder, sampleReset, refresh (other people's changes arrive),
// sharedSettings, manageUsers, trash (deletes can be restored: the Trash
// screen), backup (an admin can download one).
import { loadSampleData } from '../lib/sample.js';
import { applyMergeLocal } from '../lib/merge.js';
import { addToLog, markUndone } from '../lib/importSummary.js';
import {
  FS_SUPPORTED, requestPersistentStorage, loadSessionLocal, saveSessionLocal, clearSessionLocal,
  pickFolder, getStoredFolder, folderPermission, writeSessionToFolder,
  loadTemplateLocal, saveTemplateLocal, clearTemplateLocal, loadImportsLocal, saveImportsLocal,
} from '../lib/persist.js';

const statsFor = (records) => ({ comments: records.length, html: 0, images: 0, linked: 0 });

export function createLocalSource() {
  return {
    kind: 'local',
    caps: {
      canAdmin: true, canReview: true, hasHistory: false, shared: false, autosave: true,
      sessionFolder: FS_SUPPORTED, sampleReset: true, refresh: false, sharedSettings: false, manageUsers: false,
      trash: false, backup: false,
    },
    place: null,
    user: null,
    scopeKey: 'local',

    // The session this browser saved last time, else the bundled sample.
    async loadRecords() {
      await requestPersistentStorage();
      const saved = await loadSessionLocal();
      if (saved) return { records: saved.records, source: saved.source || 'user', stats: statsFor(saved.records) };
      const { records, stats } = await loadSampleData();
      return { records, source: 'sample', stats };
    },
    persistSession: (records, source) => saveSessionLocal(records, source),
    async resetToSample() {
      await clearSessionLocal();
      await saveImportsLocal([]);
      const { records, stats } = await loadSampleData();
      return { records, source: 'sample', stats };
    },
    folder: FS_SUPPORTED
      ? { stored: getStoredFolder, pick: pickFolder, permission: folderPermission, write: writeSessionToFolder }
      : null,

    // Edits live in memory and are autosaved as a whole session.
    saveRecord: async (id, patch, version) => ({ version }),
    saveMany: async () => ({ versions: {}, conflicts: [] }),
    async addRecord(rec, existing) {
      const max = existing.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0);
      return { ...rec, ID: max + 1 };
    },
    deleteRecords: async () => {},
    changes: async () => null,
    history: async () => [],
    editStamp: () => null,

    // Importing over the bundled sample replaces it instead of merging.
    isFreshImport: (records, meta) => !records.length || meta?.source === 'sample',
    async importMerge(plan, { missingAction, doneLabel }, current) {
      const base = current.source === 'sample' ? [] : current.records;
      const before = { records: current.records, source: current.source };
      return {
        records: applyMergeLocal(base, plan, { missingAction, doneLabel }),
        source: 'user',
        undo: async () => before,
      };
    },

    imports: () => loadImportsLocal(),
    recordImport: async (summary) => saveImportsLocal(addToLog(await loadImportsLocal(), summary)),
    markImportUndone: async (id) => saveImportsLocal(markUndone(await loadImportsLocal(), id)),

    loadTemplate: () => loadTemplateLocal(),
    saveTemplate: (name, bytes) => saveTemplateLocal(name, bytes),
    clearTemplate: () => clearTemplateLocal(),
    hasTemplate: async () => !!(await loadTemplateLocal()),

    loadSharedSettings: async () => null,
    saveSharedSetting: async () => {},
    teamSize: async () => 0,

    // Offline a delete is final (the session folder is the copy to keep).
    trash: async () => ({ reviews: [], records: [], days: 0 }),
    restore: async () => ({ reviews: 0, records: 0 }),
    purge: async () => ({ reviews: 0, records: 0 }),
    restoreRecord: async () => null,
    backupUrl: null,
  };
}
