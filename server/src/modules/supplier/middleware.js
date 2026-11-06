'use strict';
const { HttpError, unauthorized } = require('../../lib/errors');
const { clientCtx } = require('../../http/middleware');
const { loadSite, maintenanceLive } = require('../../rules/site');

/** Loads the signed-in supplier onto req.supplier. Only Verified suppliers may use the app, and one with a temporary password must replace it first. */
function requireSupplier({ db, sessions }, { allowMaintenance = false, allowMustChange = false } = {}) {
  return async (req, res, next) => {
    const sess = await sessions.find(req, res, 'supplier');
    if (!sess) return next(unauthorized());
    const s = await db.one('SELECT * FROM suppliers WHERE id = ?', [sess.actorId]);
    if (!s) return next(unauthorized());
    if (s.status !== 'Verified') return next(new HttpError(403, 'not_active', s.status === 'Pending' ? 'Your account is still waiting for approval.' : 'This account has been suspended.'));
    if (!allowMaintenance) {
      const site = await loadSite(db);
      if (maintenanceLive(site.maintenance)) return next(new HttpError(503, 'maintenance', site.maintenance.message || 'We are updating the app. Please check back soon.'));
    }
    if (s.must_change_password && !allowMustChange) return next(new HttpError(403, 'must_change_password', 'Choose a new password before you continue.'));
    req.supplier = s;
    req.ctx = { actorType: 'supplier', actorId: s.id, actorName: s.name, ...clientCtx(req) };
    req.sessionHash = sess.hash;
    next();
  };
}
module.exports = { requireSupplier };
