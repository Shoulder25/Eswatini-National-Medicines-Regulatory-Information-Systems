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

The database schema and API contract are established. Staff authentication and
the replacement-Admin approval workflow are implemented; medicine-register
search is the next feature. Use synthetic data for development until MRA data is
approved for use.

## Set up the backend

1. In MySQL Workbench, on a fresh database run `database/01_schema.sql`, then
   `database/02_seed.sql`. On an existing database, apply
   `database/03_auth_login_attempts.sql` if needed, then apply migrations 04,
   05, 06, 07, and 08 once and in order before restarting. Migration 05 depends on
   04, migration 06 depends on 05, migration 07 depends on 06, and migration 08
   depends on 07. Do not rerun
   numbered migrations or run the fresh-install schema over an existing DB.
   To verify the import, run
   `SELECT COUNT(*) FROM enmris.products;` and
   `SELECT COUNT(*) FROM enmris.product_programmes;` (expected: 19 and 18).
2. Create a restricted MySQL application account in Workbench. It needs
   `SELECT`/`INSERT` on `app_users`, column-scoped `UPDATE` on
   `app_users.totp_last_used_step` and `app_users.active`,
   `SELECT`/`INSERT`/`UPDATE` on `app_sessions`, `auth_login_attempts`,
   `admin_invitations`, and `officer_replacement_requests`, `SELECT` on
   `roles`, `role_permissions`, and `app_user_permissions`, and `SELECT`/`INSERT`
   on `audit_log`. Grant
   column-scoped `UPDATE` on `app_users` for
   `totp_secret_encrypted`, `totp_last_used_step`, `mfa_enrollment_token_hash`,
   `mfa_enrollment_expires_at`, `mfa_enrollment_secret_encrypted`,
   `mfa_enabled`, `active`, and `officer_position`;
   do not grant the application account `UPDATE` on `role_code` or `UPDATE`/`DELETE`
   on `audit_log`.
   The one-time tester scripts use a separately prompted maintenance account.
   Stable role codes and action grants are stored in `roles` and
   `role_permissions`; edit `display_label` for presentation only. The API
   authorizes by codes and snapshots each actor's role code and current label
   into `audit_log`.
3. From `backend`, copy `.env.example` to `.env`, then set the database values
   and `ALLOWED_EMAIL_DOMAINS` to the exact approved email domains (comma
   separated, without wildcards). Configure `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and `APP_BASE_URL` for email delivery.
   For this temporary test, set `ALLOWED_EMAIL_DOMAINS=ethereal.email`,
   `SMTP_HOST=smtp.ethereal.email`, `SMTP_PORT=587`, and
   `MAIL_FROM=no-reply@ethereal.email`. Keep the Ethereal account's
   `SMTP_USER` and `SMTP_PASS` only in the ignored `backend/.env`; never commit
   or print them. Nodemailer sends to the intended invitee address, and the
   test message is viewed in that Ethereal account's Messages page. Replace the
   test domain and credentials with MRA-approved values before production.
   For other development SMTP hosts, set an allowlisted `DEV_TEST_INBOX`.
   `DEV_TEST_EMAIL_DOMAINS` is for local testing only and is rejected in
   production. Do not configure `DEV_TEST_INBOX` in production.
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
6. After the first Admin exists, run `npm run officer:bootstrap` twice, once
   for each position: `BOARD_CHAIR` and `BOARD_VICE_CHAIR`. Each command prompts
   for the Officer's name, allowlisted email, and password. Officers enroll an
   authenticator during their first sign-in. Create one position at a time; the
   database prevents duplicate positions. These are local bootstrap operations,
   not public sign-up.
7. Start the server with `npm start`. In PowerShell, check readiness with
   `Invoke-RestMethod http://localhost:3000/health`. A ready response reports
   both the API and database as `ok`; a database connection failure returns
   HTTP 503.

