// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import { parseReportHtml, resetIdCounter } from '../src/lib/parser.js';
import { fillTemplate, inspectTemplate, DEFAULT_TEMPLATE_MAPPING } from '../src/lib/templateExcel.js';

const TEMPLATE = 'docs/3D REVIEW LOG_MASTER_FORMAL_90_OFA.xlsx';
const LOG = '3D Model Log Sheet';
const N = 12; // more than the template's two detail sheets, so sheets get cloned

// ---- tiny .xlsx reader (enough to check what the export wrote) ----
async function openBook(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const text = (p) => zip.file(p).async('string');
  const wb = await text('xl/workbook.xml');
  const rels = await text('xl/_rels/workbook.xml.rels');
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])[1];
    target[id] = `xl/${/Target="([^"]+)"/.exec(m[0])[1].replace(/^\/xl\//, '')}`;
  }
  const sheets = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    sheets[/name="([^"]+)"/.exec(m[0])[1]] = target[/r:id="([^"]+)"/.exec(m[0])[1]];
  }
  const sst = zip.file('xl/sharedStrings.xml')
    ? [...(await text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
    : [];
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  // → { A10: value } ; numbers as numbers, text as text, empty cells absent
  async function cells(name) {
    const xml = await text(sheets[name]);
    const out = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, inner = ''] = m;
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (type === 'inlineStr') out[ref] = unesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (v == null) continue;
      else if (type === 's') out[ref] = unesc(sst[+v]);
      else if (type === 'str') out[ref] = unesc(v);
      else out[ref] = Number(v);
    }
    return out;
  }
  const rowNumbers = async (name) => [...(await text(sheets[name])).matchAll(/<row r="(\d+)"/g)].map((m) => +m[1]);
  return { zip, sheets, cells, rowNumbers, text };
}

