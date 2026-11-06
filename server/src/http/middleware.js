'use strict';
const { HttpError, unauthorized, forbidden } = require('../lib/errors');
const { deviceOf } = require('../lib/security');
const { ALL_PERMS } = require('../rules/perms');
const { MIN } = require('../lib/time');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks cross-site form posts. A browser will not add a custom header to a cross-site request
 * without the server's permission, and the Origin of a real request must match this site.
 */
function csrf(cfg) {
  const own = cfg.appUrl ? new URL(cfg.appUrl).host : null;
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    if (req.get('x-mf') !== '1') return next(new HttpError(403, 'csrf', 'This request was blocked. Reload the page and try again.'));
    const origin = req.get('origin');
    if (origin) {
      let host = null;
      try {
        host = new URL(origin).host;
      } catch (e) {
        /* malformed origin is rejected below */
      }
      if (!host || (host !== req.get('host') && host !== own)) return next(new HttpError(403, 'csrf', 'This request was blocked. Reload the page and try again.'));
    }
    next();
  };
}

/** Everything that must never be cached by a browser or proxy: API answers. */
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function clientCtx(req) {
  return { ip: req.ip || null, device: deviceOf(req.get('user-agent') || '') };
}

/** Loads the signed-in admin onto req.admin, or answers 401. */
function requireAdmin({ db, sessions }, { allowMustChange = false } = {}) {
  return async (req, res, next) => {
    const sess = await sessions.find(req, res, 'admin');
    if (!sess) return next(unauthorized());
    const a = await db.one('SELECT a.*, r.name AS role_name, r.permissions AS role_permissions FROM admins a JOIN roles r ON r.id = a.role_id WHERE a.id = ?', [sess.actorId]);
    if (!a || !a.active) return next(unauthorized('This account is not active.'));
    let perms;
    if (a.role_name === 'Owner') perms = ALL_PERMS;
    else {
      try {
        perms = JSON.parse(a.role_permissions).filter((p) => ALL_PERMS.includes(p));
      } catch (e) {
        perms = [];
      }
    }
    req.admin = { id: a.id, name: a.name, email: a.email, role: a.role_name, roleId: a.role_id, perms: new Set(perms), mustChange: !!a.must_change_password, sessionHash: sess.hash };
    req.ctx = { actorType: 'admin', actorId: a.id, actorName: a.name, ...clientCtx(req) };
    if (!a.last_seen_at || Date.now() - a.last_seen_at.getTime() > MIN) {
      await db.run('UPDATE admins SET last_seen_at = ?, last_ip = ?, last_device = ? WHERE id = ?', [new Date(), req.ctx.ip, req.ctx.device, a.id]);
    }
    if (a.must_change_password && !allowMustChange) return next(new HttpError(403, 'must_change_password', 'Choose a new password before you continue.'));
    next();
  };
}

/** Route guard: the admin's role must include this permission (any of several). */
const need = (...perms) => (req, res, next) => {
  if (perms.some((p) => req.admin.perms.has(p))) return next();
  next(forbidden());
};

module.exports = { csrf, noStore, clientCtx, requireAdmin, need };
