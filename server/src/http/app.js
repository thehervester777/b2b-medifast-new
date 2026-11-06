'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { HttpError } = require('../lib/errors');
const { csrf, noStore } = require('./middleware');
const { createSessions } = require('./sessions');
const { createLoginGuard } = require('./loginGuard');
const { makeHasher } = require('../lib/security');
const { publicRouter } = require('../modules/public');
const { adminRouter } = require('../modules/admin');
const { supplierRouter } = require('../modules/supplier');

/** Builds the Express app. Everything it needs comes in as arguments so tests can run it against a test database. */
function createApp({ db, cfg, logger }) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-src': ["'self'", 'blob:'],
          'worker-src': ["'self'", 'blob:'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      strictTransportSecurity: cfg.secureCookies ? { maxAge: 15552000 } : false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    })
  );

  const sessions = createSessions(db, cfg);
  const hasher = makeHasher(cfg.bcryptCost);
  const guard = createLoginGuard(db);
  const deps = { db, cfg, sessions, hasher, guard, logger };

  /* ---------- JSON API ---------- */
  const api = express.Router();
  api.use(noStore);
  api.use(express.json({ limit: '100kb' }));
  api.use(csrf(cfg));
  api.use(publicRouter(deps));
  api.use('/admin', adminRouter(deps));
  api.use('/supplier', supplierRouter(deps));
  api.use((req, res, next) => next(new HttpError(404, 'not_found', 'There is nothing at this address.')));
  app.use('/api', api);

  /* ---------- first-run page ---------- */
  const pub = path.join(__dirname, '..', '..', 'public');
  app.get('/setup', async (req, res, next) => {
    try {
      const n = Number((await db.one('SELECT COUNT(*) AS n FROM admins')).n);
      if (n > 0) return next();
      res.set('Cache-Control', 'no-store').sendFile(path.join(pub, 'setup.html'));
    } catch (e) {
      next(e);
    }
  });
  app.get('/setup.js', (req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(pub, 'setup.js')));

  /* ---------- the two apps (built files) ---------- */
  const mount = (urlPath, dir) => {
    const root = path.join(cfg.appsDir, dir, 'dist');
    /* /admin -> /admin/ (Express treats both spellings as the same route, so check the exact path) */
    app.get(urlPath, (req, res, next) => (req.path === urlPath ? res.redirect(301, urlPath + '/') : next()));
    app.use(
      urlPath + '/',
      express.static(root, {
        index: 'index.html',
        setHeaders(res, file) {
          if (/[\\/]assets[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
          else res.set('Cache-Control', 'no-cache');
        },
      })
    );
  };
  mount('/admin', 'admin');
  app.use(
    express.static(path.join(cfg.appsDir, 'supplier', 'dist'), {
      index: 'index.html',
      setHeaders(res, file) {
        if (/[\\/]assets[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        else res.set('Cache-Control', 'no-cache');
      },
    })
  );

  app.use((req, res) => {
    if (req.accepts(['html', 'json']) === 'json') return res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
    res.status(404).type('text/plain').send('Not found.');
  });

  /* ---------- errors ---------- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
    }
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'The request could not be read.' } });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'The request is too large.' } });
    if (logger) logger.error(err, `${req.method} ${req.originalUrl}`);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } });
  });

  return app;
}

module.exports = { createApp };
