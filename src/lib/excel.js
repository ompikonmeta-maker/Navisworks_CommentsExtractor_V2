// =====================================================================
// Excel export — writes the current (optionally filtered) records to an
// .xlsx workbook using SheetJS. Fully client-side. SheetJS and JSZip are
// imported dynamically so their weight stays out of the initial bundle.
//
// SheetJS (community) cannot embed pictures, so after it writes the workbook
// we re-open the .xlsx (a zip) with JSZip and inject the Before/After images
// as anchored drawings on the Comments sheet.
// =====================================================================
let XLSX = null;
async function loadXLSX() {
  if (!XLSX) XLSX = await import('xlsx');
  return XLSX;
}

const COLUMNS = [
  { key: 'ID', header: 'ID', width: 6 },
  { key: 'commentId', header: 'Comment ID', width: 12 },
  { key: 'viewpoint', header: 'Viewpoint', width: 26 },
  { key: 'discipline', header: 'Discipline', width: 12 },
  { key: 'commentText', header: 'Comment', width: 60 },
  { key: 'resolution', header: 'Resolution', width: 40 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'commentDate', header: 'Date', width: 18 },
  { key: 'authorCode', header: 'Author', width: 14 },
  { key: 'cameraPosition', header: 'Camera Position', width: 24 },
  { key: 'imageRef', header: 'Image', width: 16 },
  { key: 'source', header: 'Source File', width: 24 },
];
// Two extra columns hold the embedded pictures (cells stay empty; the images
// are anchored over them by the drawing we inject).
const IMG_COLS = [
  { header: 'Before', width: 16 },
  { header: 'After', width: 16 },
];
const THUMB_MAX = 92; // px — longest side of an embedded thumbnail
const ROW_PT = 74; // row height (points) so a thumbnail fits
const EMU = 9525; // EMU per pixel

function buildCommentsSheet(XLSX, records) {
  const headers = [...COLUMNS.map((c) => c.header), ...IMG_COLS.map((c) => c.header)];
  const aoa = [headers];
  for (const r of records) {
    aoa.push([...COLUMNS.map((c) => r[c.key] ?? ''), '', '']);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [...COLUMNS, ...IMG_COLS].map((c) => ({ wch: c.width }));
  // Tall rows for the pictures (header stays default height).
  ws['!rows'] = records.map(() => ({ hpt: ROW_PT }));
  const lastCol = COLUMNS.length + IMG_COLS.length - 1;
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: records.length, c: COLUMNS.length - 1 } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: records.length, c: lastCol } });
  return ws;
}

function buildSummarySheet(XLSX, records) {
  const byStatus = { Open: 0, 'In Review': 0, Closed: 0 };
  const byDiscipline = {};
  let withAfter = 0;
  for (const r of records) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byDiscipline[r.discipline] = (byDiscipline[r.discipline] || 0) + 1;
    if (r.afterImageData) withAfter += 1;
  }
  const aoa = [
    ['Tabelin — Export Summary'],
    ['Generated', new Date().toLocaleString()],
    ['Total comments', records.length],
    ['With after photo', withAfter],
    [],
    ['Status', 'Count'],
    ...Object.entries(byStatus).map(([k, v]) => [k, v]),
    [],
    ['Discipline', 'Count'],
    ...Object.entries(byDiscipline)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, v]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }];
  return ws;
}

// --- image embedding helpers -----------------------------------------

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

// Collect the pictures to embed with their target cell (0-indexed col/row)
// and pixel extent (aspect-preserved, capped at THUMB_MAX).
async function collectImages(records) {
  const beforeCol = COLUMNS.length;
  const afterCol = COLUMNS.length + 1;
  const out = [];
  for (let i = 0; i < records.length; i += 1) {
    const row = i + 1; // header is row 0
    for (const [field, col] of [['imageData', beforeCol], ['afterImageData', afterCol]]) {
      const parsed = parseDataUrl(records[i][field]);
      if (!parsed) continue;
      // eslint-disable-next-line no-await-in-loop
      const { w, h } = await imageSize(records[i][field]);
      const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
      out.push({ ...parsed, col, row, cx: Math.round(w * scale * EMU), cy: Math.round(h * scale * EMU) });
    }
  }
  return out;
}

function drawingXml(images) {
  const anchors = images.map((im, i) => {
    const id = i + 1;
    return (
      `<xdr:oneCellAnchor>` +
      `<xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${2 * EMU}</xdr:colOff>` +
      `<xdr:row>${im.row}</xdr:row><xdr:rowOff>${2 * EMU}</xdr:rowOff></xdr:from>` +
      `<xdr:ext cx="${im.cx}" cy="${im.cy}"/>` +
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="img${id}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${id}"/>` +
      `<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
      `<xdr:clientData/></xdr:oneCellAnchor>`
    );
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.join('')}</xdr:wsDr>`
  );
}

function drawingRelsXml(images) {
  const rels = images
    .map((im, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.${im.ext}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

// Inject media + drawing into the SheetJS-produced .xlsx zip (byte array).
async function embedImages(bytes, records) {
  const images = await collectImages(records);
  if (!images.length) return bytes;
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);

  // media
  images.forEach((im, i) => zip.file(`xl/media/image${i + 1}.${im.ext}`, im.base64, { base64: true }));
  // drawing + its rels
  zip.file('xl/drawings/drawing1.xml', drawingXml(images));
  zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml(images));

  // worksheet: ensure the r namespace, then reference the drawing
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let sheet = await zip.file(sheetPath).async('string');
  if (!/xmlns:r=/.test(sheet)) {
    sheet = sheet.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  }
  if (!/<drawing /.test(sheet)) {
    sheet = sheet.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>');
  }
  zip.file(sheetPath, sheet);

  // worksheet rels → drawing
  const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  const relFile = zip.file(relsPath);
  const drawingRel = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';
  if (relFile) {
    let rels = await relFile.async('string');
    if (!/drawings\/drawing1\.xml/.test(rels)) rels = rels.replace('</Relationships>', `${drawingRel}</Relationships>`);
    zip.file(relsPath, rels);
  } else {
    zip.file(relsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRel}</Relationships>`);
  }

  // [Content_Types].xml: image defaults + drawing override
  const ctPath = '[Content_Types].xml';
  let ct = await zip.file(ctPath).async('string');
  if (!/Extension="png"/.test(ct)) ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  if (!/Extension="jpeg"/.test(ct)) ct = ct.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  if (!/drawing1\.xml/.test(ct)) ct = ct.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
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
 * @param {string} [fileName]
 * @returns {Promise<void>}
 */
export async function exportToExcel(records, fileName) {
  const xlsx = await loadXLSX();
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, buildCommentsSheet(xlsx, records), 'Comments');
  xlsx.utils.book_append_sheet(wb, buildSummarySheet(xlsx, records), 'Summary');
  const stamp = new Date().toISOString().slice(0, 10);
  const name = fileName || `tabelin-comments-${stamp}.xlsx`;

  const bytes = xlsx.write(wb, { type: 'array', bookType: 'xlsx' });
  const withImages = await embedImages(new Uint8Array(bytes), records);
  saveBytes(withImages, name);
}
