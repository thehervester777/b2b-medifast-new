'use strict';
const express = require('express');
const { requireAdmin } = require('../../http/middleware');
const { adminAuth } = require('../adminAuth');
const { bootstrap } = require('./bootstrap');
const { quotes } = require('./quotes');
const { orders } = require('./orders');
const { requests } = require('./requests');
const { suppliers } = require('./suppliers');
const { products } = require('./products');
const { access } = require('./access');
const { site } = require('./site');

/** Everything under /api/admin. Sign-in routes are open; all the rest need an admin session. */
function adminRouter(deps) {
  const r = express.Router();
  r.use('/auth', adminAuth(deps));
  const authed = express.Router();
  authed.use(requireAdmin(deps));
  authed.use(bootstrap(deps));
  authed.use('/quotes', quotes(deps));
  authed.use('/orders', orders(deps));
  authed.use('/requests', requests(deps));
  authed.use('/suppliers', suppliers(deps));
  authed.use('/products', products(deps));
  authed.use(access(deps));
  authed.use(site(deps));
  r.use(authed);
  return r;
}
module.exports = { adminRouter };
