'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

/** 12 characters without look-alikes (no 0/O, 1/l/I). */
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function makeHasher(cost) {
  // A hash of a random string: compared against when the email is unknown, so a wrong email and a wrong password take the same time.
  const dummy = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), cost);
  return {
    hash: (plain) => bcrypt.hash(plain, cost),
    async check(plain, hash) {
      return bcrypt.compare(plain, hash || dummy).then((ok) => ok && !!hash);
    },
  };
}

/** "Chrome on Windows" from a User-Agent string. Only used to label sessions in the audit log. */
function deviceOf(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown device';
  return `${browser} on ${os}`;
}

module.exports = { sha256, newToken, tempPassword, makeHasher, deviceOf };
