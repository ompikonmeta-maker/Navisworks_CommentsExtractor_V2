// The log-sheet export (the review's main deliverable): fills the project's
// Excel template with the given comments. Shared by Overview, Viewpoints and
// Settings › Template.
import { data } from '../data/index.js';
import { fillTemplate } from './templateExcel.js';
import { inlineImages } from './photos.js';

export function downloadBytes(bytes, name, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Throws an error with code 'no-template' when no template is set up yet.
export async function exportLogSheet(records, cfg, tplBytes = null) {
  const bytes = tplBytes || (await data().loadTemplate())?.bytes;
  if (!bytes) {
    const e = new Error('Choose the log-sheet template first.');
    e.code = 'no-template';
    throw e;
  }
  const out = await fillTemplate(bytes, await inlineImages(records), cfg, cfg.constants || {});
  downloadBytes(out.bytes, `3D-review-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return out.stats;
}
