// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import {
  parseReportHtml, resetIdCounter, normalizeStatus, detectCommenter, inferDiscipline, cleanComment, linkImages,
} from '../src/lib/parser.js';

const vp = (name, inner) => `<div class="viewpoint"><h2>${name}</h2><a href="img/${name}.jpg"><img src="img/${name}.jpg"></a>
  <span class="namevaluepair"><span class="name">Camera Position</span><span class="value">1.0m,
   2.0m,
   3.0m</span></span>${inner}</div>`;
const comment = (id, status, text) => `<div class="comment"><h4>Comment ${id}</h4>
  <span class="namevaluepair"><span class="name">Status</span><span class="value">${status}</span></span>
  <span class="namevaluepair"><span class="name">User</span><span class="value">U1</span></span>
  <span class="namevaluepair"><span class="name">Text</span><span class="value">${text}</span></span>2025/1/5
  09:3:07</div>`;

describe('parser — bundled sample report', () => {
  let parsed;
  beforeAll(() => {
    resetIdCounter();
    parsed = parseReportHtml(fs.readFileSync('src/sample/report.html', 'utf8'), 'sample.html');
  });

  it('makes one record per comment and skips viewpoints without comments', () => {
    expect(parsed.viewpointCount).toBe(760);
    expect(parsed.records).toHaveLength(747);
    expect(parsed.htmlName).toBe('sample.html');
  });

  it('gives every record its own ID and Navisworks comment ID', () => {
    expect(parsed.records.map((r) => r.ID)).toEqual(parsed.records.map((_, i) => i + 1));
    expect(new Set(parsed.records.map((r) => r.commentId)).size).toBe(747);
  });

  it('reads the fields of a known comment (Comment 228)', () => {
    const r = parsed.records.find((x) => x.commentId === '228');
    expect(r).toMatchObject({
      viewpoint: 'Tag View 1',
      authorCode: 'PSS955574',
      commentDate: '2024/12/9 04:0:23',
      cameraPosition: '108.985m, 73.020m, 56.348m',
      imageRef: 'vp0015.jpg',
      rawStatus: 'New',
      status: 'Open',
      closedAt: null,
      resolution: '',
      imageData: '',
      afterImageData: '',
      extra: {},
      source: 'sample.html',
    });
  });

  it('keeps the raw text and a cleaned text, and detects commenter and discipline', () => {
    const a = parsed.records.find((x) => x.commentId === '228');
    expect(a.commentRaw).toBe('OPS(Teguh): LOSPE to consider how to transfer the injured operator using stretcher from top of TB to main deck');
    expect(a.commentText).toBe('LOSPE to consider how to transfer the injured operator using stretcher from top of TB to main deck');
    expect(a.commenter).toBe('OPS(Teguh)');
    expect(a.discipline).toBe('LOSPE');

    const b = parsed.records.find((x) => x.commentId === '229');
    expect(b.commenter).toBe('CPY_Dito');
    expect(b.discipline).toBe('OTHER'); // no discipline named in the text
    expect(b.commentText.startsWith('CTR to provide feedback')).toBe(true);
    expect(b.commentRaw.startsWith('CPY_Dito: CTR to provide feedback')).toBe(true);
  });

  it('normalises every sample status ("New") to Open', () => {
    expect(new Set(parsed.records.map((r) => r.rawStatus))).toEqual(new Set(['New']));
    expect(new Set(parsed.records.map((r) => r.status))).toEqual(new Set(['Open']));
  });
});

describe('parser — rules', () => {
  it('normalises Navisworks statuses', () => {
    expect(normalizeStatus('New')).toBe('Open');
    expect(normalizeStatus('Active')).toBe('Open');
    expect(normalizeStatus(' approved ')).toBe('Closed');
    expect(normalizeStatus('Resolved')).toBe('Closed');
    expect(normalizeStatus('Pending')).toBe('In Review');
    expect(normalizeStatus('In Review')).toBe('In Review');
    expect(normalizeStatus('something else')).toBe('Open');
    expect(normalizeStatus('')).toBe('Open');
  });

  it('detects commenter, discipline and cleaned text from the comment text', () => {
    expect(detectCommenter('CPY_Dito: check the valve')).toBe('CPY_Dito');
    expect(cleanComment('CPY_Dito: check the valve')).toBe('check the valve');
    expect(inferDiscipline('CPY_Dito: PIP to reroute the line')).toBe('PIP');
    expect(inferDiscipline('nothing to see here')).toBe('OTHER');
    // no "Name:" prefix → text is kept as it is
    expect(cleanComment('check the valve')).toBe('check the valve');
  });

  it('skips viewpoints without comments and comments without text', () => {
    resetIdCounter();
    const html = `<html><body>
      ${vp('A', '')}
      ${vp('B', `<div class="comments">${comment(7, 'Approved', 'STR_Budi: STR to add a brace')}${comment(8, 'New', '')}</div>`)}
      ${vp('C', `<div class="comments">${comment(9, 'Pending', 'plain text without a prefix')}</div>`)}
    </body></html>`;
    const { records, viewpointCount } = parseReportHtml(html, 'mini.html');
    expect(viewpointCount).toBe(3);
    expect(records.map((r) => r.commentId)).toEqual(['7', '9']);
    expect(records[0]).toMatchObject({
      ID: 1, viewpoint: 'B', status: 'Closed', rawStatus: 'Approved', commenter: 'STR_Budi', discipline: 'STR',
      commentText: 'STR to add a brace', commentRaw: 'STR_Budi: STR to add a brace',
      commentDate: '2025/1/5 09:3:07', cameraPosition: '1.0m, 2.0m, 3.0m', imageRef: 'B.jpg', authorCode: 'U1',
    });
    expect(records[1]).toMatchObject({ ID: 2, status: 'In Review', commentText: 'plain text without a prefix', commentRaw: 'plain text without a prefix' });
  });

  it('links images to records by file name, ignoring case', () => {
    const recs = [{ imageRef: 'VP0001.JPG', imageData: '' }, { imageRef: 'vp0002.jpg', imageData: '' }, { imageRef: '', imageData: '' }];
    expect(linkImages(recs, { 'vp0001.jpg': 'data:one' })).toBe(1);
    expect(recs.map((r) => r.imageData)).toEqual(['data:one', '', '']);
  });
});
