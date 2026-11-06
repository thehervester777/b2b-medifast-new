'use strict';
/** The API speaks epoch milliseconds; MySQL stores UTC DATETIME(3). */
const ms = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : null);
const at = (n) => (n == null ? null : new Date(Number(n)));
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
module.exports = { ms, at, DAY, HOUR, MIN };
