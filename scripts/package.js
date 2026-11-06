#!/usr/bin/env node
'use strict';
/*
 * Builds the release zip you upload to cPanel:  npm run package
 *
 * It builds both front ends, then zips only what the server needs to run: server code, the compiled apps,
 * the database schema, a production package.json, .env.example and the guides. No node_modules (cPanel installs
 * those with "Run NPM Install"), no tests, no source maps, no secrets.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { zipSync, strToU8 } = require('fflate');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const skipBuild = process.argv.includes('--no-build');

if (!skipBuild) {
  console.log('Building the admin panel and the supplier app...');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}

const files = {};
const add = (zipPath, data) => {
  files[zipPath.split(path.sep).join('/')] = [typeof data === 'string' ? strToU8(data) : new Uint8Array(data), { level: 9 }];
};

function addDir(dir, prefix, filter = () => true) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) throw new Error(`Missing ${dir}. Run the build first.`);
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (!filter(rel, entry)) continue;
    if (entry.isDirectory()) addDir(rel, prefix, filter);
    else add(path.join(prefix, rel), fs.readFileSync(path.join(root, rel)));
  }
}

const noJunk = (rel) => !/\.(map|log)$/.test(rel) && !/(^|[\\/])(\.DS_Store|\.env)$/.test(rel);

add('server/app.js', fs.readFileSync(path.join(root, 'server/app.js')));
addDir('server/src', '', noJunk);
addDir('server/public', '', noJunk);
addDir('database', '', noJunk);
addDir('apps/admin/dist', '', noJunk);
addDir('apps/supplier/dist', '', noJunk);
add('.env.example', fs.readFileSync(path.join(root, '.env.example')));
for (const doc of ['README.md', 'docs/INSTALL.md', 'docs/BACKUP.md']) {
  const p = path.join(root, doc);
  if (!fs.existsSync(p)) throw new Error(`Missing ${doc}. Write the guides before packaging.`);
  add(doc, fs.readFileSync(p));
}

/* The package.json inside the zip: runtime dependencies only, no workspaces. */
add(
  'package.json',
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      description: pkg.description,
      license: pkg.license,
      main: 'server/app.js',
      scripts: { start: 'node server/app.js' },
      engines: pkg.engines,
      dependencies: pkg.dependencies,
    },
    null,
    2
  ) + '\n'
);

const out = path.join(root, 'release');
fs.mkdirSync(out, { recursive: true });
const name = `medifast-cpanel-${pkg.version}.zip`;
const zip = zipSync(files);
fs.writeFileSync(path.join(out, name), zip);

const count = Object.keys(files).length;
console.log(`\nWrote release/${name}  (${count} files, ${(zip.length / 1024).toFixed(0)} KB)`);