Staff sign-in, session inspection, and sign-out are available under
`/api/v1/auth`. Production deployments must terminate HTTPS at the server or a
trusted reverse proxy and set `TRUST_PROXY_HOPS` to the exact proxy-hop count.
The API requires HTTPS for authentication and returns an HSTS header on secure
production requests; configure HTTPS at the reverse proxy as well.

## Run the staff interface locally

1. Start the backend from `backend` with `npm start` and leave it running.
2. In a second terminal, run `npm install` and `npm run dev` from `frontend`.
3. Open `http://localhost:5173`. The Vite development server proxies the
   `/api` requests to the backend; the browser session remains in an
   HttpOnly cookie and is not stored in local storage.

The interface supports staff sign-in, first-sign-in Officer authenticator
enrollment, session restoration, sign-out, and replacement-Admin and Board
Officer request/review screens. If
`APP_ORIGIN` is set in `backend/.env`, set it to `http://localhost:5173` for
local frontend development so cookie-authenticated mutations pass the
same-origin check.

## Replace an Admin

There is deliberately no public Admin sign-up page. The current Admin submits a
replacement request from **Replace Admin** in the dashboard. The invitation is
not an account and cannot sign in. Either enrolled Board Officer may approve or
reject it independently, with a reason and a fresh authenticator code. The
inviter and invitee cannot approve their own appointment.

The current Admin's own email domain must also be on the allowlist before
requesting a replacement.

Approval issues a single-use setup link that expires after 24 hours. With
Ethereal SMTP, the intended recipient is shown in the Ethereal Messages page;
with other development SMTP hosts, mail is routed to `DEV_TEST_INBOX`. In
production it goes to the allowlisted invitee address over configured SMTP.
The token is stored only as a hash and is never returned by the API or written
to logs. The invitee sets a password and enrolls an authenticator through the
link. A successful first sign-in records the test but does **not** deactivate
the existing Admin.
If email delivery fails or the link expires, only the approving Officer may
reissue it; reissue invalidates the previous link.

### Temporary Admin tester handover

After the replacement Admin has enrolled MFA and completed a successful
test sign-in, run the separate manual `npm run admin-tester:convert` command
from `backend` to convert the original Admin to `ADMIN_TESTER`. It prompts for
the target and replacement Admin, operator, reason, exact confirmation, and a
hidden maintenance-MySQL password; it does not take credentials as arguments
or save them. The original password and MFA credentials are retained, and the
conversion is audited. The tester can submit invitations but cannot approve
them, is excluded from active-Admin counts, and is automatically disabled with
sessions revoked if found during production startup. The server logs a warning
while an active tester exists.

Before production, run `npm run admin-tester:deactivate` as a separate manual
cleanup. It requires the verified replacement Admin to be the only active
`ADMIN`, deactivates (never deletes) the tester, revokes its sessions, and
records the action in `audit_log`. Both commands refuse to run with
`NODE_ENV=production`. The conversion/cleanup MySQL maintenance account needs
only the specific access required to lock and update `app_users`/`app_sessions`
and insert into `audit_log`; do not grant those role-change privileges to the
normal application account.

### Requested Ethereal test data

The temporary test participants are Chairman Kade Bechtelar
(`kade.bechtelar@ethereal.email`), Vice Chairman Jammie Toy
(`jammie.toy82@ethereal.email`), and replacement Admin Brionna Reichert
(`brionna.reichert@ethereal.email`). Run `npm run officer:bootstrap` twice and
enter each Officer's position, name, and email when prompted. Each run asks for
that Officer's password in a hidden prompt; do not put passwords in command
arguments, scripts, or files. Each Officer enrolls an authenticator at first
sign-in. Keep the existing Admin account unchanged, then invite Brionna from its
session. The invitation remains pending until either Board Officer signs in,
enters a fresh authenticator code, and approves it with a reason. To test the
other Officer, use a separate invitation for a different test address.

