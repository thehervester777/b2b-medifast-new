import { state } from '../core/store.js';

/*
 * Carts. A supplier fills a cart in the supplier app and submits it, so what one supplier sent
 * belongs together: one supplier, a list of medicines (3 to 30 is normal). The panel shows that
 * list as ONE entry headed by the supplier's name, with the medicines inside, instead of one
 * loose line per medicine.
 *
 * A quote carries a `sub` (submission id) when the supplier app provides one, and then the cart
 * is that submission. Without it the cart is simply everything the supplier has sent, which never
 * moves when a quote is approved or rejected. A cart holds at most CART_MAX medicines, so a long
 * list continues as "list 2". Keys are plain letters, digits and hyphens so they can sit in a #hash.
 */
export const CART_MAX = 30;

const digits = (id) => String(id).replace(/\D/g, '') || 'X';
const baseKey = (supplierId, sub) => (sub ? `S${sub}` : String(supplierId));

function metaOf(key, supplierId, sub, part) {
  return {
    key: part > 1 ? `${key}-p${part}` : key,
    supplierId,
    part,
    sub: sub || null,
    code: `CT-${sub || digits(supplierId)}${part > 1 ? `-${part}` : ''}`,
  };
}

/** quote id -> cart meta, for every quote the panel holds. Cheap enough to build once per paint. */
export function cartIndex() {
  const groups = new Map();
  state.quotes.forEach((q) => {
    const k = baseKey(q.supplierId, q.sub);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(q);
  });
  const idx = new Map();
  groups.forEach((items, k) => {
    items.sort((a, b) => a.at - b.at || a.id - b.id);
    for (let i = 0; i < items.length; i += CART_MAX) {
      const first = items[i];
      const meta = metaOf(k, first.supplierId, first.sub, i / CART_MAX + 1);
      items.slice(i, i + CART_MAX).forEach((q) => idx.set(q.id, meta));
    }
  });
  return idx;
}

export const cartOfQuote = (q, idx) => idx.get(q.id) || metaOf(baseKey(q.supplierId, q.sub), q.supplierId, q.sub, 1);

/** An order sits in the cart its quote came from. */
export const cartOfOrder = (o, idx) => idx.get(o.quoteId) || metaOf(baseKey(o.supplierId, null), o.supplierId, null, 1);

/** Group a flat list into carts, keeping the order carts first appear in. */
export function groupCarts(items, metaFor) {
  const out = new Map();
  items.forEach((it) => {
    const m = metaFor(it);
    if (!out.has(m.key)) out.set(m.key, { ...m, items: [] });
    out.get(m.key).items.push(it);
  });
  return [...out.values()];
}

/** [[status, count], ...] in the order statuses first appear in `order`. */
export function statusMix(items, order) {
  const c = new Map();
  items.forEach((x) => c.set(x.status, (c.get(x.status) || 0) + 1));
  return order.filter((s) => c.has(s)).map((s) => [s, c.get(s)]);
}

/** One whole cart by its key: the supplier, and every quote or order in it. null when it no longer exists. */
export function findCart(kind, key) {
  const idx = cartIndex();
  const items = kind === 'order' ? state.orders.filter((o) => cartOfOrder(o, idx).key === key) : state.quotes.filter((q) => cartOfQuote(q, idx).key === key);
  if (!items.length) return null;
  const meta = kind === 'order' ? cartOfOrder(items[0], idx) : cartOfQuote(items[0], idx);
  return { ...meta, items };
}
