// =====================================================================
// Seed dataset — parses the bundled Navisworks sample report and links the
// companion viewpoint images. Everything is embedded at build time (report
// as a raw string, images as inlined data URLs) so the app works offline
// and even when opened directly from the filesystem (file://) with no
// server or network — nothing is fetched. This is the data the workspace
// starts with on every load (spec: refresh returns to sample).
// =====================================================================
import { parseReportHtml, linkImages, resetIdCounter } from './parser.js';

import reportHtml from '../sample/report.html?raw';
import vp0026 from '../sample/vp0026.jpg';
import vp0027 from '../sample/vp0027.jpg';
import vp0028 from '../sample/vp0028.jpg';
import vp0029 from '../sample/vp0029.jpg';
import vp0030 from '../sample/vp0030.jpg';

// With a high build.assetsInlineLimit these imports resolve to base64
// data: URLs; keyed by the file name each viewpoint references.
const SAMPLE_IMAGES = {
  'vp0026.jpg': vp0026,
  'vp0027.jpg': vp0027,
  'vp0028.jpg': vp0028,
  'vp0029.jpg': vp0029,
  'vp0030.jpg': vp0030,
};

// The bundled report holds hundreds of comments; the seed dataset keeps only
// a small, representative slice so the app (and the template export) stays
// light to try. Comments that carry a companion image are kept first so the
// before/after demo still works.
const SAMPLE_LIMIT = 10;

export async function loadSampleData() {
  resetIdCounter();
  const parsed = parseReportHtml(reportHtml, '2500_UBA-2026.08.26.html');
  const withImg = parsed.records.filter((r) => r.imageRef && SAMPLE_IMAGES[String(r.imageRef).toLowerCase()]);
  const rest = parsed.records.filter((r) => !withImg.includes(r));
  const records = [...withImg, ...rest].slice(0, SAMPLE_LIMIT);

  const imagesByName = {};
  for (const [name, url] of Object.entries(SAMPLE_IMAGES)) {
    imagesByName[name.toLowerCase()] = url;
  }
  const linked = linkImages(records, imagesByName);

  return {
    records,
    stats: { html: 1, comments: records.length, images: Object.keys(SAMPLE_IMAGES).length, linked },
  };
}
