# TaxiTrack

TaxiTrack is a small taxi management MVP built with React, Express, and PostgreSQL. It has separate client, driver, and administrator views.

## Requirements

- Node.js 20.19+ or 22.12+
- PostgreSQL
- npm

## Local setup

### 1. Create the database

In pgAdmin, create a database named `taxi_management`.

### 2. Configure the backend

In PowerShell:

```powershell
cd backend
npm ci
Copy-Item .env.example .env
```

Edit `backend/.env` and set `DATABASE_URL` to your local PostgreSQL username and password. Replace `JWT_SECRET` with a private random value of at least 32 characters. Keep `.env` local; never commit it or paste its values into a public issue.

Run the database migrations and start the API:

```powershell
npm run db:migrate
npm run dev
```

The API runs at `http://localhost:3000`. Check its database connection at `http://localhost:3000/api/health`.

### 3. Start the frontend

Open a second PowerShell window at the project root:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`.

## Prepare demo accounts

Clients can register from the sign-in page. Admin and driver accounts are created by the backend script. Add these private values to `backend/.env`, using your own names, email addresses, and passwords of at least 12 characters:

```dotenv
SEED_USER_FULL_NAME=
SEED_USER_EMAIL=
SEED_USER_PASSWORD=
SEED_USER_ROLE=admin
```

Then run this from `backend`:

```powershell
npm run auth:create-user
```

Change the four values to create a driver account and run the command again. The script creates new accounts only; it does not change an existing account's role. Do not add these values to `.env.example` or commit `.env`.

## Demo flow

1. Sign in as a client, select Pickup and click the map, then select Destination and click the map. Edit the generated coordinate labels if you want to show street addresses.
2. Request a taxi. If OSRM is reachable, the request includes estimated road distance, travel time, and fare. If not, the request is still saved without invented estimates; the client can retry the estimate later.
3. Sign in as an administrator and assign the pending request to the driver. The administrator can filter the ride list by date, client, or driver.
4. Sign in as the assigned driver, accept the request, then use Start Trip and End Trip.
5. Review the trip history from the client, driver, and administrator views.

OSRM requires internet access for route suggestions and estimates. Trip completion does not depend on OSRM or continuous GPS tracking. The administrator's date filter uses the ride's `created_at` timestamp.

## Checks

Run these from their respective folders:

```powershell
# backend
npm test

# frontend
npm test
npm run lint
npm run build
```

Tests use mocked routing/database responses for trip calculations. The full workflow should also be demonstrated manually using local accounts and PostgreSQL.

## Before publishing

- Confirm `.env` and account passwords are not staged or committed.
- Run the checks above and complete the demo flow.
- Configure production database, HTTPS, allowed frontend origin, and a private JWT secret before deploying. The development server and public OSRM endpoint are intended for local demonstration, not production traffic.
