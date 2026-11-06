# Install MediFast on cPanel

You need: a cPanel hosting account with **Setup Node.js App** (Node.js 20 or newer), **MySQL Databases** and
**phpMyAdmin**, and a domain or subdomain you can point at the app, such as `buy.example.com`.

> **Use the root of a domain or subdomain.** The apps call `/api` with an absolute path, so a folder address like
> `example.com/medifast/` will not work. Create a subdomain in cPanel first if the main domain is already in use.

The release zip is `medifast-cpanel-<version>.zip` (from `npm run package`, see README.md).

## 1. Create the database

1. cPanel, **MySQL Databases**.
2. Under *Create New Database*, make one (for example `medifast`). cPanel adds your account name in front, so the
   full name looks like `acct_medifast`. Write down the full name.
3. Under *MySQL Users*, add a user with a strong password. Write down the full user name and the password.
4. Under *Add User To Database*, add that user to that database and tick **ALL PRIVILEGES**.

## 2. Import the tables

1. cPanel, **phpMyAdmin**. Click your new database in the left list.
2. **Import**, choose `database/schema.sql` from the release zip (unzip it on your computer first), click **Import**.
3. You should see 16 tables. The file has no demo rows and no accounts. It is safe to import twice.

## 3. Upload the app

1. cPanel, **File Manager**. Go to your home folder (not `public_html`) and create a folder, for example `medifast`.
2. Upload `medifast-cpanel-<version>.zip` into it and **Extract**. You should now see `server`, `apps`, `database`,
   `package.json` and `docs` inside `medifast`.
3. Delete the zip file.

## 4. Create the Node.js app

1. cPanel, **Setup Node.js App**, **Create Application**.
2. Fill in:
   - **Node.js version:** 20 or newer.
   - **Application mode:** Production.
   - **Application root:** `medifast`
   - **Application URL:** your domain or subdomain (leave the path box empty).
   - **Application startup file:** `server/app.js`
3. Click **Create**.

## 5. Add the settings

In the same screen, under **Environment variables**, add these one by one:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://your-domain.com` (no slash at the end; use `http://` only if you have no SSL yet) |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` | the full database name from step 1 |
| `DB_USER` | the full user name from step 1 |
| `DB_PASSWORD` | the password from step 1 |
| `TRUST_PROXY` | `1` |

Click **Save**. The secrets live only here; nothing in the zip contains them.

## 6. Install and start

1. Click **Run NPM Install**. Wait until it finishes (about a minute).
2. Click **Restart**.
3. Open `https://your-domain.com/api/health`. You should see `{"ok":true,"database":true,...}`.

## 7. Create the Owner account

1. Open `https://your-domain.com/setup`. Enter your name, email and a password of at least 10 characters.
2. Sign in at `https://your-domain.com/admin/`.
3. The setup page switches itself off after the first account. There is no default account.
4. In the panel, open **Access** to add your team and give each person a role.

Suppliers use `https://your-domain.com/`. They sign up there; you approve them under **Suppliers**.

## 8. Turn on HTTPS

1. cPanel, **SSL/TLS Status**, run **AutoSSL** for the domain.
2. Make sure `APP_URL` starts with `https://`, then **Restart** the app. This turns on the "Secure" flag for sign-in cookies.
3. Force HTTPS: in **Domains** switch on *Force HTTPS Redirect* for the domain.

## Check that it works

Go through this list once after install, and again after every update:

- [ ] `/api/health` shows `"database":true`.
- [ ] `/` opens the supplier sign-in page and `/admin/` opens the admin sign-in page.
- [ ] `/setup` answers "not found" now that the Owner exists.
- [ ] You can sign in to `/admin/` and sign out.
- [ ] Add a product, then create a request from it and send it to suppliers.
- [ ] Sign up as a test supplier in a private window, approve it in the panel, sign in, and send a quote.
- [ ] In the panel, award that quote. The supplier sees **Won** and a notification.
- [ ] The page address bar shows the padlock.

Delete the test supplier afterwards (Suppliers, open it, Suspend), or keep it clearly named as a test.

## Updating

1. Make a backup first (BACKUP.md).
2. Upload the new zip to a new folder, extract it, and copy your settings over: they are in the Node.js app's
   environment variables, so nothing to copy unless you changed the application root.
3. Easiest way: in File Manager extract the new zip over the old `medifast` folder (it replaces `server`, `apps`,
   `database`, `docs` and `package.json` and leaves `storage` alone).
4. If the release notes mention a migration, import the listed file(s) from `database/migrations/` in phpMyAdmin.
5. **Run NPM Install** if `package.json` changed, then **Restart**.

## When something goes wrong

**The page says "Incomplete response" or "App didn't start".** Open `medifast/storage/logs/error.log` in File Manager
and the app's `stderr.log`, or the Node.js app screen. Most causes are below.

**"Cannot start: Missing setting: ..."** An environment variable is missing or misspelt. Add it and Restart.

**"Cannot start: The database is empty."** Step 2 was skipped. Import `database/schema.sql`.

**`/api/health` shows `"database":false`, or "Access denied".** The user name or password is wrong, or the user was not
added to the database with all privileges. Use the *full* names, with cPanel's account prefix. Keep `DB_HOST` as
`localhost`.

**Wrong Node.js version.** Edit the app in **Setup Node.js App**, pick 20 or newer, Save, **Run NPM Install**, Restart.

**You are signed out right away, or sign-in loops.** `APP_URL` does not match the address in the browser (for
example `http://` versus `https://`, or `www`). Fix it and Restart. Check `TRUST_PROXY=1`.

**"This request was blocked. Reload the page and try again."** The address you typed differs from `APP_URL`
(another domain pointing at the same app, for example). Use the `APP_URL` address, or change it.

**A blank page under `/admin/`.** Open the browser console. If it lists files that failed to load, the zip was only
partly extracted; extract it again over the folder.

**After changing environment variables nothing changes.** Click **Restart**; the app reads settings at start.
