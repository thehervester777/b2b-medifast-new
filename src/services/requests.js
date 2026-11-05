import { requests, ui } from '../core/store.js';

export const SORTS = [
  { id: 'default', label: 'Default order', short: 'Default', k: '', dir: 1 },
  { id: 'ask-asc', label: 'Asking price: low to high', short: 'Price low', k: 'ask', dir: 1 },
  { id: 'ask-desc', label: 'Asking price: high to low', short: 'Price high', k: 'ask', dir: -1 },
  { id: 'qty-asc', label: 'Boxes: fewest first', short: 'Fewest boxes', k: 'qty', dir: 1 },
  { id: 'qty-desc', label: 'Boxes: most first', short: 'Most boxes', k: 'qty', dir: -1 },
  { id: 'bids-asc', label: 'Bids: fewest first', short: 'Fewest bids', k: 'bids', dir: 1 },
  { id: 'bids-desc', label: 'Bids: most first', short: 'Most bids', k: 'bids', dir: -1 },
];

export const currentSort = () => SORTS.find((s) => s.k === ui.sort.k && s.dir === ui.sort.dir) || SORTS[0];

/** How many filter groups are switched on (price counts once, whichever ends are set). */
export function activeFilterCount() {
  const f = ui.filters;
  return (f.min !== '' || f.max !== '' ? 1 : 0) + (f.end !== 'any' ? 1 : 0) + (f.bids !== 'any' ? 1 : 0) + (f.qty !== 'any' ? 1 : 0);
}

function passes(r, f) {
  if (f.min !== '' && r.ask < Number(f.min)) return false;
  if (f.max !== '' && r.ask > Number(f.max)) return false;
  if (f.end === 'set' && r.noEnd) return false;
  if (f.end === 'none' && !r.noEnd) return false;
  if (f.bids === 'none' && r.bids > 0) return false;
  if (f.bids === 'some' && !r.bids) return false;
  if (f.qty === 's' && r.qty > 5) return false;
  if (f.qty === 'm' && (r.qty < 6 || r.qty > 10)) return false;
  if (f.qty === 'l' && r.qty < 11) return false;
  return true;
}

/** The board's current result list: status, company, search, filters, then sort. */
export function filtered() {
  const text = ui.search.trim().toLowerCase();
  let list = requests.filter(
    (r) =>
      r.status === ui.status &&
      (ui.co === 'All' || r.co === ui.co) &&
      (!text || `${r.name} ${r.co} ${r.generic}`.toLowerCase().includes(text)) &&
      passes(r, ui.filters)
  );
  const { k, dir } = ui.sort;
  if (k) list = list.slice().sort((a, b) => (a[k] - b[k]) * dir);
  return list;
}

/** Per-company counts inside the selected status tab. */
export function companyCounts(companies) {
  const base = requests.filter((r) => r.status === ui.status);
  const counts = { All: base.length };
  companies.forEach((c) => {
    counts[c] = base.filter((r) => r.co === c).length;
  });
  return counts;
}
