# MediFast: one cPanel-ready system (design)

Date: 2026-11-06 · Status: for owner review

## 1. Goal

Turn the two browser-only demos (the supplier app and the MediFast Admin panel) into **one real
system for the owner's own live business**: a Node.js backend with a **MySQL** database that both apps
use, uploadable to **cPanel**, with a clean project structure and no demo or test leftovers.

What the owner said:
- Remove unnecessary files and give the project a clear structure.
- cPanel ready, with a database.
- Commercial ready.
- Backend technology: **Node.js + MySQL**.
- Use: **own live business** (one copy on one domain), not a product sold to other clients.

Assumptions (the owner approved the design that contains them):
- One domain serves both apps and the API.
- `medifast-supplier` is the newest supplier code (the GitHub copy `b2b-medifast-new` is older: 5 files differ and the newer ones are from later the same day).
- Both apps keep their current look and behaviour.
- The host offers cPanel's **Setup Node.js App** (Passenger) and MySQL/MariaDB.

## 2. Out of scope for version 1

Multi-client installs and an installer wizard, email sending (password reset by email, notifications by
email), file uploads for supplier documents (licence and TIN are numbers plus an admin "checked" flag, as today),
online payments, real-time push (the apps poll instead), and per-page server-side pagination (lists load in
bulk, fine up to several thousand rows per table). Each can be added later without changing the structure.

## 3. Architecture

One Node.js app (Express) serves everything on one domain, so cookies are same-origin and no CORS is needed:

| URL | What |
| --- | --- |
| `/` | Supplier app (built static files) |
| `/admin/` | Admin panel (built static files) |
| `/api/...` | JSON API |
| `/setup` | One-time owner account page (locks itself) |
| `/api/health` | Health check (database reachable, version) |

The apps keep their hash routing (`#orders`), so no server rewrite rules are needed. The server only needs
`express.static` for the two build folders.

Libraries (all pure JavaScript, so `npm install` works on shared hosts without compiling anything):
`express`, `mysql2` (promise pool, prepared statements only), `bcryptjs`, `helmet`, `zod` (input validation),
`dotenv`. Tests use Node's built-in `node:test`.

## 4. Folder structure (new folder `medifast/`)

```
medifast/
  server/
    app.js                 startup file for cPanel (Passenger)
    src/
      config.js            reads .env, fails early with a clear message
      db.js                connection pool, transaction helper
      http/                express app, middleware (auth, permissions, errors, rate limit, security headers)
      modules/
        auth/              admin and supplier login, sessions, setup, password change
        admin-access/      admins and roles
        suppliers/         verification, suspend, list
        requests/          requests and the price ladder
        quotes/            submissions (carts), decide, award
        orders/            orders, status changes, documents data
        products/          catalogue, send to supplier app
        site/              notice and maintenance
        settings/          rule thresholds
        audit/             activity log
        reports/           report queries and CSV
        sync/              data version for polling
      rules/               business rules shared by modules (flags, award, order status)
    test/                  integration tests and test-only fixtures (never shipped)
  apps/
    supplier/              supplier app source (from medifast-supplier)
    admin/                 admin panel source
  database/
    schema.sql             full schema + default roles + default settings (import in phpMyAdmin)
    migrations/            numbered .sql files for later changes
  scripts/
    package.js             builds both apps and makes release/medifast-cpanel.zip
  docs/
    INSTALL.md             cPanel step by step, with troubleshooting
    BACKUP.md
    superpowers/specs/     this document
  .env.example
  package.json             workspaces; scripts: dev, test, build, package
  README.md
  .gitignore
```

The release zip contains only: `server/` (without tests), the compiled `apps/*/dist` folders, `database/`,
`package.json` (server dependencies only), `.env.example`, `docs/INSTALL.md`. No `node_modules`, no source of the
front ends, no scripts. cPanel's "Run NPM Install" button installs the server dependencies.

## 5. Database (MySQL 5.7+ / MariaDB 10.3+, InnoDB, utf8mb4 for Bangla text)

Conventions: ids are `BIGINT UNSIGNED AUTO_INCREMENT` (supplier public codes like `PR-2041` are stored in a
`code` column); money is `DECIMAL(12,2)`; times are `DATETIME(3)` in UTC and the API returns **epoch
milliseconds** so the front-end data shapes stay the same as today; every table has `created_at` and
`updated_at`.

