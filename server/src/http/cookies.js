'use strict';
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function serialize(name, value, { maxAgeMs, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
module.exports = { parseCookies, serialize };
