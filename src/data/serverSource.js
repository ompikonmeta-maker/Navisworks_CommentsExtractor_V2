// The office-server data source: one review, as the signed-in user. Every
// change is saved to the server (with the record's version, see
// lib/server.js syncRecord); other people's changes arrive via changes().
// Same members as localSource.js.
import {
  api, loadReviewRecords, syncRecord, createRecordRemote, applyMergeRemote, undoImportRemote, mapServerRecord,
} from '../lib/server.js';
import { loadTemplateLocal } from '../lib/persist.js';
import { addToLog, markUndone } from '../lib/importSummary.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Two roles; the server enforces the same rules.
// - admin: everything — import, add/delete comments, settings, template, projects, users;
// - reviewer: works the comments — status, resolution, discipline, commenter,
//   custom fields, photos, bulk edit — and exports.
export const isAdminUser = (user) => user?.role === 'admin';
export const isReviewerUser = (user) => user?.role === 'admin' || user?.role === 'reviewer';

export function createServerSource({ project, review, user }) {
  const rid = review.id;
  const pid = project.id;
  const canAdmin = isAdminUser(user);
  const recordsSource = `review:${rid}`;

  const source = {
    kind: 'server',
    caps: {
      canAdmin, canReview: isReviewerUser(user), hasHistory: true, shared: true, autosave: false,
      sessionFolder: false, sampleReset: false, refresh: true, sharedSettings: true, manageUsers: canAdmin,
      trash: canAdmin, backup: canAdmin,
    },
    place: { project, review },
    user,
    scopeKey: String(rid),

    async loadRecords() {
      const records = await loadReviewRecords(rid);
      return { records, source: recordsSource, stats: { comments: records.length, html: 0, images: 0, linked: 0 } };
    },
    persistSession: async () => {},
    resetToSample: null,
    folder: null,

    saveRecord: (id, patch, version) => syncRecord(id, patch, version),
    async saveMany(updates) {
      const res = await api.bulkPatchRecords(rid, updates);
      return { versions: res?.versions || {}, conflicts: (res?.conflicts || []).map(mapServerRecord) };
    },
    addRecord: (rec) => createRecordRemote(rid, rec),
    deleteRecords: (ids) => api.deleteRecords(rid, ids),
    async changes(since) {
      const res = await api.getChanges(rid, since);
      return { ...res, records: (res.records || []).map(mapServerRecord) };
    },
    history: (id) => api.recordHistory(id),
    // Stamp an edit locally too, so "Changed by" is current without a reload
    // (the server records the same on save).
    editStamp: () => ({ changedBy: user?.displayName || user?.username || '', changedAt: new Date().toISOString() }),

    isFreshImport: (records) => !records.length,
    async importMerge(plan, opts) {
      const res = await applyMergeRemote(rid, plan, opts);
      return {
        records: res.records,
        source: recordsSource,
        undo: async () => ({ records: await undoImportRemote(rid, res.undo), source: recordsSource }),
      };
    },

    // Past import summaries live in the review's config (key "imports").
    async imports() {
      const cfg = await api.getReviewConfig(rid);
      return Array.isArray(cfg?.imports) ? cfg.imports : [];
    },
    recordImport: async (summary) => api.putReviewConfig(rid, 'imports', addToLog(await source.imports(), summary)),
    markImportUndone: async (id) => api.putReviewConfig(rid, 'imports', markUndone(await source.imports(), id)),

    // The template belongs to the project, so everyone exports with the same one.
    async loadTemplate() {
      try {
        const res = await api.getTemplate(pid);
        const name = decodeURIComponent(res.headers.get('X-Template-Name') || 'template.xlsx');
        return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch (e) {
        if (e.code !== 404) return null;
      }
      // The project has no template yet: an admin shares the one this browser already uses.
      const local = canAdmin ? await loadTemplateLocal() : null;
      if (!local) return null;
      try { await source.saveTemplate(local.name, local.bytes); } catch { /* keep it local-only */ }
      return local;
    },
    saveTemplate: (name, bytes) => api.putTemplate(pid, name, new Blob([bytes], { type: XLSX_MIME })).then(() => undefined),
    clearTemplate: () => api.deleteTemplate(pid).then(() => undefined),
    hasTemplate: () => api.hasTemplate(pid),

    async loadSharedSettings() {
      const [projectCfg, reviewCfg] = await Promise.all([api.getProjectConfig(pid), api.getReviewConfig(rid)]);
      return { project: projectCfg || {}, review: reviewCfg || {} };
    },
    saveSharedSetting: (scope, key, value) => (scope === 'review' ? api.putReviewConfig(rid, key, value) : api.putProjectConfig(pid, key, value)),
    async teamSize() {
      if (!canAdmin) return 0;
      const users = await api.listUsers();
      return users.filter((x) => x.id !== user?.id).length;
    },

    // Deleted comments and reviews wait 30 days in the server's Trash (admins).
    trash: () => api.getTrash(),
    restore: (pick) => api.restoreTrash({ reviews: pick.reviews || [], records: pick.records || [] }),
    purge: (pick) => api.purgeTrash({ reviews: pick.reviews || [], records: pick.records || [] }),
    async restoreRecord(id) {
      await api.restoreTrash({ reviews: [], records: [id] });
      return mapServerRecord(await api.getRecord(id));
    },
    backupUrl: canAdmin ? '/api/backup' : null,
  };
  return source;
}
