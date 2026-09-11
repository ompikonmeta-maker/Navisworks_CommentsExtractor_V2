// =====================================================================
// Excel export — writes the current records to an .xlsx workbook (SheetJS),
// then re-opens the zip with JSZip to inject images SheetJS can't write:
//   • Comments sheet — the before/after photos, anchored per row.
//   • Overview sheet — the numeric analytics tables plus the rendered chart
//     images captured from the dashboard.
// Fully client-side; SheetJS and JSZip are imported dynamically.
// =====================================================================
let XLSX = null;
async function loadXLSX() {
  if (!XLSX) XLSX = await import('xlsx');
  return XLSX;
}

const EMU = 9525; // EMU per pixel

const COLUMNS = [
  { key: 'ID', header: 'ID', width: 6 },
  { key: 'commentId', header: 'Comment ID', width: 12 },
  { key: 'viewpoint', header: 'Viewpoint', width: 26 },
  { key: 'discipline', header: 'Discipline', width: 12 },
  { key: 'commentText', header: 'Comment', width: 60 },
  { key: 'resolution', header: 'Resolution', width: 40 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'commentDate', header: 'Date', width: 18 },
  { key: 'closedAt', header: 'Closed At', width: 18, ts: true },
  { key: 'authorCode', header: 'Author', width: 14 },
  { key: 'cameraPosition', header: 'Camera Position', width: 24 },
  { key: 'imageRef', header: 'Image', width: 16 },
  { key: 'source', header: 'Source File', width: 24 },
];
const IMG_COLS = [{ header: 'Before', width: 16 }, { header: 'After', width: 16 }];
const THUMB_MAX = 92;
const ROW_PT = 74;

// --- Comments sheet ---------------------------------------------------

// ISO → "YYYY-MM-DD HH:mm" (local), blank if unset.
function fmtTs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildCommentsSheet(X, records) {
  const headers = [...COLUMNS.map((c) => c.header), ...IMG_COLS.map((c) => c.header)];
  const aoa = [headers];
  for (const r of records) aoa.push([...COLUMNS.map((c) => (c.ts ? fmtTs(r[c.key]) : r[c.key] ?? '')), '', '']);
  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [...COLUMNS, ...IMG_COLS].map((c) => ({ wch: c.width }));
  ws['!rows'] = records.map(() => ({ hpt: ROW_PT }));
  const lastCol = COLUMNS.length + IMG_COLS.length - 1;
  ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: records.length, c: COLUMNS.length - 1 } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: records.length, c: lastCol } });
  return ws;
}

// --- Overview sheet ---------------------------------------------------

function buildOverviewSheet(X, ov) {
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '0%');
  const aoa = [
    ['Tabelin — Overview'],
    ['Generated', ov.generatedAt],
    [],
    ['KPI', 'Count', 'Share'],
    ['Total', ov.total, ''],
    ['Open', ov.kpis.Open || 0, pct(ov.kpis.Open || 0, ov.total)],
    ['In Review', ov.kpis['In Review'] || 0, pct(ov.kpis['In Review'] || 0, ov.total)],
    ['Closed', ov.kpis.Closed || 0, pct(ov.kpis.Closed || 0, ov.total)],
    ['Closed rate', `${ov.closedPct}%`, ''],
    ['Photo evidence', `${ov.coverage.withPhoto} of ${ov.coverage.closed} closed`, `${ov.coverage.pct}%`],
    [],
    ['By discipline'],
    ['Discipline', 'Open', 'In Review', 'Closed', 'Total', '% Closed'],
    ...ov.byDiscipline.map((d) => [d.name, d.Open, d['In Review'], d.Closed, d.total, pct(d.Closed, d.total)]),
    [],
    ['Over time (by current status)'],
    ['Month', 'Open', 'In Review', 'Closed'],
    ...ov.trend.map((t) => [t.month, t.Open, t['In Review'], t.Closed]),
    [],
    ['Needs attention (oldest open)'],
    ['Viewpoint', 'Discipline', 'Date', 'Age (days)', 'Comment'],
    ...ov.needsAttention.map((r) => [r.viewpoint, r.discipline, r.commentDate, r.ageDays ?? '', r.commentText]),
  ];
  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 60 }];
  // Reserve width to the right where the chart images float.
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length + 90, c: 14 } });
  return ws;
}

// --- image embedding (multi-sheet) ------------------------------------

function parseDataUrl(url) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(url || '');
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  return { ext, base64: m[2] };
}

function imageSize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: THUMB_MAX, h: THUMB_MAX });
    img.src = url;
  });
}

// Photos to anchor on the Comments sheet (one per record, before + after).
async function commentImages(records) {
  const beforeCol = COLUMNS.length;
  const afterCol = COLUMNS.length + 1;
  const out = [];
  for (let i = 0; i < records.length; i += 1) {
    for (const [field, col] of [['imageData', beforeCol], ['afterImageData', afterCol]]) {
      const parsed = parseDataUrl(records[i][field]);
      if (!parsed) continue;
      // eslint-disable-next-line no-await-in-loop
      const { w, h } = await imageSize(records[i][field]);
      const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
      out.push({ ...parsed, col, row: i + 1, cx: Math.round(w * scale * EMU), cy: Math.round(h * scale * EMU) });
    }
  }
  return out;
}

