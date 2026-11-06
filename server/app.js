'use strict';
/*
 * Startup file for cPanel's "Setup Node.js App" (Passenger) and for `npm start`.
 * It reads the settings, connects to the database and starts the web server.
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { load, ConfigError } = require('./src/config');
const { createDb } = require('./src/db');
const { createApp } = require('./src/http/app');
const { createLogger } = require('./src/lib/log');
const { expireRequests } = require('./src/rules/sweep');

async function main() {
  const cfg = load();
  const logger = createLogger(cfg.logDir);
  const db = createDb(cfg.db);
  try {
    await db.one('SELECT 1');
    const ok = await db.one("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'meta'");
    if (!Number(ok.n)) throw new Error('The database is empty. Import database/schema.sql in phpMyAdmin first (see docs/INSTALL.md).');
  } catch (err) {
    logger.error(err, 'startup');
    console.error(`Cannot start: ${err.message}`);
    process.exit(1);
  }
  const app = createApp({ db, cfg, logger });

  const timer = setInterval(() => expireRequests(db).catch((e) => logger.error(e, 'sweep')), 5 * 60 * 1000);
  timer.unref();

  // Under Passenger the port you pass here is replaced by Passenger's own; locally it is the real port.
  const server = app.listen(cfg.port || 3000);
  server.on('listening', () => {
    const addr = server.address();
    if (addr && addr.port) console.log(`MediFast is running on port ${addr.port}`);
  });
  const stop = () => server.close(() => db.close().finally(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`Cannot start: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