Brionna's 24-hour setup link is delivered by Ethereal SMTP and can be read in
the configured Ethereal account's Messages page. After her MFA enrollment and
successful test sign-in, run the manual conversion and cleanup commands above
at the appropriate stages. No Officer accounts or email messages are created
until the database migrations are applied, private Ethereal SMTP credentials
are set, and you run the interactive commands.

## Board Officer replacement

`HEAD_OF_IT` is narrowly scoped: it can start Officer replacement requests but
cannot administer accounts, approve/reject replacements, or act as an Officer.
Create it using the interactive trusted bootstrap command; the password is
hidden at the prompt:

```powershell
npm run staff:bootstrap -- --role HEAD_OF_IT
```

For the test scenario, enter Sidney Fisher and
`sidney62@ethereal.email`. Each Board Officer must enroll an authenticator on
first sign-in. Head of IT can request replacement of one position at a time,
naming the incoming person and allowlisted email. The request expires after
seven days, and email notices go to both current Officers. Only the saved
continuing Officer may approve or reject it, using a fresh authenticator code
and providing a reason. Only one uncompleted Officer replacement request may
be open at a time, keeping that saved approver available. Approval sends a
single-use, hash-only setup token
valid for 24 hours. The outgoing Officer remains active until the incoming
Officer sets a password, enrolls MFA, and completes a successful sign-in; the
position transfer and outgoing deactivation are committed atomically. The
continuing Officer can reissue a failed or expired setup link with a reason and
fresh code.

If there is no continuing Officer who can approve (for example, only one
active Officer remains), use the local emergency bootstrap instead:

```powershell
npm run officer:bootstrap -- --emergency-replace
```

Enter the outgoing Officer's position and incoming details at the prompts.
The incoming Officer is staged without a position; the outgoing Officer stays
active until setup and successful sign-in. The emergency action and final
handover are audited. Never use this command when a continuing Officer is
available. Existing databases must apply migrations 05, 06, then
`database/07_roles_and_role_permissions.sql`, then
`database/08_encrypted_pending_authenticator_enrollment.sql` in order. Grant the
application account table access to `officer_replacement_requests` and
column-scoped `UPDATE` on `app_users.officer_position`; retain the no
`UPDATE`/`DELETE` restriction on `audit_log`.

## Troubleshoot MySQL `ER_ACCESS_DENIED_ERROR`

In MySQL Workbench, check whether the configured application login exists:

```sql
SELECT user, host FROM mysql.user WHERE user = 'eNMRIS';
```

If this query returns **0 rows**, the `eNMRIS` MySQL login does not exist; that
explains `ER_ACCESS_DENIED_ERROR`. Create the host-specific accounts, replacing
the password placeholder with the same strong, unique password for both hosts
and in `backend/.env`:

```sql
CREATE USER 'eNMRIS'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD';
CREATE USER 'eNMRIS'@'127.0.0.1'
  IDENTIFIED BY 'REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD';

GRANT SELECT, INSERT ON enmris.app_users
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT UPDATE (
  totp_secret_encrypted, totp_last_used_step, mfa_enrollment_token_hash,
  mfa_enrollment_expires_at, mfa_enrollment_secret_encrypted,
  mfa_enabled, active, officer_position
) ON enmris.app_users
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON enmris.app_sessions
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON enmris.auth_login_attempts
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON enmris.admin_invitations
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON enmris.officer_replacement_requests
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT ON enmris.app_user_permissions
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT ON enmris.roles
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT ON enmris.role_permissions
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
GRANT SELECT, INSERT ON enmris.audit_log
  TO 'eNMRIS'@'localhost', 'eNMRIS'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Run the whole script in Workbench with the execute-script (lightning-bolt)
button and confirm each statement reports success in the Output panel. Then
rerun the `SELECT`; it should return two rows, one for each host.
Restart the backend with `npm start`. The database readiness check should pass;
verify with `Invoke-RestMethod http://localhost:3000/health`. Before production,
rotate any temporary or shared database password and update both the MySQL
accounts and `backend/.env`.