| Table | Purpose and main columns |
| --- | --- |
| `roles` | `name`, `permissions` (JSON array of permission keys), `is_system`. Owner, Manager, Reviewer, Warehouse, Finance are created by `schema.sql`. |
| `admins` | `name`, `email` (unique), `password_hash`, `role_id`, `active`, `must_change_password`, `last_seen_at`, `last_ip`, `last_device`. |
| `suppliers` | `code` (unique, PR-xxxx), `name` (business), `owner_name`, `city`, `address`, `email` (unique), `phone`, `password_hash`, `licence`, `tin`, `status` (Pending/Verified/Suspended), `docs` (JSON checked flags), `joined_at`, `must_change_password`. |
| `products` | `code`, `name`, `generic`, `brand`, `stock`, `reorder_level`, `buy_price`, `sale_price`, `status`, `last_sent_at`. |
| `requests` | `name`, `generic`, `company`, `qty`, `ask_price`, `status` (Active/Completed/Expired), `no_end`, `deadline_at`, `posted_at`, `note`, `product_id` (nullable). |
| `submissions` | A supplier's cart as sent: `code` (CT-…), `supplier_id`, `submitted_at`. |
| `quotes` | `request_id`, `supplier_id`, `submission_id`, `qty`, `price`, `status` (Pending/Approved/Awarded/Rejected), `decided_at`, `decided_by`, `reject_reason`, `reject_note`. Unique `(request_id, supplier_id)`: a supplier has one quote per request; sending again replaces a Pending one and is refused once it has been decided. |
| `orders` | `quote_id` (unique), `request_id`, `supplier_id`, copy of `name`, `generic`, `company`, `qty`, `price`, `ask_price`, `status` (Pending/Approved/In transit/Delivered/Cancelled), `expected_at`, `delivered_at`, `note`. |
| `order_history` | `order_id`, `status`, `at`, `by_admin_id`, `note` (also records quantity and price edits). |
| `notifications` | Messages for suppliers: `supplier_id`, `icon`, `title`, `body`, `read_at`. Created by the server when a quote is decided or the account is verified. |
| `site_settings` | Key/value JSON: notice, maintenance, rule thresholds (price flag %, review hours, alert switches). |
| `audit_log` | `type`, `actor_type` (admin/supplier/system), `actor_id`, `actor_name`, `text`, `ref_type`, `ref_id`, `ip`, `device`, `at`. Append-only: the app has no code path that edits or deletes rows. |
| `sessions` | `token_hash` (SHA-256 of the cookie value), `actor_type`, `actor_id`, `expires_at`, `ip`, `user_agent`. |
| `login_attempts` | `kind`, `email`, `ip`, `at`, for the lock-out rule. |
| `meta` | `data_version` counter (see section 8). |

Indexes cover every list filter the panel offers: `requests(status, posted_at)`, `quotes(request_id)`,
`quotes(supplier_id, status)`, `orders(supplier_id)`, `orders(status, created_at)`, `audit_log(at)`,
`suppliers(status)`.

`schema.sql` creates tables, the five default roles and default settings. **It contains no demo rows and no
accounts.**

## 6. Security and commercial basics

- **Passwords:** bcrypt (cost 12). Admin passwords need at least 10 characters. Temporary passwords set by an admin
  force a change at the next login (`must_change_password`).
- **Sessions:** random 32-byte token in an `HttpOnly`, `SameSite=Lax`, `Secure` (when HTTPS) cookie; only its SHA-256
  hash is stored. Separate cookies for admins (`mf_admin`) and suppliers (`mf_supplier`) so one can never act as the other.
  Sliding 12 h expiry for admins, 30 days for suppliers who tick "remember me". Logout and "sign out everywhere"
  delete the rows. Disabling or suspending an account deletes its sessions at once.
- **CSRF:** every state-changing request must carry the header `X-MF: 1` and a matching `Origin`/`Host`; a plain
  cross-site form cannot do that.
- **Brute force:** 5 failed logins for the same email or 20 for the same IP within 15 minutes lock that email/IP for
  15 minutes. The login message never says which part was wrong.
- **Authorisation on the server:** each admin route declares the permission it needs (same keys as the panel
  today, e.g. `quotes.decide`). The panel hiding a button is only convenience. Supplier routes only ever return
  and change that supplier's own rows. Suppliers never see other suppliers' names or prices (only a rank and a
  bid count per request, as the app shows today).
- **Input:** every request body and query is validated with `zod` (types, ranges, lengths). All SQL uses
  parameters. Output stays escaped by the front ends.
- **Headers:** `helmet` with a content security policy that allows only the app's own scripts and styles; HSTS when
  HTTPS; `X-Content-Type-Options`; no `X-Powered-By`.
- **Secrets:** only in `.env` / cPanel environment variables. The server refuses to start if the database
  settings are missing, with a message saying which one.
- **Audit:** every write action adds an `audit_log` row in the same database transaction as the change, so the log
  can never miss a change or show one that failed.
- **First run:** `/setup` is available only while the `admins` table is empty. It creates the Owner account and then
  answers 404 forever. There is no default account.
- **Errors:** the API returns `{ error: { code, message } }`; stack traces go to `storage/logs/`, never to the browser.
- **Backups:** `docs/BACKUP.md` explains cPanel Backup and a phpMyAdmin export. The server does not make backups.

