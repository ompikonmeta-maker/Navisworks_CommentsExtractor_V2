// =====================================================================
// Excel export — writes the current (optionally filtered) records to an
// .xlsx workbook using SheetJS. Fully client-side. SheetJS is imported
// dynamically so its weight stays out of the initial bundle.
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

function buildCommentsSheet(XLSX, records) {
  const aoa = [COLUMNS.map((c) => c.header)];
  for (const r of records) {
    aoa.push(COLUMNS.map((c) => r[c.key] ?? ''));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = COLUMNS.map((c) => ({ wch: c.width }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: records.length, c: COLUMNS.length - 1 } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

function buildSummarySheet(XLSX, records) {
  const byStatus = { Open: 0, 'In Review': 0, Closed: 0 };
  const byDiscipline = {};
  for (const r of records) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byDiscipline[r.discipline] = (byDiscipline[r.discipline] || 0) + 1;
  }
  const aoa = [
    ['Tabelin — Export Summary'],
    ['Generated', new Date().toLocaleString()],
    ['Total comments', records.length],
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

/**
 * @param {object[]} records
 * @param {string} [fileName]
 * @returns {Promise<void>}
 */
export async function exportToExcel(records, fileName) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildCommentsSheet(XLSX, records), 'Comments');
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(XLSX, records), 'Summary');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, fileName || `tabelin-comments-${stamp}.xlsx`);
}
