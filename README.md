# eNMRIS

Eswatini National Medicines Regulatory Information System — a prototype national
medicines register for the Medicines Regulatory Authority (MRA).

## Planned stack

- Frontend: React, Vite, and Tailwind CSS
- Backend: Node.js and Express, with versioned `/api/v1` and read-only `/fhir` interfaces
- Database: MySQL 8 with InnoDB

## Repository layout

```text
backend/     Express application, separated into routes, controllers, services, and repositories
frontend/    React web application
database/    Numbered MySQL schema and seed scripts
docs/        Requirements, design, interface, testing, and user documentation
```

The database schema and API contract are established. Backend work is beginning
with staff authentication and medicine-register search. Use synthetic data for
development until MRA data is approved for use.

## Set up the backend

1. In MySQL Workbench, run `database/01_schema.sql`, then `database/02_seed.sql`.
   To verify the import, run
   `SELECT COUNT(*) FROM enmris.products;` and
   `SELECT COUNT(*) FROM enmris.product_programmes;` (expected: 19 and 18).
   For an existing database, also run `database/03_auth_login_attempts.sql`.
2. Create a restricted MySQL application account in Workbench. For this
   authentication slice, grant `SELECT` and `INSERT` on `app_users` and
   `app_user_permissions`; `SELECT`, `INSERT`, and `UPDATE` on `app_sessions`
   and `auth_login_attempts`; and `INSERT`/`SELECT` on `audit_log`. Do not grant
   the application account `UPDATE` or `DELETE` on `audit_log`.
3. From `backend`, copy `.env.example` to `.env`, then set the database values.
   Generate two separate keys with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
   and set `AUTH_ENCRYPTION_KEY` and `AUTH_RATE_LIMIT_KEY`. Keep these keys
   persistent and private; changing them makes stored authenticator secrets
   unreadable and resets the login-rate-limit hashes. Never commit `.env`.
4. Run `npm install` and `npm test`.
5. On a new database with no users, run `npm run admin:create`. This interactive
   command creates the first Admin, hashes the password, and displays a one-time
   authenticator setup URI. Add it to an authenticator app and confirm the
   current time-based one-time password (TOTP) when prompted. The URI contains a
   secret: do not share or save it in source control.
6. Start the server with `npm start`. In PowerShell, check readiness with
   `Invoke-RestMethod http://localhost:3000/health`. A ready response reports
   both the API and database as `ok`; a database connection failure returns
   HTTP 503.

Staff sign-in, session inspection, and sign-out are available under
`/api/v1/auth`. Production deployments must terminate HTTPS at the server or a
trusted reverse proxy and set `TRUST_PROXY_HOPS` to the exact proxy-hop count.
The API requires HTTPS for authentication and returns an HSTS header on secure
production requests; configure HTTPS at the reverse proxy as well.

## Troubleshoot MySQL `ER_ACCESS_DENIED_ERROR`

Check whether the MySQL account exists, including its host:

```sql
SELECT user, host FROM mysql.user WHERE user = 'eNMRIS';
```

If this returns no rows, MySQL has no `eNMRIS` account, which explains the
backend's access-denied error. MySQL accounts are host-specific: a backend
connecting to `127.0.0.1` may need an account for that host, distinct from
`localhost`. For local development, create accounts for both hosts in MySQL
Workbench if necessary. Replace the password placeholder below with a strong,
unique password; do not reuse or commit it:

```sql
CREATE USER IF NOT EXISTS 'eNMRIS'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD';
CREATE USER IF NOT EXISTS 'eNMRIS'@'127.0.0.1'
  IDENTIFIED BY 'REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD';

GRANT SELECT, INSERT ON enmris.app_users
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON enmris.app_sessions
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON enmris.auth_login_attempts
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT ON enmris.app_user_permissions
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT, INSERT ON enmris.audit_log
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
```

Run the full script in Workbench, then repeat the `SELECT` to confirm the
accounts exist (two rows when both host-specific accounts were created). If an
account already exists but its password differs, use `ALTER USER` for that
specific host and update `DB_PASSWORD` in the local `backend/.env` to match.
Then restart the backend and check `/health`. The application account
deliberately has no `UPDATE` or `DELETE` permission on `audit_log`. Rotate any
database password that has been shared or exposed.
