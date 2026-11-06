/* Formatters are built once; Intl construction is slow and tables call these many times. */
const NF0 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const NF2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const DAY_MS = 86_400_000;

/** ৳195 or ৳167.70 */
export const money = (n) => '৳' + (Number.isInteger(+n) ? NF0 : NF2).format(+n);
/** Always two decimals: ৳195.00 */
export const money2 = (n) => '৳' + NF2.format(+n);
/** Whole taka, for totals: ৳1,24,000 style is avoided on purpose; plain thousands separators read the same everywhere. */
export const taka = (n) => '৳' + INT.format(Math.round(+n));
export const int = (n) => INT.format(Math.round(+n));

export const fmtDate = (t) => DATE.format(t);
export const fmtShort = (t) => SHORT.format(t);
export const fmtTime = (t) => TIME.format(t);
export const fmtDateTime = (t) => `${SHORT.format(t)}, ${TIME.format(t)}`;
export const fmtLong = (t = Date.now()) => LONG.format(t);

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "5m ago", "3h ago", "2d ago", then a plain date. */
export function ago(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 8) return `${d}d ago`;
  return SHORT.format(t);
}

/** Whole days between two timestamps, rounded down. */
export const daysBetween = (a, b = Date.now()) => Math.floor((b - a) / DAY_MS);

/** "Ends Nov 12" or "No end date" for a request. */
export const closeLabel = (r) => {
  if (r.status === 'Completed') return 'Awarded';
  if (r.noEnd || !r.deadlineAt) return 'No end date';
  return (r.status === 'Expired' ? 'Closed ' : 'Ends ') + SHORT.format(r.deadlineAt);
};

/** Signed percentage: +4.2% / -12% */
export const signedPct = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}%`;

export const greeting = (d = new Date()) => {
  const h = d.getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** "Paracetamol • Square Pharma", or just the company when the generic name is unknown. */
export const reqSub = (r) => (r.generic && r.generic !== 'N/A' ? `${r.generic} • ${r.co}` : r.co);

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
