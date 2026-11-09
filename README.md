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

The repository currently contains the initial project scaffold. The database
schema and API contract should be agreed before application features are added.
Use synthetic data for development until MRA data is approved for use.

## Run the backend health check

1. In MySQL Workbench, run `database/01_schema.sql`, then `database/02_seed.sql`.
   To verify the import, run
   `SELECT COUNT(*) FROM enmris.products;` and
   `SELECT COUNT(*) FROM enmris.product_programmes;` (expected: 19 and 18).
2. Create a restricted MySQL application account in Workbench.
3. From `backend`, copy `.env.example` to `.env` if needed and set
   `DB_USER` and `DB_PASSWORD` for that account. Do not commit `.env`.
4. Run `npm install`, `npm test`, and `npm start`.
5. In PowerShell, check readiness with
   `Invoke-RestMethod http://localhost:3000/health`. A ready response reports
   both the API and database as `ok`; a database connection failure returns
   HTTP 503.
