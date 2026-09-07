// =====================================================================
// Seed dataset — parses the bundled Navisworks sample report and links the
// companion viewpoint images shipped in /public/sample. This is the data
// the workspace starts with on every load (spec: refresh returns to sample).
// =====================================================================
import { parseReportHtml, linkImages, resetIdCounter } from './parser.js';

const BASE = import.meta.env.BASE_URL || '/';
const SAMPLE_IMAGES = ['vp0026.jpg', 'vp0027.jpg', 'vp0028.jpg', 'vp0029.jpg', 'vp0030.jpg'];

async function fetchDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export async function loadSampleData() {
  const html = await fetch(`${BASE}sample/report.html`).then((r) => {
    if (!r.ok) throw new Error(`Sample report tidak ditemukan (HTTP ${r.status})`);
    return r.text();
  });

  resetIdCounter();
  const { records } = parseReportHtml(html, '2500_UBA-2026.08.26.html');

  // Best-effort image linking for the handful of shipped viewpoint images.
  const imagesByName = {};
  await Promise.all(
    SAMPLE_IMAGES.map(async (name) => {
      try {
        imagesByName[name.toLowerCase()] = await fetchDataUrl(`${BASE}sample/${name}`);
      } catch {
        /* image optional */
      }
    })
  );
  const linked = linkImages(records, imagesByName);

  return {
    records,
    stats: { html: 1, comments: records.length, images: SAMPLE_IMAGES.length, linked },
  };
}
