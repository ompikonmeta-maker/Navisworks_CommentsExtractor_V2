// =====================================================================
// DOM → PNG snapshots. Uses html-to-image (foreignObject → SVG → canvas),
// which renders through the browser's own layout engine, so flex alignment,
// padded badges and SVG charts come out exactly as on screen — unlike a
// re-implemented rasteriser. Imported dynamically; the single-file build
// inlines it so snapshots still work fully offline.
// Used for per-card / whole-Overview snapshots and for the chart images
// embedded into the Excel export.
// =====================================================================
let libPromise = null;
function loadLib() {
  if (!libPromise) libPromise = import('html-to-image');
  return libPromise;
}

function tokenColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Exclude the snapshot buttons (and anything else marked) from the capture.
const filter = (node) => !(node.dataset && node.dataset.nosnap != null);

function options() {
  return {
    pixelRatio: 2,
    backgroundColor: tokenColor('--md-sys-color-background', '#ffffff'),
    filter,
    cacheBust: true,
  };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Snapshot a node and trigger a PNG download.
export async function snapshotNode(node, name) {
  if (!node) return;
  const { toBlob } = await loadLib();
  const blob = await toBlob(node, options());
  if (blob) downloadBlob(blob, `tabelin-${name}.png`);
}

// Snapshot a node and return { dataUrl, w, h } (for embedding in Excel).
export async function nodeToImage(node) {
  if (!node) return null;
  const { toCanvas } = await loadLib();
  const canvas = await toCanvas(node, options());
  return { dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
}