## 7. API

All paths are under `/api`. JSON in, JSON out. Dates are epoch milliseconds.

**Public**
- `GET /health`
- `GET /public/site`: notice and maintenance state (the supplier app reads this before sign-in)
- `POST /setup` (only while no admin exists)

**Admin** (cookie `mf_admin`; the permission in brackets)
- `POST /admin/auth/login`, `POST /admin/auth/logout`, `GET /admin/auth/me`, `POST /admin/auth/password`
- `GET /admin/bootstrap` (everything the panel shows, filtered by what the role may see) and `GET /admin/version`
- Requests: `POST/PATCH/DELETE /admin/requests`, `POST .../close`, `POST .../reopen` (`requests.manage`)
- Quotes: `POST /admin/quotes/decide` (approve or reject, one or many), `POST /admin/quotes/award` (`quotes.decide`)
- Orders: `PATCH /admin/orders/:id` (status, quantity, price, note), `POST /admin/orders/status` (bulk) (`orders.manage`)
- Suppliers: `PATCH /admin/suppliers/:id` (verify, suspend, reinstate, docs), `POST .../reset-password` (`suppliers.manage`)
- Products: `POST/PATCH /admin/products`, `POST /admin/products/send` (`products.send`)
- Reports and CSV: `GET /admin/reports`, `GET /admin/export/:kind` (`reports.view`, `reports.export`)
- Audit: `GET /admin/audit` (`audit.view`)
- Site and settings: `PUT /admin/site`, `PUT /admin/settings` (`site.manage`, `settings.manage`)
- Access: `GET/POST/PATCH /admin/team`, `PUT /admin/roles/:name` (`access.manage`)
- Undo: `POST /admin/undo` with the token returned by a reversible action (see section 9)

