'use strict';
/*
 * Reads settings from environment variables (a .env file in development, cPanel's
 * "Environment variables" in production) and stops early with a clear message when
 * something needed is missing.
 */
const path = require('node:path');

class ConfigError extends Error {}

function load(env = process.env) {
  const missing = ['DB_NAME', 'DB_USER'].filter((k) => !env[k]);
  if (missing.length) {
    throw new ConfigError(`Missing setting${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Add ${missing.length > 1 ? 'them' : 'it'} in the Node.js app's environment variables (see docs/INSTALL.md).`);
  }
  const nodeEnv = env.NODE_ENV || 'development';
  const appUrl = (env.APP_URL || '').replace(/\/+$/, '');
  if (nodeEnv === 'production' && !appUrl) {
    throw new ConfigError('Missing setting: APP_URL (for example https://example.com).');
  }
  if (appUrl && !/^https?:\/\/[^/\s]+$/i.test(appUrl)) {
    throw new ConfigError('APP_URL must look like https://example.com, with no path and no trailing slash.');
  }
  const port = env.PORT ? Number(env.PORT) : 0;
  return {
    nodeEnv,
    isProd: nodeEnv === 'production',
    appUrl,
    secureCookies: appUrl.startsWith('https://'),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    port: Number.isInteger(port) && port > 0 ? port : 0,
    db: {
      host: env.DB_HOST || 'localhost',
      port: Number(env.DB_PORT) || 3306,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD || '',
    },
    bcryptCost: Number(env.BCRYPT_COST) || 12,
    appsDir: env.APPS_DIR || path.join(__dirname, '..', '..', 'apps'),
    logDir: env.LOG_DIR || path.join(__dirname, '..', '..', 'storage', 'logs'),
  };
}

module.exports = { load, ConfigError };
