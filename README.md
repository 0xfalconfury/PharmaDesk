# PharmaDesk v2

A Node.js + Express + PostgreSQL pharmacy inventory and sales application.

## Included
- Admin sign-in, password change, rate-limited login, server-side sessions
- Medicine catalogue and archive
- Batch-based inventory with expiry alerts
- Expired batches excluded from sales; sales allocate FIFO by nearest expiry
- Supplier and purchase recording / stock-in
- Stock adjustments and movement history
- Customer suggestions by phone/name
- Sales, PDF receipts and date-range PDF sales reports
- Revenue, gross profit, expenses and date-range analytics
- Audit log
- PostgreSQL backup/restore command guidance

## Requirements
- Node.js 18+
- PostgreSQL 14+

## Setup (Windows PowerShell)
1. Extract the ZIP and open the `pharmadesk` folder in PowerShell.
2. Install packages:
   ```powershell
   npm install
   ```
3. Create a PostgreSQL database:
   ```sql
   CREATE DATABASE pharmadesk;
   ```
   You can run that in pgAdmin Query Tool or `psql`.
4. Copy `.env.example` to `.env`, then set your PostgreSQL password and a long random `SESSION_SECRET`.
5. Run the schema against the database. If `psql` is not in PATH, use the PostgreSQL executable path with PowerShell's call operator:
   ```powershell
   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d pharmadesk -f schema.sql
   ```
   Change `16` to your installed PostgreSQL version. Alternatively, open `schema.sql` in pgAdmin Query Tool and execute it while connected to `pharmadesk`.
6. Create the first admin:
   ```powershell
   npm run create-admin
   ```
7. Start:
   ```powershell
   npm run dev
   ```
8. Open `http://localhost:3000`.

## Inventory workflow
1. Add medicine records in Medicines.
2. Add suppliers.
3. Record each delivery in Purchases. Each purchase line creates a batch with its batch number, expiry date, purchase cost, selling price and quantity.
4. Sales consume eligible batches in FEFO order (earliest expiry first). Expired batches are never sold.
5. Use Stock history for reasoned adjustments. Never silently edit quantities.

## Profit calculation
Gross profit is calculated from the actual batch purchase-cost snapshots allocated to each sale. Net after expenses = gross profit - recorded operating expenses. This is a simplified operational calculation; it does not include tax, returns, payment fees, or other accounting adjustments.

## Backup and recovery
Run commands on a trusted server/administrator machine, not from the browser:
```powershell
mkdir backups
pg_dump -Fc -U postgres -d pharmadesk -f backups/pharmadesk.dump
```
Restore to a maintenance database or after confirming the target database can be replaced:
```powershell
pg_restore --clean --if-exists -U postgres -d pharmadesk backups/pharmadesk.dump
```
Protect backup files: they contain customer and business data. Keep encrypted off-site copies and test restores regularly. Never place backups in `public/`.

## Production checklist
- Set a unique long `SESSION_SECRET`; never use the development fallback.
- Set `NODE_ENV=production`, `COOKIE_SECURE=true`, and serve behind HTTPS.
- Configure PostgreSQL least-privilege credentials, firewall and encrypted backups.
- Add CSRF protection and a strict Content Security Policy before public deployment. The starter disables Helmet CSP because Chart.js and fonts are loaded from CDNs; self-host those assets and enable a tailored CSP before deployment.
- Add pagination, automated tests, monitoring, and a reviewed migration process.
- Restrict access to the admin portal. Do not expose this application directly to the public internet without a security review.

## Important migration note
This version uses batch-level stock. It is designed as a fresh schema. Do not run `schema.sql` over an existing production database as a substitute for a migration. Back up the old database first; migrate existing medicine quantities into one clearly labelled opening-stock batch per medicine, preserving existing sales history. Because the exact previous schema may differ, inspect it before writing/running a migration script.
