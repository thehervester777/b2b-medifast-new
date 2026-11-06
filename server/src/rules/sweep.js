'use strict';
const { audit, bump, systemCtx } = require('./audit');

/*
 * A request whose end date has passed stops taking quotes. It becomes "Expired" only once every
 * quote on it has been decided, so a person can still review and award after the deadline.
 */
async function expireRequests(db) {
  const due = await db.all(
    `SELECT r.id, r.name FROM requests r
      WHERE r.status = 'Active' AND r.no_end = 0 AND r.deadline_at IS NOT NULL AND r.deadline_at < ?
        AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.request_id = r.id AND q.status IN ('Pending', 'Approved'))`,
    [new Date()]
  );
  if (!due.length) return 0;
  await db.tx(async (c) => {
    for (const r of due) {
      const res = await c.run("UPDATE requests SET status = 'Expired' WHERE id = ? AND status = 'Active'", [r.id]);
      if (res.affectedRows) await audit(c, systemCtx, { type: 'request', text: `closed request RQ-${r.id}, ${r.name}, because its end date passed`, ref: { kind: 'request', id: r.id } });
    }
    await bump(c);
  });
  return due.length;
}
module.exports = { expireRequests };
