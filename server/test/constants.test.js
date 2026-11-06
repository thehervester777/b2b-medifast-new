'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const perms = require('../src/rules/perms');

/* The admin panel hides pages by permission key, so its list must match the server's, or a role would show a page the API refuses. */
test('the admin panel and the server agree on permissions and default roles', async () => {
  const client = await import(pathToFileURL(path.join(__dirname, '../../apps/admin/src/data/constants.js')).href);
  assert.deepEqual([...client.ALL_PERMS].sort(), [...perms.ALL_PERMS].sort());
  assert.deepEqual(client.PERM_LABEL, perms.PERM_LABEL);
  assert.deepEqual(client.ROLE_NAMES, perms.ROLE_NAMES);
  for (const role of client.ROLE_NAMES) {
    assert.ok(client.ROLE_INFO[role], `${role} has a description in the panel`);
  }
});
