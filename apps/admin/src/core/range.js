/*
 * Date ranges shared by the dashboard, orders, audit log and reports.
 * Everything is in the viewer's local time, from 00:00 to 23:59:59 of each day.
 */
const DAY = 86_400_000;

export const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const endOfDay = (t) => {
  const d = new Date(t);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

const pad = (n) => String(n).padStart(2, '0');
/** "2026-11-06", the format a date input uses. */
export const ymd = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** A date input's value to a timestamp (start or end of that day). Empty gives null. */
export const fromYmd = (s, end = false) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
};

export const QUICK = [
  ['all', 'All time'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', 'Last 7 days'],
  ['month', 'This month'],
  ['last-month', 'Last month'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
];

/** { from, to } in ms for a quick range key, or null for "all time". */
export function rangeOf(key, now = Date.now()) {
  const today = startOfDay(now);
  const d = new Date(now);
  switch (key) {
    case 'today':
      return { from: today, to: endOfDay(now) };
    case 'yesterday':
      return { from: today - DAY, to: today - 1 };
    case '7d':
      return { from: startOfDay(now - 6 * DAY), to: endOfDay(now) };
    case '30d':
      return { from: startOfDay(now - 29 * DAY), to: endOfDay(now) };
    case '90d':
      return { from: startOfDay(now - 89 * DAY), to: endOfDay(now) };
    case 'month':
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: endOfDay(now) };
    case 'last-month':
      return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1 };
    default:
      return null;
  }
}

/** A readable label for a range, e.g. "Nov 1 to Nov 6". */
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const FULL = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const rangeLabel = (from, to) => (from && to ? `${SHORT.format(from)} to ${FULL.format(to)}` : 'All time');
