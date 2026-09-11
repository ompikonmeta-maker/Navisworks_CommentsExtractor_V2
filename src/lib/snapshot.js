// =====================================================================
// DOM → PNG snapshots. html2canvas is imported dynamically so its weight
// stays out of the initial chunk (the single-file build inlines it anyway,
// keeping everything offline). Used for per-card / whole-Overview snapshots
// and for the chart images embedded into the Excel export.
// =====================================================================
let h2cPromise = null;
function loadH2C() {
  if (!h2cPromise) h2cPromise = import('html2canvas').then((m) => m.default);
  return h2cPromise;
}

function tokenColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Render a node to a canvas at 2× for crisp output. Elements marked
// [data-nosnap] (e.g. the snapshot buttons themselves) are skipped.
async function renderCanvas(node) {
  const html2canvas = await loadH2C();
  return html2canvas(node, {
    backgroundColor: tokenColor('--md-sys-color-background', '#ffffff'),
    scale: 2,
    useCORS: true,
    logging: false,
    ignoreElements: (el) => el.hasAttribute && el.hasAttribute('data-nosnap'),
  });
}

function downloadCanvas(canvas, fileName) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    }, 'image/png');
  });
}

// Snapshot a node and trigger a PNG download.
export async function snapshotNode(node, name) {
  if (!node) return;
  const canvas = await renderCanvas(node);
  await downloadCanvas(canvas, `tabelin-${name}.png`);
}

// Snapshot a node and return { dataUrl, w, h } (for embedding in Excel).
export async function nodeToImage(node) {
  if (!node) return null;
  const canvas = await renderCanvas(node);
  return { dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
}
