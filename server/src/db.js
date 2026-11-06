'use strict';
const mysql = require('mysql2/promise');

/*
 * One small pool. Every query uses placeholders (?), so values are escaped by the driver
 * and never glued into SQL text. Times are UTC. Money comes back as strings and is
 * converted by the code that shapes API output.
 */
function createDb(cfg) {
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: 'utf8mb4',
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    connectTimeout: 10000,
  });

  const wrap = (conn) => ({
    /** Rows of a SELECT. */
    async all(sql, params = []) {
      const [rows] = await conn.query(sql, params);
      return rows;
    },
    /** First row of a SELECT, or null. */
    async one(sql, params = []) {
      const [rows] = await conn.query(sql, params);
      return rows[0] || null;
    },
    /** INSERT / UPDATE / DELETE: { insertId, affectedRows }. */
    async run(sql, params = []) {
      const [res] = await conn.query(sql, params);
      return res;
    },
  });

  const base = wrap(pool);

  /** Run fn inside one transaction. Retries once if MySQL picks this one as a deadlock victim. */
  async function tx(fn) {
    for (let attempt = 0; ; attempt++) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const out = await fn(wrap(conn));
        await conn.commit();
        return out;
      } catch (err) {
        try {
          await conn.rollback();
        } catch (e) {
          /* connection already gone */
        }
        if (err && err.errno === 1213 && attempt < 1) continue;
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  return { ...base, tx, pool, close: () => pool.end() };
}

module.exports = { createDb };
