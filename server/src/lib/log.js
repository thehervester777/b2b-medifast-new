'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Errors go to a file on the server (never to the browser). Failure to write a log must never break a request. */
function createLogger(dir, quiet = false) {
  let ready = false;
  const file = path.join(dir, 'error.log');
  return {
    error(err, where = '') {
      const line = `${new Date().toISOString()} ${where} ${err && err.stack ? err.stack : String(err)}\n`;
      if (!quiet) console.error(line.trim());
      try {
        if (!ready) {
          fs.mkdirSync(dir, { recursive: true });
          ready = true;
        }
        fs.appendFileSync(file, line);
      } catch (e) {
        /* read-only disk: console output is all there is */
      }
    },
  };
}
module.exports = { createLogger };
