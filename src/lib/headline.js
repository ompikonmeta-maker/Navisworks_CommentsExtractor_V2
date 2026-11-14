// The one sentence on top of Work (from mockup option A): how far behind or
// ahead the review is, and what that means per day. Pure, from computeOverview.
//   → { main, sub, tone: 'good' | 'warn' | 'bad' | null }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const perDay = (n) => (n == null ? '—' : n < 10 ? n.toFixed(1) : String(Math.round(n)));

export function headline(ov) {
  const done = String(ov.doneL || 'Closed').toLowerCase();
  if (!ov.total) return { main: 'No comments yet.', sub: 'Import a Navisworks report to start.', tone: null };
  if (ov.remaining === 0) return { main: `All ${plural(ov.total, 'comment')} ${done}.`, sub: 'Nothing left to close.', tone: 'good' };
  if (ov.target == null) return { main: `${plural(ov.remaining, 'comment')} left to close.`, sub: 'Set a target date to see the pace you need.', tone: null };
  if (ov.daysLeft <= 0) {
    return {
      main: ov.daysLeft === 0 ? 'The target is today.' : `${plural(-ov.daysLeft, 'day')} past the target.`,
      sub: `${plural(ov.remaining, 'comment')} still to close.`,
      tone: 'bad',
    };
  }
  const need = `Close ${perDay(ov.needed)} a day to finish on time.`;
  if (ov.forecast == null) return { main: `${plural(ov.remaining, 'comment')} to close in ${plural(ov.daysLeft, 'day')}.`, sub: need, tone: null };
  // A pace measured on a handful of close-outs can put the finish years out;
  // past a year the exact count says nothing useful.
  if (ov.late > 365) return { main: 'Over a year behind.', sub: need, tone: 'bad' };
  if (ov.late > 0) return { main: `${plural(ov.late, 'day')} behind.`, sub: need, tone: ov.late > 14 ? 'bad' : 'warn' };
  return {
    main: 'On track.',
    sub: ov.late < 0 ? `At today’s pace you finish ${plural(-ov.late, 'day')} early.` : 'At today’s pace you finish on the target day.',
    tone: 'good',
  };
}
