# MediFast

MediFast is the purchasing system for a pharmacy business. Suppliers see what you need and send their prices. You
compare the prices, pick a winner and turn it into an order.

It has two web apps and one server, all in this repository:

| Part | What it is | Address on your site |
| --- | --- | --- |
| Supplier app | Suppliers sign up, see open requests, send prices, follow their quotes | `/` |
| Admin panel | Your team manages products, requests, quotes, orders, suppliers, staff and site notices | `/admin/` |
| Server | One Node.js program with the API and a MySQL database | `/api` |

There is no demo data and no default account. The first time you open `/setup`, you create the Owner account.

## Get it running on cPanel

Read **[docs/INSTALL.md](docs/INSTALL.md)**. It takes about 20 minutes: create a database, import
`database/schema.sql`, upload the release zip, set up the Node.js app, open `/setup`.

Back up your data with **[docs/BACKUP.md](docs/BACKUP.md)**.

## Build the release zip

```
npm install
npm run package
```

This builds both apps and writes `release/medifast-cpanel-<version>.zip`. Upload that file to cPanel. It holds the
server, the built apps, the database schema and the guides, and no `node_modules` (cPanel installs those).

To prove a zip works on a clean machine, run it against a scratch MySQL:

```
node scripts/verify-release.js release/medifast-cpanel-1.0.0.zip
```

## Work on the code

You need Node.js 20 or newer and a MySQL 5.7+ or MariaDB 10.3+ server.

```
npm install
cp .env.example .env          # fill in DB_NAME, DB_USER, DB_PASSWORD; use NODE_ENV=development
# create the database, then import database/schema.sql into it
npm run build                  # the server serves the built apps
npm run dev                    # http://localhost:3000, restarts on change
```

To work on a screen with instant reloads, keep `npm run dev` running and start `npm run dev:admin`
(http://localhost:5173) or `npm run dev:supplier` (http://localhost:5174). Both forward `/api` to the server.

Run the tests (they need a scratch database whose name contains "test"; it is emptied on every run):

```
TEST_DB_NAME=medifast_test TEST_DB_USER=root npm test
```

## Folders

```
server/            Express API, rules (awards, undo, audit, expiry) and tests
  app.js           startup file for cPanel and `npm start`
  src/             config, database, HTTP, modules, rules
  public/          the one-time /setup page
apps/admin/        admin panel (Vite, plain JavaScript)
apps/supplier/     supplier app (Vite, plain JavaScript)
database/          schema.sql (new installs) and migrations/ (later changes)
scripts/           package.js (release zip), verify-release.js (clean-machine check)
docs/              INSTALL.md, BACKUP.md and the design spec
```

## How it behaves

- Passwords are hashed with bcrypt. Sign-in is locked for 15 minutes after repeated failures.
- Staff have roles with 19 separate permissions. The server checks every permission; hiding a button is only a convenience.
- Every change is written to the audit log in the same database transaction as the change itself.
- Awarding a quote, approving a supplier and similar actions can be undone for one minute.
- A request that passes its deadline with no pending or approved quotes becomes Expired (checked every 5 minutes).
- Both apps pick up other people's changes within about 20 seconds.
- Reports and CSV downloads are built in the browser from the data the panel has already loaded.

## Known limits of version 1

- The site must live at the root of a domain or subdomain (for example `https://buy.example.com`). The apps call
  `/api` with an absolute path, so installing under `https://example.com/medifast/` does not work.
- No email is sent. An admin sets a temporary password for a new teammate or a supplier who forgot theirs; the person
  must change it at the next sign-in.
- Changes to the team, settings and site notices cannot be undone from the panel (they can be changed again).
- Tested on MySQL 9.7. The schema uses only MySQL 5.7 / MariaDB 10.3 features, but check your host with the smoke
  list at the end of INSTALL.md.
