import { state, me } from '../core/store.js';
import { act } from './act.js';

/*
 * Admin access: who can sign in, what each role may do, and the site-wide notice and
 * maintenance switches. Each action returns an undo function, like every other change.
 */
export const memberById = (id) => state.team.find((t) => t.id === Number(id));
export const ownerCount = () => state.team.filter((t) => t.role === 'Owner' && t.active !== false).length;

/** Give a role a permission, or take it away. The Owner role always keeps everything. */
export function setRolePerm(role, key, on) {
  if (role === 'Owner') return null;
  const had = (state.roles[role] || []).includes(key);
  if (had === on) return null;
  return act('patch', `/admin/roles/${encodeURIComponent(role)}`, { key, on });
}

/** Switch an admin account on or off. Nobody can switch themselves off, or the last Owner. */
export function setMemberActive(id, active) {
  const t0 = memberById(id);
  if (!t0 || t0.id === me().id) return null;
  if (!active && t0.role === 'Owner' && ownerCount() <= 1) return null;
  return act('patch', `/admin/team/${t0.id}`, { active });
}

export function removeMember(id) {
  const t0 = memberById(id);
  if (!t0 || t0.id === me().id) return null;
  if (t0.role === 'Owner' && ownerCount() <= 1) return null;
  return act('del', `/admin/team/${t0.id}`);
}

/** Add an admin. The answer holds a temporary password to hand over once: { id, password }. */
export const inviteAdmin = ({ name, email, role }) => act('post', '/admin/team', { name, email, role });
export const setRole = (id, role) => act('patch', `/admin/team/${Number(id)}`, { role });
export const resetMemberPassword = (id) => act('post', `/admin/team/${Number(id)}/reset-password`);

/* ============================== site notice and maintenance ============================== */
export const updateNotice = (patch) => act('patch', '/admin/site/notice', patch);
export const updateMaintenance = (patch) => act('patch', '/admin/site/maintenance', patch);

/** Is the notice showing right now, and for whom? audience: 'suppliers' | 'admins' | 'all'. */
export function noticeLive(now = Date.now()) {
  const n = state.site.notice;
  if (!n.on) return false;
  if (!n.scheduled) return true;
  return (!n.startAt || now >= n.startAt) && (!n.endAt || now <= n.endAt);
}
export const noticeFor = (who, now = Date.now()) => noticeLive(now) && (state.site.notice.audience === 'all' || state.site.notice.audience === who);

export function maintenanceLive(now = Date.now()) {
  const m = state.site.maintenance;
  if (m.mode === 'now') return true;
  if (m.mode === 'scheduled') return !!m.startAt && now >= m.startAt && (!m.endAt || now <= m.endAt);
  return false;
}
