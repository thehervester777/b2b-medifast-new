'use strict';
const { sha256, newToken } = require('../lib/security');
const { parseCookies, serialize } = require('./cookies');
const { HOUR, DAY, MIN } = require('../lib/time');

const NAMES = { admin: 'mf_admin', supplier: 'mf_supplier' };
/* admin: 12 hours, renewed while in use. supplier: 30 days if "keep me signed in", otherwise 24 hours. */
const lifetime = (kind, remember) => (kind === 'admin' ? 12 * HOUR : remember ? 30 * DAY : DAY);

function createSessions(db, cfg) {
  const cookieOpts = (kind, remember) => ({ secure: cfg.secureCookies, maxAgeMs: kind === 'admin' || remember ? lifetime(kind, remember) : null });

  return {
    names: NAMES,

    async create(res, kind, actorId, { remember = false, ip = null, ua = '' } = {}) {
      const token = newToken();
      const expires = new Date(Date.now() + lifetime(kind, remember));
      await db.run('INSERT INTO sessions (token_hash, actor_type, actor_id, expires_at, remember, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        sha256(token),
        kind,
        actorId,
        expires,
        remember ? 1 : 0,
        ip,
        String(ua).slice(0, 255),
        new Date(),
      ]);
      res.append('Set-Cookie', serialize(NAMES[kind], token, cookieOpts(kind, remember)));
      return token;
    },

    /** The live session for this request's cookie, or null. Renews it when it is more than five minutes old. */
    async find(req, res, kind) {
      const token = parseCookies(req.headers.cookie)[NAMES[kind]];
      if (!token || token.length > 100) return null;
      const row = await db.one('SELECT * FROM sessions WHERE token_hash = ? AND actor_type = ? AND expires_at > ?', [sha256(token), kind, new Date()]);
      if (!row) return null;
      const life = lifetime(kind, !!row.remember);
      if (row.expires_at.getTime() - Date.now() < life - 5 * MIN) {
        await db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', [new Date(Date.now() + life), row.id]);
        if (kind === 'admin' || row.remember) res.append('Set-Cookie', serialize(NAMES[kind], token, cookieOpts(kind, !!row.remember)));
      }
      return { id: row.id, hash: row.token_hash, actorId: row.actor_id };
    },

    async destroyCurrent(req, res, kind) {
      const token = parseCookies(req.headers.cookie)[NAMES[kind]];
      if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
      res.append('Set-Cookie', serialize(NAMES[kind], '', { secure: cfg.secureCookies, maxAgeMs: 0 }));
    },

    /** Sign an account out everywhere, optionally keeping the session making the request. */
    async destroyAll(c, kind, actorId, keepHash = null) {
      if (keepHash) await c.run('DELETE FROM sessions WHERE actor_type = ? AND actor_id = ? AND token_hash <> ?', [kind, actorId, keepHash]);
      else await c.run('DELETE FROM sessions WHERE actor_type = ? AND actor_id = ?', [kind, actorId]);
    },
  };
}
module.exports = { createSessions };
