# Back up and restore MediFast

Everything that matters is in the MySQL database: products, requests, quotes, orders, suppliers, staff, the audit log
and site settings. The application files can always be re-uploaded from the release zip. The server does not make
backups for you, so set up one of these.

## A. Quick copy before any change (phpMyAdmin)

1. cPanel, **phpMyAdmin**, click your database.
2. **Export**, method **Quick**, format **SQL**, click **Export**.
3. Keep the downloaded `.sql` file somewhere other than the hosting account (your computer, a cloud drive).

Do this before every update and before bulk changes such as suspending many suppliers.

## B. Automatic backups (cPanel)

1. cPanel, **Backup** (or **Backup Wizard**). Download a **MySQL database backup** for your database from
   *Download a MySQL Database Backup*.
2. If your host offers *Backup Configuration* or *JetBackup*, switch on daily database backups and keep at least 7 days.

A full-account backup also includes `medifast/storage/logs`, which you can ignore.

## C. Command line (if you have SSH)

```
mysqldump --single-transaction --default-character-set=utf8mb4 -u DB_USER -p DB_NAME > medifast-backup.sql
```

## Restore

Restoring replaces what is in the database, so do it only on purpose.

1. Stop sign-ins first: in the panel, turn on **Maintenance** (Site) so suppliers see the maintenance screen.
2. phpMyAdmin, click the database, tick **Check all** on the table list, choose **Drop** from the menu, confirm.
   (Or create a fresh empty database and point `DB_NAME` at it.)
3. **Import** your `.sql` backup.
4. In **Setup Node.js App**, click **Restart**.
5. Open `/api/health`, then sign in and check the newest request or order is there.

If you restore into a database that has no tables, the file `database/schema.sql` creates the tables but not your
data; the backup file already contains both.

## Moving to a new host

1. Take backup A or B.
2. On the new host follow INSTALL.md steps 1 and 3 to 6. In step 2, import your backup `.sql` instead of `schema.sql`.
3. Do not open `/setup`: your Owner account came with the backup.
4. Point the domain at the new host and make sure `APP_URL` matches it.

## What to check each month

- A backup file from the last week exists and is not zero bytes.
- Once a year, restore it into a scratch database and open the app against it to be sure it works.
