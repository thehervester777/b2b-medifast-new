/*
 * Sample data. The request list is generated from a fixed seed, so it is the same
 * on every load, but all dates are relative to today so the board never looks stale.
 */
const DAY = 86_400_000;

export const COMPANIES = ['ACI Limited', 'Acme', 'Square Pharma', 'Beximco', 'Incepta', 'Renata', 'Labaid Pharma', 'Nipro JMI'];

const MANUFACTURERS = {
  'ACI Limited': 'ACI Limited',
  Acme: 'Acme Laboratories Ltd.',
  'Square Pharma': 'Square Pharmaceuticals PLC',
  Beximco: 'Beximco Pharmaceuticals Ltd.',
  Incepta: 'Incepta Pharmaceuticals Ltd.',
  Renata: 'Renata PLC',
  'Labaid Pharma': 'Labaid Pharmaceuticals Ltd.',
  'Nipro JMI': 'NIPRO JMI Pharma Limited',
};

export const CITIES = ['Dhaka', 'Chattogram', 'Khulna', 'Rajshahi', 'Sylhet', 'Barishal', 'Rangpur', 'Mymensingh', 'Cumilla', 'Gazipur', 'Narayanganj', 'Bogura'];

export const DEMO_ACCOUNT = { email: 'rishu@rpharma.example', password: 'demo1234' };

export const seedUser = () => ({
  name: 'Rishu',
  biz: 'R Pharma',
  email: DEMO_ACCOUNT.email,
  phone: '+8801700000000',
  addr: 'Kodomtoli, Dhaka',
  lic: '028337000123',
  tin: '203938000456',
});

export const seedNotifications = () => [
  { id: 1, icon: 'bolt', title: 'New requests are open', body: 'Fresh requests from ACI Limited, Square Pharma and Incepta are waiting for prices.', when: 'Today' },
  { id: 2, icon: 'shield', title: 'Account verified', body: 'Your drug licence and TIN/BIN were checked. You can quote on every request.', when: 'This week' },
  { id: 3, icon: 'receipt', title: 'Quote not selected', body: 'Your price for Napril 40 tablet was not chosen this time. Open My quotes to see the rank.', when: 'Last month' },
];

const mulberry = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const atHour = (t, h, m = 0) => {
  const d = new Date(t);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

export function buildRequests(now = Date.now()) {
  const R = mulberry(2026);
  const list = [];
  const brands = ['Axodin', 'Zimax', 'Rolac', 'Maxpro', 'Napril', 'Cefix', 'Losectil', 'Fexo', 'Montair', 'Ranidin', 'Esoral', 'Clopid', 'Atova', 'Metfor', 'Amlocard', 'Telmis', 'Pantonix', 'Azithra', 'Ciprofix', 'Neurobal', 'Calbon', 'Dexona', 'Omepra', 'Ibupro', 'Glimep', 'Zolpi', 'Bisoran', 'Tamsul'];
  const generics = ['Paracetamol', 'Omeprazole', 'Atorvastatin', 'Cefixime', 'Montelukast', 'Metformin', 'Amlodipine', 'Azithromycin', 'Esomeprazole', 'Losartan'];
  const doses = ['5', '10', '20', '40', '100', '250', '500'];

  const named = [
    { name: 'Gavinex 20 tablet', generic: 'N/A', co: 'Labaid Pharma', qty: 5, ask: 195, noEnd: true, bids: 0 },
    { name: 'Bilfast 20 tablet', generic: 'N/A', co: 'Nipro JMI', qty: 5, ask: 337, noEnd: false, bids: 2 },
    { name: 'Ticaril 90 tablet', generic: 'N/A', co: 'Square Pharma', qty: 5, ask: 167.7, noEnd: false, bids: 1 },
    { name: 'Lijenta 5 tablet', generic: 'N/A', co: 'Incepta', qty: 5, ask: 245, noEnd: true, bids: 0 },
  ];

  /* How many active requests each company has, shuffled so the board mixes them. */
  const need = { 'ACI Limited': 9, Acme: 6, 'Square Pharma': 10, Beximco: 7, Incepta: 7, Renata: 5, 'Labaid Pharma': 3, 'Nipro JMI': 4 };
  const pool = [];
  Object.keys(need).forEach((c) => {
    for (let i = 0; i < need[c]; i++) pool.push(c);
  });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  let id = 23;
  const make = (base, status) => {
    const bids = base.bids != null ? base.bids : R() < 0.72 ? 0 : 1 + Math.floor(R() * 3);
    const rivals = [];
    for (let k = 0; k < bids; k++) rivals.push(Math.round(base.ask * (1 - R() * 0.1) * 100) / 100);
    const noEnd = base.noEnd !== undefined ? base.noEnd : status === 'Active' && R() < 0.45;

    let postedAt;
    let deadlineAt = null;
    if (status === 'Active') {
      postedAt = atHour(now - (1 + Math.floor(R() * 3)) * DAY, 9 + Math.floor(R() * 8), 41);
      if (!noEnd) deadlineAt = atHour(now + (2 + Math.floor(R() * 18)) * DAY, 18);
    } else if (status === 'Expired') {
      deadlineAt = atHour(now - (1 + Math.floor(R() * 20)) * DAY, 18);
      postedAt = atHour(deadlineAt - 5 * DAY, 11, 15);
    } else {
      postedAt = atHour(now - (6 + Math.floor(R() * 22)) * DAY, 11, 15);
      deadlineAt = atHour(postedAt + 4 * DAY, 18);
    }

    return {
      id: id++,
      name: base.name,
      generic: base.generic,
      co: base.co,
      mfr: MANUFACTURERS[base.co],
      qty: base.qty,
      ask: base.ask,
      status,
      bids,
      rivals,
      noEnd,
      deadlineAt,
      postedAt,
      buyer: 'MediFast Procurement',
      loc: 'MediFast Central Warehouse',
      desc: `B2B inventory replenishment for ${base.name}`,
    };
  };

  named.forEach((n) => list.push(make(n, 'Active')));

  const generate = (status) => {
    const co = status === 'Active' ? pool.pop() : COMPANIES[Math.floor(R() * COMPANIES.length)];
    const brand = brands[Math.floor(R() * brands.length)];
    const dose = doses[Math.floor(R() * doses.length)];
    const form = R() < 0.7 ? 'tablet' : 'capsule';
    const qty = [5, 5, 8, 10, 12, 20][Math.floor(R() * 6)];
    const ask = Math.round((45 + R() * 430) * 2) / 2;
    R(); /* keeps the seeded list stable */
    return make({ name: `${brand} ${dose} ${form}`, generic: generics[Math.floor(R() * generics.length)], co, qty, ask }, status);
  };

  while (pool.length) list.push(generate('Active'));
  for (let i = 0; i < 12; i++) list.push(generate('Completed'));
  for (let i = 0; i < 7; i++) list.push(generate('Expired'));
  return list;
}

/** Earlier quotes, so My quotes is not empty on first sign in. */
export function seedQuotes(now = Date.now()) {
  const at = (days) => now - days * DAY;
  return [
    { req: 22, med: 'Napril 40 tablet', price: 249, qty: 98, status: 'REJECTED', at: at(25), rank: 1 },
    { req: 20, med: 'Cefix 500 capsule', price: 440, qty: 104, status: 'REJECTED', at: at(25), rank: 2 },
    { req: 19, med: 'Omepra 20 capsule', price: 197.8, qty: 96, status: 'REJECTED', at: at(25), rank: 1 },
    { req: 17, med: 'Metfor 500 tablet', price: 312.5, qty: 60, status: 'REJECTED', at: at(26), rank: 3 },
  ];
}
