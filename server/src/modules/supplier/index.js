'use strict';
const express = require('express');
const { supplierAuth } = require('./auth');
const { supplierData } = require('./data');

/** Everything under /api/supplier. */
function supplierRouter(deps) {
  const r = express.Router();
  r.use('/auth', supplierAuth(deps));
  r.use(supplierData(deps));
  return r;
}
module.exports = { supplierRouter };
