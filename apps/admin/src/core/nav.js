import { can } from './store.js';

/*
 * The pages of the panel, in sidebar order. Each page names the permission needed to open it;
 * the sidebar, the command palette and the router all read this one list.
 *   { section } is a small heading, not a page.
 */
export const NAV = [
  { section: 'Workspace' },
  { key: 'overview', label: 'Dashboard', icon: 'grid', perm: 'dashboard.view' },
  { key: 'requests', label: 'Requests', icon: 'requests', perm: 'requests.view', badge: 'pending', tone: 'red' },
  { key: 'orders', label: 'Orders', icon: 'truck', perm: 'orders.view', badge: 'openOrders', tone: 'soft' },
  { section: 'Catalogue' },
  { key: 'products', label: 'Products', icon: 'box', perm: 'products.view', badge: 'restock', tone: 'red' },
  { key: 'suppliers', label: 'Suppliers', icon: 'building', perm: 'suppliers.view', badge: 'awaiting', tone: 'red' },
  { section: 'Insights' },
  { key: 'reports', label: 'Reports', icon: 'chart', perm: 'reports.view' },
  { key: 'audit', label: 'Audit logs', icon: 'activity', perm: 'audit.view' },
  { section: 'System' },
  { key: 'access', label: 'Admin access', icon: 'key', perm: 'access.manage' },
  { key: 'site', label: 'Notice & maintenance', icon: 'megaphone', perm: 'site.manage' },
  { key: 'preferences', label: 'Settings', icon: 'tune', perm: 'settings.manage' },
];

export const PAGES = NAV.filter((n) => n.key);
export const pageOf = (key) => PAGES.find((n) => n.key === key);
/** The first page this admin may open. */
export const homePath = () => (PAGES.find((n) => can(n.perm)) || { key: 'overview' }).key;