describe('template export — sample records into the company template', () => {
  let tplBytes, records, out, book, tplBook;

  beforeAll(async () => {
    tplBytes = new Uint8Array(fs.readFileSync(TEMPLATE));
    resetIdCounter();
    records = parseReportHtml(fs.readFileSync('src/sample/report.html', 'utf8'), 'sample.html').records.slice(0, N);
    const jpg = `data:image/jpeg;base64,${fs.readFileSync('src/sample/vp0026.jpg').toString('base64')}`;
    // Work done in Tabelin on a few of them.
    Object.assign(records[0], { imageData: jpg });
    Object.assign(records[1], { status: 'Closed', closedAt: '2025-02-14T03:00:00.000Z', resolution: 'Stretcher route added', imageData: jpg, afterImageData: jpg, extra: { actionBy: 'LOSPE', remarks: 'line 1\nline 2' } });
    Object.assign(records[2], { status: 'In Review', resolution: 'Under study <A&B>' });
    out = await fillTemplate(tplBytes, records, DEFAULT_TEMPLATE_MAPPING, { unit: 'UBA', phase: '2' });
    book = await openBook(out.bytes);
    tplBook = await openBook(tplBytes);
  });

  it('reports what it wrote', () => {
    expect(out.stats).toMatchObject({ logRows: N, detailSheets: N, images: 3 });
  });

  it('finds the log sheet and its headers in the template', async () => {
    const info = await inspectTemplate(tplBytes, 9);
    expect(info.logSheet).toBe(LOG);
    expect(info.headers).toMatchObject({ B: 'TAG VIEW NO.', F: 'COMMENT RECORD', K: 'RESOLUTION', M: 'CTR DISCIPLINE STATUS' });
  });

  it('writes one log row per record, and nothing after them', async () => {
    const rows = (await book.rowNumbers(LOG)).filter((r) => r >= 10);
    expect(rows).toEqual(records.map((_, i) => 10 + i));
  });

  it('leaves the rows above the data (title block, headers) as they were', async () => {
    const before = await tplBook.cells(LOG);
    const after = await book.cells(LOG);
    const head = (c) => Object.fromEntries(Object.entries(c).filter(([ref]) => +/\d+/.exec(ref)[0] < 10));
    expect(head(after)).toEqual(head(before));
    expect(Object.keys(head(after)).length).toBeGreaterThan(10);
  });

  it('puts each field in the right column', async () => {
    const c = await book.cells(LOG);
    records.forEach((r, i) => {
      const row = 10 + i;
      expect(c[`A${row}`]).toBe(i + 1); // item number, as a number
      expect(c[`B${row}`]).toBe(r.viewpoint);
      expect(c[`D${row}`]).toBe('UBA');
      expect(c[`E${row}`]).toBe(2);
      expect(c[`F${row}`]).toBe(r.commentText);
      expect(c[`G${row}`]).toBe('1. 3D snapshot\n2. Document'); // field default
      expect(c[`H${row}`]).toBe('OFA');
      expect(c[`I${row}`]).toBe(r.commenter || undefined);
      expect(c[`J${row}`]).toBe(r.discipline);
    });
    // Comment 228 was raised on 9 Dec 2024 → Excel day number 45635
    expect(c.C10).toBe(45635);
    expect(c.B10).toBe('Tag View 1');
  });

  it('writes status, resolution, closing date and custom fields', async () => {
    const c = await book.cells(LOG);
    expect([c.M10, c.M11, c.M12]).toEqual(['OPEN', 'CLOSED', 'IN REVIEW']);
    expect(c.K11).toBe('Stretcher route added');
    expect(c.K12).toBe('Under study <A&B>'); // special characters survive
    expect(c.K10).toBeUndefined();
    expect(c.N11).toBe(45702); // 14 Feb 2025
    expect(c.N10).toBeUndefined();
    expect(c.L11).toBe('LOSPE');
    expect(c.W11).toBe('line 1\nline 2');
  });

  it('makes one detail sheet per record, each pointing at its item', async () => {
    for (let i = 1; i <= N; i += 1) {
      const path = book.sheets[String(i)];
      expect(path, `sheet "${i}"`).toBeTruthy();
      expect(book.zip.file(path), path).toBeTruthy();
      expect((await book.cells(String(i))).N2).toBe(i);
    }
    expect(Object.keys(book.sheets)).toEqual(expect.arrayContaining(Object.keys(tplBook.sheets)));
    expect(new Set(Object.values(book.sheets)).size).toBe(Object.keys(book.sheets).length); // no two sheets share a part
  });

  it('keeps every template file, with logos and other media untouched', async () => {
    const outFiles = new Set(Object.keys(book.zip.files));
    // calcChain.xml (Excel's calculation cache) is dropped on purpose; Excel rebuilds it.
    const tplFiles = Object.keys(tplBook.zip.files).filter((f) => f !== 'xl/calcChain.xml');
    for (const f of tplFiles) expect(outFiles.has(f), f).toBe(true);
    expect(outFiles.has('xl/calcChain.xml')).toBe(false);
    expect(await book.text('[Content_Types].xml')).not.toContain('calcChain');
    expect(await book.text('xl/_rels/workbook.xml.rels')).not.toContain('calcChain');
    const media = tplFiles.filter((f) => f.startsWith('xl/media/') && !tplBook.zip.files[f].dir);
    expect(media.length).toBeGreaterThan(0);
    for (const f of media) {
      const a = await tplBook.zip.file(f).async('uint8array');
      const b = await book.zip.file(f).async('uint8array');
      expect(Buffer.from(b).equals(Buffer.from(a)), f).toBe(true);
    }
    expect(tplFiles.some((f) => f.startsWith('xl/drawings/drawing'))).toBe(true);
    expect(await book.text('xl/styles.xml')).toBe(await tplBook.text('xl/styles.xml'));
  });

  it('produces a workbook whose parts are all declared and well-formed', async () => {
    const ct = await book.text('[Content_Types].xml');
    const parser = new DOMParser();
    for (const [name, file] of Object.entries(book.zip.files)) {
      if (file.dir || !/\.(xml|rels)$/.test(name)) continue;
      const doc = parser.parseFromString(await file.async('string'), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, name).toBe(0);
    }
    for (const path of Object.values(book.sheets)) expect(ct, path).toContain(`PartName="/${path}"`);
    // every picture the drawings point at exists
    for (const name of Object.keys(book.zip.files).filter((f) => /^xl\/drawings\/_rels\/.*\.rels$/.test(f))) {
      for (const m of (await book.text(name)).matchAll(/Target="\.\.\/media\/([^"]+)"/g)) {
        expect(book.zip.file(`xl/media/${m[1]}`), `${name} → ${m[1]}`).toBeTruthy();
      }
    }
  });

  it('adds the before/after photos as new media', async () => {
    const count = (b) => Object.keys(b.zip.files).filter((f) => f.startsWith('xl/media/')).length;
    expect(count(book)).toBe(count(tplBook) + 3);
  });

  it('exports an empty review without breaking the template', async () => {
    const empty = await fillTemplate(tplBytes, [], DEFAULT_TEMPLATE_MAPPING, {});
    const b = await openBook(empty.bytes);
    expect(empty.stats.logRows).toBe(0);
    expect((await b.rowNumbers(LOG)).filter((r) => r >= 10)).toEqual([]);
  });
});
