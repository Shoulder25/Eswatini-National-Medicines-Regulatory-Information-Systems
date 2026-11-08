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
