'use strict';
const express = require('express');
const { parse, z, optText } = require('../../lib/validate');
const { conflict } = require('../../lib/errors');
const { need } = require('../../http/middleware');
const { applyUndo } = require('../../rules/undo');
const { loadSite, saveSite } = require('../../rules/site');
const { finish, done } = require('./helpers');

const SETTING_RULES = {
  requireReason: z.boolean(),
  flagLowPrice: z.boolean(),
  lowPricePct: z.number().int().min(1).max(90),
  reviewHours: z.number().int().min(1).max(720),
  leadDays: z.number().int().min(1).max(60),
  rejectOthersOnAward: z.boolean(),
  notifyPending: z.boolean(),
  notifyDigest: z.boolean(),
  notifySuppliers: z.boolean(),
};
const onOff = (on, yes, no) => (on ? yes : no);
const SETTING_TEXT = {
  requireReason: (v) => onOff(v, 'now requires a reason to reject a quote', 'no longer requires a reason to reject a quote'),
  flagLowPrice: (v) => onOff(v, 'turned on the low price check', 'turned off the low price check'),
  lowPricePct: (v) => `set the low price check to ${v}% below asking`,
  reviewHours: (v) => `changed the review time limit to ${v} hours`,
  leadDays: (v) => `changed the delivery lead time to ${v} days`,
  rejectOthersOnAward: (v) => onOff(v, 'now turns down other quotes when one is awarded', 'no longer turns down other quotes when one is awarded'),
  notifyPending: (v) => onOff(v, 'turned on pending quote alerts', 'turned off pending quote alerts'),
  notifyDigest: (v) => onOff(v, 'turned on the daily summary', 'turned off the daily summary'),
  notifySuppliers: (v) => onOff(v, 'turned on new supplier alerts', 'turned off new supplier alerts'),
};

const when = z.number().int().positive().nullable();
const noticeSchema = z
  .object({
    on: z.boolean(),
    tone: z.enum(['info', 'warning', 'urgent']),
    title: optText(120),
    body: optText(500),
    audience: z.enum(['suppliers', 'admins', 'all']),
    dismissible: z.boolean(),
    scheduled: z.boolean(),
    startAt: when,
    endAt: when,
  })
  .partial();
const maintenanceSchema = z
  .object({ mode: z.enum(['off', 'now', 'scheduled']), message: optText(500), startAt: when, endAt: when })
  .partial();

function site({ db }) {
  const r = express.Router();

  r.patch('/settings', need('settings.manage'), async (req, res) => {
    const body = parse(z.object({ key: z.enum(Object.keys(SETTING_RULES)), value: z.any() }), req.body);
    const value = parse(SETTING_RULES[body.key], body.value);
    await db.tx(async (c) => {
      const cur = await loadSite(c);
      if (cur.settings[body.key] === value) throw conflict('Already set.', 'already');
      await saveSite(c, 'settings', { ...cur.settings, [body.key]: value });
      await finish(c, req, null, { type: 'settings', text: SETTING_TEXT[body.key](value) });
    });
    await done(db, res);
  });

  r.patch('/site/notice', need('site.manage'), async (req, res) => {
    const patch = parse(noticeSchema, req.body);
    if (!Object.keys(patch).length) throw conflict('Nothing was changed.', 'no_change');
    await db.tx(async (c) => {
      const cur = await loadSite(c);
      const next = { ...cur.notice, ...patch };
      if (next.on && !next.title && !next.body) throw conflict('Write a title or a message first.', 'empty_notice');
      await saveSite(c, 'notice', next);
      const onlyToggle = Object.keys(patch).length === 1 && patch.on !== undefined;
      await finish(c, req, null, { type: 'site', text: onlyToggle ? onOff(patch.on, 'turned on the site notice', 'turned off the site notice') : 'updated the site notice' });
    });
    await done(db, res);
  });

  r.patch('/site/maintenance', need('site.manage'), async (req, res) => {
    const patch = parse(maintenanceSchema, req.body);
    if (!Object.keys(patch).length) throw conflict('Nothing was changed.', 'no_change');
    await db.tx(async (c) => {
      const cur = await loadSite(c);
      const next = { ...cur.maintenance, ...patch };
      await saveSite(c, 'maintenance', next);
      const text = patch.mode === 'now' ? 'turned on maintenance mode' : patch.mode === 'off' ? 'turned off maintenance mode' : patch.mode === 'scheduled' ? 'scheduled maintenance' : 'updated the maintenance settings';
      await finish(c, req, null, { type: 'site', text });
    });
    await done(db, res);
  });

  r.post('/undo', async (req, res) => {
    const body = parse(z.object({ token: z.string().length(32) }), req.body);
    const out = await applyUndo(db, req.ctx, body.token);
    await done(db, res, out);
  });

  return r;
}
module.exports = { site };
