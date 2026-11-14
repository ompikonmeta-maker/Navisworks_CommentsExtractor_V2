import { describe, it, expect } from 'vitest';
import { headline, perDay } from '../src/lib/headline.js';

const ov = (over) => ({ doneL: 'Closed', total: 747, remaining: 472, target: 1, daysLeft: 65, needed: 7.26, forecast: 2, late: 37, ...over });

describe('the Work headline (option A sentence)', () => {
  it('behind: days late and the pace needed', () => {
    expect(headline(ov())).toEqual({ main: '37 days behind.', sub: 'Close 7.3 a day to finish on time.', tone: 'bad' });
    expect(headline(ov({ late: 1, needed: 12.6 }))).toMatchObject({ main: '1 day behind.', sub: 'Close 13 a day to finish on time.', tone: 'warn' });
  });
  it('on track: early or on the day', () => {
    expect(headline(ov({ late: -4 }))).toEqual({ main: 'On track.', sub: 'At today’s pace you finish 4 days early.', tone: 'good' });
    expect(headline(ov({ late: 0 })).sub).toBe('At today’s pace you finish on the target day.');
  });
  it('no pace yet', () => {
    expect(headline(ov({ forecast: null, late: null }))).toMatchObject({ main: '472 comments to close in 65 days.', sub: 'Close 7.3 a day to finish on time.' });
  });
  it('no target, target today or past', () => {
    expect(headline(ov({ target: null }))).toMatchObject({ main: '472 comments left to close.', sub: 'Set a target date to see the pace you need.' });
    expect(headline(ov({ daysLeft: 0 }))).toMatchObject({ main: 'The target is today.', tone: 'bad' });
    expect(headline(ov({ daysLeft: -3, remaining: 1 }))).toMatchObject({ main: '3 days past the target.', sub: '1 comment still to close.' });
  });
  it('done, or nothing imported', () => {
    expect(headline(ov({ remaining: 0, total: 1 }))).toMatchObject({ main: 'All 1 comment closed.', tone: 'good' });
    expect(headline(ov({ total: 0, remaining: 0 })).main).toBe('No comments yet.');
  });
  it('formats the daily pace', () => {
    expect([perDay(null), perDay(0.25), perDay(9.96), perDay(10.4)]).toEqual(['—', '0.3', '10.0', '10']);
  });
});
