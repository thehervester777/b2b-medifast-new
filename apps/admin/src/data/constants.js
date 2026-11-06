/*
 * Fixed lists the panel needs. None of this is business data: it is the set of rules the server also enforces
 * (permission keys, rejection reasons) and a starting list of company names for the request form.
 */

/** Pharmaceutical companies offered in the request form. Anything already used in your data is added to this list. */
export const COMPANIES = ['ACI Limited', 'Acme', 'Square Pharma', 'Beximco', 'Incepta', 'Renata', 'Labaid Pharma', 'Nipro JMI', 'Beacon Pharma', 'Albion Labs', 'Opsonin Pharma', 'Eskayef'];

/** Reasons offered when rejecting a quote. */
export const REJECT_REASONS = [
  'Price above the asking price',
  'Quantity above the request',
  'Supplier not verified',
  'Duplicate quote',
  'Another quote was awarded',
  'Request closed',
  'Other',
];

/* ---------- admin access ---------- */
export const PERMS = [
  { group: 'Dashboard', items: [{ key: 'dashboard.view', label: 'See the dashboard' }] },
  {
    group: 'Procurement',
    items: [
      { key: 'requests.view', label: 'See requests' },
      { key: 'requests.manage', label: 'Post, edit and close requests' },
      { key: 'quotes.view', label: 'See quotes' },
      { key: 'quotes.decide', label: 'Approve, reject and award quotes' },
      { key: 'orders.view', label: 'See orders' },
      { key: 'orders.manage', label: 'Update order status' },
      { key: 'orders.documents', label: 'Print invoices and warehouse papers' },
    ],
  },
  {
    group: 'Catalogue',
    items: [
      { key: 'products.view', label: 'See products' },
      { key: 'products.manage', label: 'Add and edit products' },
      { key: 'products.send', label: 'Send products to the supplier app' },
      { key: 'suppliers.view', label: 'See suppliers' },
      { key: 'suppliers.manage', label: 'Verify and suspend suppliers' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { key: 'reports.view', label: 'See reports' },
      { key: 'reports.export', label: 'Export reports' },
      { key: 'audit.view', label: 'See audit logs' },
    ],
  },
  {
    group: 'System',
    items: [
      { key: 'site.manage', label: 'Change the site notice and maintenance mode' },
      { key: 'settings.manage', label: 'Change settings' },
      { key: 'access.manage', label: 'Manage admins and roles' },
    ],
  },
];
export const ALL_PERMS = PERMS.flatMap((g) => g.items.map((i) => i.key));
export const PERM_LABEL = Object.fromEntries(PERMS.flatMap((g) => g.items.map((i) => [i.key, i.label])));
export const ROLE_NAMES = ['Owner', 'Manager', 'Reviewer', 'Warehouse', 'Finance'];
export const ROLE_INFO = {
  Owner: 'Full control, including admins and roles.',
  Manager: 'Runs procurement day to day. Cannot manage admins or settings.',
  Reviewer: 'Decides quotes and keeps an eye on requests and orders.',
  Warehouse: 'Moves orders along and prints warehouse papers.',
  Finance: 'Reads orders and reports, and prints invoices.',
};
