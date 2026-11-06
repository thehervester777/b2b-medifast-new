/* Formatters are built once; Intl construction is slow and lists call these many times. */
const NF0 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const NF2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** ৳195 or ৳167.70 */
export const money = (n) => '৳' + (Number.isInteger(+n) ? NF0 : NF2).format(+n);
/** Always two decimals: ৳195.00 */
export const money2 = (n) => '৳' + NF2.format(+n);
/** For PDFs, where the Taka glyph is not in the built-in fonts. */
export const bdt = (n) => 'BDT ' + NF2.format(+n);

export const fmtShort = (t) => SHORT.format(t);
export const fmtDateTime = (t) => `${DATE.format(t)} · ${TIME.format(t)}`;
export const fmtWhen = (t) => `${DATE.format(t)} at ${TIME.format(t)}`;

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "Ends Nov 12" or "No end date" for a request. */
export const closeLabel = (r) => (r.deadlineAt ? 'Ends ' + SHORT.format(r.deadlineAt) : 'No end date');

/** "Paracetamol • Square Pharma", or just the company when the generic name is unknown. */
export const reqSub = (r) => [r.generic && r.generic !== 'N/A' ? r.generic : '', r.co].filter(Boolean).join(' • ');
