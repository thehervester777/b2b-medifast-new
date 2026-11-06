'use strict';
const { MIN, HOUR } = require('../lib/time');
const { HttpError } = require('../lib/errors');

/*
 * Brute-force protection kept in the database (so it survives restarts and works with more than one process):
 * 5 failed sign-ins for the same email, or 20 from the same address, within 15 minutes lock that email or address
 * until the oldest of those failures is 15 minutes old.
 */
const WINDOW = 15 * MIN;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 20;

function createLoginGuard(db) {
  const count = async (sql, params) => Number((await db.one(sql, params)).n);
  return {
    async assertOpen(kind, email, ip) {
      const since = new Date(Date.now() - WINDOW);
      const byEmail = email ? await count('SELECT COUNT(*) AS n FROM login_attempts WHERE kind = ? AND email = ? AND at > ?', [kind, email, since]) : 0;
      const byIp = ip ? await count('SELECT COUNT(*) AS n FROM login_attempts WHERE kind = ? AND ip = ? AND at > ?', [kind, ip, since]) : 0;
      if (byEmail >= MAX_PER_EMAIL || byIp >= MAX_PER_IP) {
        throw new HttpError(429, 'locked', 'Too many failed attempts. Please wait 15 minutes and try again.');
      }
    },
    async fail(kind, email, ip) {
      await db.run('INSERT INTO login_attempts (kind, email, ip, at) VALUES (?, ?, ?, ?)', [kind, email || '', ip || '', new Date()]);
      if (Math.random() < 0.05) await db.run('DELETE FROM login_attempts WHERE at < ?', [new Date(Date.now() - HOUR)]);
    },
    async clear(kind, email) {
      await db.run('DELETE FROM login_attempts WHERE kind = ? AND email = ?', [kind, email]);
    },
    /** Public sign-up form: at most 10 per hour from one address. */
    async assertSignupRoom(ip) {
      const n = await count('SELECT COUNT(*) AS n FROM login_attempts WHERE kind = ? AND ip = ? AND at > ?', ['signup', ip || '', new Date(Date.now() - HOUR)]);
      if (n >= 10) throw new HttpError(429, 'locked', 'Too many sign-up requests from this connection. Please try again later.');
    },
  };
}
module.exports = { createLoginGuard };
