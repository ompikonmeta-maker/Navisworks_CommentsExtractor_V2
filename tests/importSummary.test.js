// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseReportHtml } from '../src/lib/parser.js';
import { planMerge } from '../src/lib/merge.js';
import { summarizeImport, addToLog, markUndone, IMPORT_LOG_MAX } from '../src/lib/importSummary.js';

const html = fs.readFileSync(path.resolve(__dirname, '../src/sample/report.html'), 'utf8');
const recs = parseReportHtml(html).records;

describe('summarizeImport (the sample report)', () => {
  const s = summarizeImport(recs, { fileName: 'report.html', stats: { images: 5 }, by: 'admin', at: '2026-11-23T09:00:00.000Z' });

  it('counts what the report holds', () => {
    expect(s).toMatchObject({ comments: 747, viewpoints: 260, file: 'report.html', images: 5, by: 'admin', from: '2024-12-09', to: '2025-10-02', merge: null, undone: false });
    expect(s.checks).toMatchObject({ unassigned: 274, noCommenter: 154, dupIds: 0, empty: 0 });
    expect(s.disciplines[0]).toEqual(['OTHER', 274]);
    expect(s.parties[0][0]).toBe('CPY');
    expect(s.people[0]).toEqual(['CPY_Jefry', 73]);
  });

  it('builds a month timeline with the empty months and finds the sessions', () => {
    expect(s.months[0][0]).toBe('2024-12');
    expect(s.months.at(-1)[0]).toBe('2025-10');
    expect(s.months).toHaveLength(11);
    expect(s.months.reduce((t, [, n]) => t + n, 0)).toBe(747);
    expect(s.sessions).toBe(5); // Dec · Apr · late May–Jun · early Sep · end Sep–Oct (gaps over 7 days)
    expect(s.busiestDay).toEqual({ day: '2025-04-21', n: 83 });
  });

  it('notes a re-import', () => {
    const plan = planMerge(recs, recs);
    expect(summarizeImport(recs, { plan }).merge).toMatchObject({ added: 0, matched: 747, missing: 0 });
  });
});

describe('import log', () => {
  it('keeps the newest first, no duplicates, at most the limit, and marks undone', () => {
    let log = [];
    for (let i = 0; i < IMPORT_LOG_MAX + 5; i++) log = addToLog(log, { id: `imp-${i}` });
    expect(log).toHaveLength(IMPORT_LOG_MAX);
    expect(log[0].id).toBe(`imp-${IMPORT_LOG_MAX + 4}`);
    log = addToLog(log, { id: log[3].id, again: true });
    expect(log[0].again).toBe(true);
    expect(log.filter((x) => x.id === log[0].id)).toHaveLength(1);
    expect(markUndone(log, log[1].id)[1].undone).toBe(true);
  });
});