// Chart images to anchor on the Overview sheet (stacked in a right column).
function overviewImages(ov) {
  const CHART_W = 470; // px
  const out = [];
  let row = 1;
  for (const ch of ov.charts || []) {
    if (!ch.img) continue;
    const parsed = parseDataUrl(ch.img.dataUrl);
    if (!parsed) continue;
    const scale = CHART_W / ch.img.w;
    const cx = Math.round(CHART_W * EMU);
    const cy = Math.round(ch.img.h * scale * EMU);
    out.push({ ...parsed, col: 7, row, cx, cy });
    row += Math.ceil((ch.img.h * scale) / 20) + 3; // leave a gap below
  }
  return out;
}

function drawingXml(images) {
  const anchors = images.map((im, i) => {
    const id = i + 1;
    return (
      '<xdr:oneCellAnchor>' +
      `<xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${2 * EMU}</xdr:colOff>` +
      `<xdr:row>${im.row}</xdr:row><xdr:rowOff>${2 * EMU}</xdr:rowOff></xdr:from>` +
      `<xdr:ext cx="${im.cx}" cy="${im.cy}"/>` +
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="img${id}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${id}"/>` +
      '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
      '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
      '<xdr:clientData/></xdr:oneCellAnchor>'
    );
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.join('')}</xdr:wsDr>`
  );
}

function drawingRelsXml(images) {
  const rels = images
    .map((im, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${im.mediaName}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

// groups: [{ sheetFile, drawingNo, images }]
async function embedDrawings(bytes, groups) {
  const active = groups.filter((g) => g.images.length);
  if (!active.length) return bytes;
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);

  let mediaN = 0;
  const ctOverrides = [];
  for (const g of active) {
    // write media (global names) and record them on each image
    for (const im of g.images) {
      mediaN += 1;
      im.mediaName = `image${mediaN}.${im.ext}`;
      zip.file(`xl/media/${im.mediaName}`, im.base64, { base64: true });
    }
    zip.file(`xl/drawings/drawing${g.drawingNo}.xml`, drawingXml(g.images));
    zip.file(`xl/drawings/_rels/drawing${g.drawingNo}.xml.rels`, drawingRelsXml(g.images));
    ctOverrides.push(g.drawingNo);

    // worksheet: ensure the r namespace + a <drawing> reference
    const path = `xl/worksheets/${g.sheetFile}`;
    let sheet = await zip.file(path).async('string');
    if (!/xmlns:r=/.test(sheet)) {
      sheet = sheet.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    }
    if (!/<drawing /.test(sheet)) {
      sheet = sheet.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>');
    }
    zip.file(path, sheet);

    // worksheet rels → its drawing
    const relsPath = `xl/worksheets/_rels/${g.sheetFile}.rels`;
    const rel = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${g.drawingNo}.xml"/>`;
    const existing = zip.file(relsPath);
    if (existing) {
      let rels = await existing.async('string');
      if (!/relationships\/drawing/.test(rels)) rels = rels.replace('</Relationships>', `${rel}</Relationships>`);
      zip.file(relsPath, rels);
    } else {
      zip.file(relsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`);
    }
  }

  // [Content_Types].xml — image defaults + a drawing override per drawing
  const ctPath = '[Content_Types].xml';
  let ct = await zip.file(ctPath).async('string');
  if (!/Extension="png"/.test(ct)) ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  if (!/Extension="jpeg"/.test(ct)) ct = ct.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  for (const no of ctOverrides) {
    if (!new RegExp(`drawing${no}\\.xml"`).test(ct)) {
      ct = ct.replace('</Types>', `<Override PartName="/xl/drawings/drawing${no}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
  }
  zip.file(ctPath, ct);

  return zip.generateAsync({ type: 'uint8array' });
}

function saveBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {object[]} records
 * @param {{ overview?: object, fileName?: string }} [opts]
 */
export async function exportToExcel(records, opts = {}) {
  const { overview, fileName } = opts;
  const X = await loadXLSX();
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, buildCommentsSheet(X, records), 'Comments'); // sheet1
  if (overview) X.utils.book_append_sheet(wb, buildOverviewSheet(X, overview), 'Overview'); // sheet2

  const bytes = new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx' }));
  const groups = [{ sheetFile: 'sheet1.xml', drawingNo: 1, images: await commentImages(records) }];
  if (overview) groups.push({ sheetFile: 'sheet2.xml', drawingNo: 2, images: overviewImages(overview) });
  const withImages = await embedDrawings(bytes, groups);

  const stamp = new Date().toISOString().slice(0, 10);
  saveBytes(withImages, fileName || `tabelin-comments-${stamp}.xlsx`);
}