**Supplier** (cookie `mf_supplier`)
- `POST /supplier/auth/signup` (creates a Pending supplier), `login`, `logout`, `me`, `password`
- `GET /supplier/requests` (Active requests with bid count and this supplier's rank)
- `POST /supplier/submissions` (a cart of quotes in one call), `GET /supplier/quotes`, `DELETE /supplier/quotes/:id` (withdraw a Pending quote)
- `GET /supplier/notifications`, `POST /supplier/notifications/read`
- `PATCH /supplier/account`

**Business rules move to the server** (they are the authority; the front ends keep display-only copies for flags):
approve/reject, **award** (creates the order, rejects the other quotes with "Another quote was awarded", completes the
request), order status steps, rule flags, and maintenance mode (suppliers are blocked while on; admins pass if "allow admins" is set).
Every multi-row action is one database transaction.

## 8. Keeping screens current

Every write increments `meta.data_version` inside its transaction. Both apps poll `GET .../version` every 20 s
while the tab is visible and on window focus; when the number changed they reload their data (the admin
`bootstrap`, the supplier request list and notifications). This is one tiny query per poll and works on any host.

## 9. What changes in the two apps

- **Same look and behaviour.** Views, styles, motion and layout are untouched.
- **Data layer replaced:** each app's `core/store.js` keeps its `state` shape but fills it from the API instead of
  `localStorage`/seed data; a small `api.js` client adds the `X-MF` header, handles 401 (back to sign-in) and 403/validation
  errors as toasts.
- **Mutations:** `transact()` becomes "call the API, then merge the returned rows into `state`". Nothing is changed on
  screen until the server confirms, except toggles that roll back on error.
- **Undo:** kept for approve, reject, award and order status changes. The server returns an `undoToken` valid for
  one minute that reverses exactly that change (and logs it). Other actions use the existing confirm dialogs.
- **Removed:** demo sign-in hints, "Reset demo data", seed files, deterministic fake rival prices in the supplier app.
- **Supplier app request board:** real requests from the admin. Rank and bid count come from the server.
- **Vite `base`:** supplier `/`, admin `/admin/`. Fonts are self-hosted (already are).

## 10. cPanel deployment (what INSTALL.md will say)

1. cPanel: MySQL Databases: create a database, a user and a strong password, add the user to the database with all privileges.
2. phpMyAdmin: select the database, Import `database/schema.sql`.
3. File Manager: upload `medifast-cpanel.zip` to a folder outside `public_html` (for example `medifast`), extract.
4. Setup Node.js App: Node 20 or newer, application root `medifast`, application URL your domain, startup file `server/app.js`.
5. Add environment variables: `NODE_ENV=production`, `APP_URL`, `DB_HOST` (usually `localhost`), `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `TRUST_PROXY=1`.
6. Click **Run NPM Install**, then **Restart**.
7. Open `https://your-domain/setup`, create the Owner account, sign in at `/admin/`.
8. Turn on cPanel's free SSL (AutoSSL) and set the domain to force HTTPS.

The doc also lists the three common failures (database connection refused, wrong Node version, "app didn't start") with fixes.

## 11. Clean-up

Done in the first stage, in this order, and **nothing is deleted until the owner approves the exact list**:

1. Build `medifast/` by copying `medifast-supplier/src` and `medifast-admin/src` (not the old folders).
2. Propose the delete list with sizes: `b2b-medifast-new` (older duplicate; the GitHub history stays on GitHub), both `node_modules`, `dist`, `dist-single`, `MediFast-Supplier.html`, `medifast-supplier.zip`, the old READMEs.
3. Inside the apps: remove seed/demo data and dead code (admin `quote-` details branch and quote-only cart menu, unused styles and helpers) found by searching for unused exports.
4. Write one `README.md` for the whole project.

The new repository is local only. Pushing to GitHub is a separate step the owner decides.

## 12. Testing

- **Server integration tests** (`node:test`) against a real MySQL/MariaDB: every route's success path; permission denial for each of the five roles; supplier isolation; award transaction (order created, others rejected, request completed, audit row written, rollback on failure); lock-out; `/setup` locking; CSRF header rejection; validation rejections.
- **Browser tests** (Playwright) against the running server: sign-up and sign-in, a supplier submits a cart, the admin sees it, approves, awards, moves the order to Delivered, the supplier sees the notification; all at phone, tablet and desktop widths; console errors fail the run.
- **Release check:** build the zip, unzip it in an empty folder, `npm install --omit=dev`, start with a fresh database, run `/setup`, run a smoke test.
- If a real MySQL cannot be run in the build workspace, I will say so in the hand-off, and the SQL will be reviewed only by syntax and reasoning. The final check then happens on the owner's cPanel using the smoke list in INSTALL.md.

## 13. Delivery stages (each ends with something that runs and is tested)

1. Structure, clean-up proposal, approval, clean-up.
2. Database schema, server skeleton, login, sessions, `/setup`, security middleware, with tests.
3. Admin API (requests, quotes, orders, suppliers, products, reports, audit, site, access) with tests, then the admin app connected.
4. Supplier API and the supplier app connected, end-to-end browser tests.
5. Packaging, INSTALL.md, BACKUP.md, README, release check.

## 14. Risks

- The host must support Node.js apps in cPanel. If it does not, the owner must change hosting or use a VPS. INSTALL.md starts with a one-minute check for this.
- Shared hosts limit memory and processes. The app is small (one process, one pool of at most 10 connections).
- Without email, a forgotten password needs an admin to set a temporary one. Email reset is the first follow-up.
- Bulk loading of lists is acceptable now and becomes slow at tens of thousands of rows; server-side paging is the follow-up when that happens.

## 15. Differences between this spec and what was built

Written after the build, so the spec and the code agree.

1. **Reports and CSV downloads stay in the browser.** The panel builds them from the data it already loaded, so there is
   no `/admin/reports` or `/admin/export` endpoint. Every row a user can see in the panel is already limited by the
   server to what that user may view.
2. **Queries are parameterised, but not server-side prepared.** mysql2 escapes the values on the client side of the
   connection. No query is built by pasting user text into SQL.
3. **An extra permission, `products.manage`,** controls adding and editing products. There are 19 permissions in total.
   The server list (`server/src/rules/perms.js`) and the panel's list are compared by a test.
4. **Request expiry.** An Active request past its deadline becomes Expired only when it has no Pending or Approved
   quotes. A sweeper runs at start and every 5 minutes.
5. **What Undo covers.** Quote and order decisions, supplier approvals and similar actions return a one-minute undo
   token. Team, settings and site-notice changes cannot be undone from the panel.
6. **Temporary passwords for suppliers too.** An admin can set a temporary password for a supplier. The supplier must
   change it before doing anything else (`must_change_password`, answered with 403 `must_change_password`).
7. **Session endpoints.** `GET /api/admin/auth/session` and `GET /api/supplier/auth/session` answer 200 with
   `{ me: null }` when nobody is signed in, so opening a page does not log a 401 in the browser console.
8. **Hosting under a sub-folder is not supported.** The apps call `/api` with an absolute path; use the root of a
   domain or subdomain.
9. **Maintenance mode** blocks every supplier route except the bootstrap read the app needs to show the maintenance
   screen. The panel is never blocked. (The "admins can still use the supplier app" option from the early design was
   dropped: admins have no supplier session, so it could not do anything.)
10. **Release check.** `scripts/verify-release.js` unzips the release, installs production dependencies, builds a fresh
    database from the zip's own `schema.sql`, starts the server and walks the first-run path. The automated tests ran on
    MySQL 9.7; the final check on MySQL 5.7 / MariaDB 10.3 is the smoke list in `docs/INSTALL.md`.
