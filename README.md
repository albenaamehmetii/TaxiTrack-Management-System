# TaxiTrack

TaxiTrack is a role-based taxi ride management application built with React, Express, and PostgreSQL. Riders can request and review rides, drivers manage their availability and assigned rides, and administrators review driver applications, assign drivers, and inspect ride history.

> **Project scope:** TaxiTrack is a demonstration and management system. It does not track a real taxi continuously. OSRM distance, duration, and fare values are estimates; the actual ride duration is measured between the driver's Start and End actions.

## Contents

- [Features](#features)
- [Technology and architecture](#technology-and-architecture)
- [Screenshots](#screenshots)
- [Ride lifecycle and calculations](#ride-lifecycle-and-calculations)
- [Roles and access](#roles-and-access)
- [Database overview](#database-overview)
- [HTTP API](#http-api)
- [Requirements and local setup](#requirements-and-local-setup)
- [Environment configuration](#environment-configuration)
- [Tests and quality checks](#tests-and-quality-checks)
- [Known limitations](#known-limitations)
- [Repository structure](#repository-structure)

## Features

### Rider

- Register and sign in as a rider.
- Choose pickup and destination points on a Leaflet map and provide location labels.
- Create a ride request and see its status, assignment, estimates, and history.
- Cancel a request while its current status permits cancellation.
- Rate a completed ride with one to five stars and an optional comment.
- See the assigned driver's contact number for the rider's own assigned ride when available.

### Driver

- Apply for a driver account with a phone number, license number, and vehicle registration number.
- Wait for administrator approval before signing in as a driver.
- Set online/offline status and save a current location through GPS or map selection.
- View assigned requests, accept a request, and use Start and End to progress an accepted ride.
- Receive in-app notifications for new requests, cancellations, and ratings.

### Administrator

- Review and approve or reject driver applications.
- View users, ride requests, ride history, and ratings.
- Assign an online, approved, available driver to a pending request.
- View pickup and destination, rider and driver, ride status, estimated distance and time, estimated fare, and actual elapsed ride duration where available.

## Technology and architecture

| Area | Implementation |
| --- | --- |
| Frontend | React 19, Vite 8, Leaflet |
| Backend | Node.js, Express 5 |
| Database | PostgreSQL, accessed through `pg` and SQL migrations |
| Authentication | bcrypt password hashes, signed JWTs, HTTP-only cookie sessions, role checks |
| Route estimates | OSRM public routing service |
| Frontend tests | Node test runner |
| Backend tests | Node test runner with mocked database and routing dependencies |

```mermaid
flowchart LR
  U[Browser: React + Leaflet] -->|JSON HTTP, credentials| API[Express API]
  API --> AUTH[Authentication and role middleware]
  API --> DB[(PostgreSQL)]
  API -->|Route estimate request| OSRM[Public OSRM service]
```

The frontend communicates with the backend over JSON HTTP requests. The backend owns authentication, authorization, ride transitions, availability checks, and database writes. Driver notifications are refreshed by polling; the application does not use a WebSocket connection.

## Screenshots

The screenshots below are stored in the repository's [`screenshots/`](screenshots/) directory.

<details>
<summary>Authentication and registration</summary>

![Login page](screenshots/login-page.png)

![Rider registration](screenshots/registration-rider-page.png)

![Driver registration](screenshots/registration-driver-page.png)

![Driver application pending](screenshots/driver-application-pending.png)

</details>

<details>
<summary>Rider experience</summary>

![Rider dashboard](screenshots/rider-dashboard.png)

![Ride request map](screenshots/ride-request-map.png)

![Ride request pending](screenshots/ride-request-pending.png)

![Taxi on the way](screenshots/taxi-on-the-way.png)

![Trip in progress](screenshots/trip-in-progress.png)

![Ride cancelled](screenshots/ride-cancelled.png)

![Rider ratings](screenshots/rider-ratings.png)

</details>

<details>
<summary>Driver experience</summary>

![Driver dashboard](screenshots/driver-dashboard.png)

![Driver online status](screenshots/driver-status-online.png)

![Driver ride request](screenshots/driver-ride-request.pn.png)

![Driver trip in progress](screenshots/driver-trip-in-progress.png)

![Driver trip completed](screenshots/driver-trip-completed.pn.png)

![Driver notifications](screenshots/driver-notifications.png)

</details>

<details>
<summary>Administrator experience</summary>

![Administrator dashboard](screenshots/admin-dashboard.png)

![Pending ride requests](screenshots/admin-pending-requests.png)

![Driver applications](screenshots/admin-driver-applications.png)

![Approve or reject driver applications](screenshots/administrator-approve-reject-applications.png)

![Ride history](screenshots/admin-ride-history.png)

![Ratings history](screenshots/admin-ratings-history.png)

</details>

## Ride lifecycle and calculations

1. A rider chooses pickup and destination coordinates and submits a request. The backend stores the ride in PostgreSQL with `pending` status.
2. When the OSRM service is reachable, the backend requests a driving route estimate. It stores estimated distance, estimated travel time, and a fare calculated from the configured base fare and per-kilometre rate. An estimate can be retried for a pending ride. If OSRM is unavailable, the request is still stored and estimate fields can remain empty.
3. An administrator assigns an online, approved, available driver to a pending request. The backend validates availability within its assignment logic; an accepted or in-progress ride makes the driver unavailable for another active ride.
4. The assigned driver accepts the request. The driver can start only an accepted ride and end only an in-progress ride.
5. The backend records the Start and End timestamps. Actual elapsed duration is derived from those timestamps and stored when the ride ends.
6. The rider and administrator can review the resulting ride data. A rider can submit a rating for an eligible completed ride.

The fare is an **estimate**, not a payment or billing transaction. The estimated OSRM route is not a live GPS trace. The current Start and End actions record ride state and timestamps; they do not capture actual device coordinates. Although the database has optional start/end coordinate columns and the API includes driver location-point endpoints, the current user interface does not submit continuous GPS points as part of a trip.

## Roles and access

| Role | Account creation | Main access |
| --- | --- | --- |
| Rider (`client`) | Public registration | Create and manage own ride requests, see own history, rate eligible completed rides |
| Driver (`driver`) | Registration requires an application and administrator approval | Manage presence, see assigned rides and notifications, accept/start/end eligible rides |
| Administrator (`admin`) | Created through the backend account creation script; no public admin registration | Review driver applications, assign drivers, view users, rides, and ratings |

Public registration accepts rider and driver roles only. A driver application is pending until an administrator approves it; pending or rejected driver accounts cannot sign in as active drivers. Protected routes and API endpoints use authentication and role checks.

## Database overview

The database is initialized by versioned SQL migrations in `server/migrations/`. The schema includes:

| Table | Purpose |
| --- | --- |
| `users` | Accounts, unique email, password hash, role, session version |
| `driver_applications` | Driver contact and vehicle registration details, review status, and reviewer timestamps |
| `driver_presence` | Driver online state and the last saved presence location |
| `rides` | Rider and assigned driver references, pickup/destination, status, estimates, fare, and lifecycle timestamps |
| `ride_locations` | Optional driver-recorded GPS points associated with a ride |
| `driver_notifications` | Driver notifications and read state |
| `ride_ratings` | One rating per ride, star score, and optional comment |
| `schema_migrations` | Applied migration names and timestamps |

Rides reference the rider and, when assigned, the driver. Ride location points are linked to their ride. Ratings are linked to the rated ride, rider, and driver. See the migration SQL for exact fields, constraints, and indexes.

## HTTP API

All API routes are mounted under `/api`. Protected routes require an authenticated session and the appropriate role. The route handlers are the source of truth for request validation and response fields.

### Health and authentication

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Check API and database health |
| `POST` | `/api/auth/register` | Public | Register a rider or submit a driver application |
| `POST` | `/api/auth/login` | Public | Sign in |
| `GET` | `/api/auth/me` | Optional session | Read the current authentication state |
| `POST` | `/api/auth/logout` | Authenticated | Invalidate the current session and clear its cookie |

### Rides and driver presence

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/rides` | Rider | Read the rider's rides and available-driver count |
| `POST` | `/api/rides` | Rider | Create a ride request |
| `PATCH` | `/api/rides/:id/cancel` | Rider | Cancel an eligible own ride |
| `POST` | `/api/rides/:id/rating` | Rider | Submit a rating for an eligible completed ride |
| `POST` | `/api/rides/:id/rating/skip` | Rider | Skip the rating prompt for the current flow |
| `POST` | `/api/rides/:id/estimate` | Rider | Retry an estimate for an eligible pending ride |
| `GET` | `/api/rides/:id/approach-estimate` | Rider | Read an approach-time estimate for an assigned driver where available |
| `GET` | `/api/rides/assigned` | Driver | Read rides assigned to the driver |
| `PATCH` | `/api/rides/:id/accept` | Assigned driver | Accept an assigned request |
| `PATCH` | `/api/rides/:id/start` | Assigned driver | Start an accepted ride |
| `PATCH` | `/api/rides/:id/end` | Assigned driver | End an in-progress ride |
| `GET` | `/api/rides/presence` | Driver | Read the driver's presence state |
| `PUT` | `/api/rides/presence` | Driver | Set online/offline status and presence location |
| `POST` | `/api/rides/:id/locations` | Assigned driver | Record a location point for an eligible active ride |
| `GET` | `/api/rides/:id/locations` | Assigned driver | Read location points for an eligible active ride |
| `GET` | `/api/rides/notifications` | Driver | Read driver notifications |
| `PATCH` | `/api/rides/notifications/read-all` | Driver | Mark all driver notifications as read |
| `PATCH` | `/api/rides/notifications/:id/read` | Driver | Mark one driver notification as read |

### Administrator

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/driver-applications` | Administrator | List driver applications |
| `PATCH` | `/api/admin/driver-applications/:id/review` | Administrator | Approve or reject an application |
| `GET` | `/api/admin/users` | Administrator | List users |
| `GET` | `/api/admin/ratings` | Administrator | Read ratings and rating summaries |
| `GET` | `/api/admin/rides` | Administrator | Read ride and history data |
| `PATCH` | `/api/admin/rides/:id/assign-driver` | Administrator | Assign an eligible driver to a pending ride |

The root endpoint `GET /` returns basic service information. The backend currently polls no external event broker; driver notification updates are obtained by frontend polling.

## Requirements and local setup

### Requirements

- Node.js 20.19+ or 22.12+
- npm
- PostgreSQL
- Internet access for OSRM route estimates and route suggestions

### 1. Get the source and install dependencies

```powershell
git clone <repository-url>
cd Taxi-Management-System

cd server
npm ci

cd ..\client
npm ci
cd ..
```

Replace `<repository-url>` with the GitHub URL for your copy of the project.

### 2. Create a PostgreSQL database

Create a local database named `taxi_management`, for example through pgAdmin or `createdb`. Configure the connection string in `server/.env` in the next step.

### 3. Configure and start the backend

```powershell
Set-Location .\server
Copy-Item .env.example .env
```

Edit `server/.env` and set `DATABASE_URL` to your PostgreSQL connection. Replace the example `JWT_SECRET` with a private random value of at least 32 characters. Keep `.env` private and out of Git.

Apply the migrations and start the API:

```powershell
npm run db:migrate
npm run dev
```

The API defaults to `http://localhost:3000`; health is available at `http://localhost:3000/api/health`.

### 4. Create an administrator account

The project does not provide public administrator registration. For local development, put these values in `server/.env`:

```dotenv
SEED_USER_FULL_NAME=TaxiTrack Administrator
SEED_USER_EMAIL=admin@example.test
SEED_USER_PASSWORD=replace-with-a-private-password-of-12-or-more-characters
SEED_USER_ROLE=admin
```

Then run from `server`:

```powershell
npm run auth:create-user
```

The script creates a new account and does not change the role of an existing account. Do not commit the populated `.env` file. Driver accounts should normally be created through the registration flow so that a driver application is recorded for administrator review.

### 5. Start the frontend

Open a **new PowerShell terminal** at the project root. Start the client from its new folder:

```powershell
Set-Location .\client
npm run dev
```

Open `http://localhost:5173`. The frontend defaults to an API at `http://localhost:3000`. If your backend runs elsewhere, set `VITE_API_URL` in the frontend environment before starting Vite.

## Environment configuration

The committed backend template is [`server/.env.example`](server/.env.example). Values and defaults are:

| Variable | Purpose | Default / requirement |
| --- | --- | --- |
| `PORT` | Backend HTTP port | `3000` |
| `FRONTEND_URL` | Allowed frontend origin for CORS | `http://localhost:5173` |
| `DATABASE_URL` | PostgreSQL connection string | Must be set for the local database |
| `JWT_SECRET` | Secret used to sign session tokens | Set a private random value of at least 32 characters |
| `RIDE_BASE_FARE` | Base component of the fare estimate | `2.00` |
| `RIDE_PRICE_PER_KM` | Per-kilometre component of the fare estimate | `0.75` |
| `VITE_API_URL` | Frontend API base URL | Optional; defaults to `http://localhost:3000` |

`SEED_USER_FULL_NAME`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`, and `SEED_USER_ROLE` are read by the account creation script when creating an initial admin or driver account. They are intentionally not part of the shared environment template.

## Tests and quality checks

Run the available scripts from each package directory:

```powershell
# Backend
cd server
npm test

# Frontend, from another terminal or after returning to the project root
cd ..\client
npm test
npm run lint
npm run build
```

Backend tests cover authentication and ride workflows using mocked database/routing dependencies. Frontend tests cover location and route utility behavior. These automated tests do not replace verification against a separately running PostgreSQL instance. A complete local demonstration should also check migrations, account approval, assignment, accept, Start, End, and the resulting history using local accounts.

## Known limitations

- OSRM distance, duration, and fare values are estimates. OSRM availability depends on an external public service and internet access.
- Actual ride duration is based on server-side Start and End timestamps. The app does not verify a real-world pickup or destination arrival.
- Start and End do not save actual device coordinates. The optional ride-location API and table exist, but the current trip UI does not record a continuous GPS route.
- The route drawn for a request is a suggested route, not a live vehicle trace.
- No payment processing is implemented; the displayed fare is an estimate.
- Driver notifications are refreshed by polling rather than a persistent real-time connection.
- Login throttling is held in the backend process memory. It is reset when the process restarts and is not shared across multiple backend instances.
- The rating skip action does not create a stored rating or a persisted skip record.
- Automated tests use mocks for database and external routing behavior; there is no claim here of a full automated PostgreSQL end-to-end test.

## Repository structure

```text
Taxi-Management-System/
├── client/
│   ├── public/
│   ├── src/
│   │   ├── api/                 # API configuration
│   │   ├── components/
│   │   │   ├── maps/            # Leaflet map
│   │   │   └── TripSummary.jsx
│   │   ├── pages/
│   │   │   ├── admin/           # Administrator dashboard
│   │   │   ├── driver/          # Driver dashboard and status page
│   │   │   └── rider/           # Rider history, ratings, and ride progress
│   │   ├── utils/               # GPS, routing, tests, and ride formatters
│   │   ├── App.jsx              # App state and role-based screen selection
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.jsx
│   ├── eslint.config.js
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.js
├── server/
│   ├── migrations/              # Versioned PostgreSQL SQL migrations
│   ├── src/
│   │   ├── admin/
│   │   ├── auth/
│   │   ├── db/                  # Pool, migration runner, account scripts
│   │   ├── rides/
│   │   └── server.js
│   ├── tests/
│   ├── .env.example
│   ├── package.json
│   └── package-lock.json
├── screenshots/
├── .gitignore
└── README.md
```

## Project status

TaxiTrack demonstrates account roles, driver application approval, ride request and assignment workflows, estimated route and fare information, ride lifecycle actions, ratings, notifications, and administrator history. It is suitable as an academic or local demonstration with PostgreSQL configured. Production deployment would require operational hardening, production-grade rate limiting, deployment-specific secrets and origins, and end-to-end verification against the deployed database and routing setup.
