# APAAR Setu

**A student-project prototype of an AICTE-side "Verified Student Register"** (SIH 2026, problem statement 26263), built with the MERN stack.

> **Prototype with synthetic data only.** APAAR Setu is not an official AICTE, Ministry of Education or APAAR system and is not affiliated with them. It never contacts real APAAR, ABC, DigiLocker or AICTE services: those are clearly labelled **mock adapters**. Never load real student data.

Colleges upload admission records as CSV files. The records are **staged** (not official), checked by a **seven-layer validation pipeline**, corrected by the college operator (maker), and **certified** by the college head (checker). Certification commits the records, seat-ledger changes, history and audit entry in **one MongoDB transaction**. AICTE officers monitor dashboards, cross-college **conflict cases** and rule-based **risk signals**. Students decide which verifiers may see which fields (**consent**), and degree-awarding bodies issue **prototype QR credentials** whose status anyone can check.

The specification this was built from is in [`Instruction/`](Instruction/) (eleven PDFs, the combined PDF, `color_theme.md` and the logo).

---

## Features at a glance

| Area | What works |
| --- | --- |
| Sign-in & roles | 8 roles, server-side sessions (HttpOnly cookie, MongoDB store), bcrypt, CSRF tokens, login throttling, role + institution/region/student scope checks on every API |
| CSV upload | Template + version note, client pre-check, server checks (type sniffing, UTF-8, strict header, size and row limits), duplicate-file guard, `Idempotency-Key` retries |
| Validation | L1 schema · L2 identity (mock) · L3 duplicates · L4 seat ledger · L5 cross-college · L6 consistency · L7 risk signals, with ERROR / WARNING / PENDING / INFO / RISK_FLAG semantics |
| Correction | Edit allowed fields, exclude/include rows, revalidate; old results kept as history; stale results can never unlock the next step |
| Maker-checker | Operator justifies warnings and marks ready; head accepts dispositions, returns or certifies (declaration + typed confirmation) |
| Seat ledger | Per course/year/bucket, synthetic policy versions with maker-checker publishing, atomic reservation, exactly-once release, reconciliation check |
| Conflicts | Detected inside the commit transaction; withdraw / transfer / justify / AICTE review / escalate; minimum disclosure of the other college |
| Risk | Transparent rule-based scores, evidence history, assign / note / reviewed / false positive / escalate - never a fraud verdict |
| Consent | Purpose-bound field allow-list, approve (subset) / deny / revoke / expiry, access history |
| Credentials & QR | Opaque reference with keyed checksum, QR PNG, printable DEMO certificate, public status VALID / REVOKED / INVALID_OR_TAMPERED |
| Audit | Hash-chained events, verify-chain with the failing sequence, tamper demo script |
| Dashboards | Real aggregations for all 8 roles, national/regional drill-down, CSV reports (aggregated, masked) |
| UI | GST-portal-style layout, A- / A / A+ text size, high contrast, English + partial Hindi, keyboard focus, responsive |

## Technology

- **Frontend:** React 19 (JavaScript), React Router 7, Bootstrap 5.3, Bootstrap Icons, Vite 8, self-hosted Noto Sans, `jsqr` (QR decoding in the browser)
- **Backend:** Node.js 22 + Express 5, Mongoose 9, express-session + connect-mongo, bcrypt, helmet, express-rate-limit, csrf-sync, multer + csv-parse, qrcode, zod
- **Database:** MongoDB 8 **replica set** (required for multi-document transactions)
- **Tests:** Node's built-in test runner + Supertest against a real MongoDB replica set (mongodb-memory-server); Vitest + React Testing Library for the client

## Project structure

```
APAAR Setu/
├── Instruction/          # specification PDFs, colour theme and logo (source of truth)
├── fixtures/             # synthetic CSV/JSON fixtures used by the seed, tests and the demo
├── server/
│   ├── src/
│   │   ├── config/       # environment, database, enums + transition tables
│   │   ├── models/       # Mongoose models (one per collection)
│   │   ├── routes/       # REST route registration (thin)
│   │   ├── controllers/  # HTTP request/response handling (thin)
│   │   ├── middleware/   # auth, roles, CSRF, rate limits, upload, validation, errors, logging
│   │   ├── services/     # business rules and transactions
│   │   │   └── validation/   # the seven validation layers + rule catalogue
│   │   ├── validators/   # zod request schemas
│   │   ├── adapters/     # MOCK APAAR identity / AICTE approval / DigiLocker adapters
│   │   ├── seed/         # synthetic demo seed
│   │   └── utils/
│   ├── scripts/          # db:dev, seed, demo:reset, demo:tamper-audit, check:ledger, lint
│   └── tests/            # backend tests (run.js starts a throw-away replica set)
├── client/
│   └── src/
│       ├── app/          # router, app shell, navigation, route guard
│       ├── components/   # shared UI (buttons, tables, badges, modal, forms, toasts)
│       ├── features/     # auth context, preferences (text size, contrast, language)
│       ├── pages/        # pages per role: public, college, aicte, admin, issuer, verifier, student, shared
│       ├── services/     # API client (cookies + CSRF)
│       ├── styles/       # theme tokens from Instruction/color_theme.md
│       └── test/         # Vitest tests
├── docs/                 # architecture, API, demo guide, security, traceability, status
├── e2e/                  # optional headless-browser checks (npm run test:browser)
├── docker-compose.yml    # OPTIONAL replica set for Docker users (untested here)
├── .env.example
└── package.json          # convenience scripts for both packages
```

## Prerequisites

- **Node.js 20.19+ or 22.12+** (built and tested with Node 22.23) and npm
- About **250 MB** of disk for the MongoDB server binary that `mongodb-memory-server` downloads on first install
- No separate MongoDB installation is needed for local development. If you prefer, use your own replica set, MongoDB Atlas, or Docker (see below)

## Installation

```bash
# from the project folder
npm run install:all          # installs root, server/ and client/ dependencies
cp .env.example .env         # then edit .env (see below)
```

Generate a session secret and paste it into `.env` as `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Environment variables

All variables are documented in [`.env.example`](.env.example). The important ones:

| Variable | Purpose | Default |
| --- | --- | --- |
| `MONGODB_URI` | MongoDB connection (must be a replica set for certification) | - (required) |
| `SESSION_SECRET` | Signs the session cookie; 32+ random characters | - (required) |
| `CLIENT_ORIGIN` | React app origin (CORS, activation links) | `http://localhost:5173` |
| `PUBLIC_VERIFY_BASE_URL` | Base URL encoded into QR codes | `CLIENT_ORIGIN` |
| `SESSION_MAX_AGE_MS` / `MAX_UPLOAD_MB` / `MAX_ROWS_PER_BATCH` | Proposed demo limits (not proven capacity) | `3600000` / `5` / `10000` |
| `VALIDATION_MODE` | `async` (background job) or `sync` | `async` |
| `DEMO_PASSWORD` | Optional shared password for seeded demo accounts (development only) | empty = random |

Never commit `.env` (it is in `.gitignore`).

## Database setup (replica set required)

Certification, conflict resolution and enrolment changes use **multi-document transactions**, which MongoDB only supports on a **replica set** or sharded cluster. A standalone `mongod` is detected at start-up: the app still runs, but those actions return `503 TRANSACTIONS_UNAVAILABLE` instead of pretending to be atomic.

**Option A - built-in local replica set (recommended, no installation):**

```bash
npm run db:dev
```

This starts a single-node replica set on port 27017 using the MongoDB binary from `mongodb-memory-server`, keeps data in `.data/mongodb/`, and prints the matching URI (already the default in `.env.example`):

```
MONGODB_URI=mongodb://127.0.0.1:27017/apaar_setu_dev?replicaSet=rs0
```

Leave that terminal open; `Ctrl+C` stops the database.

**Option B - Docker (not tested in the original build environment):** `docker compose up -d`, then use
`MONGODB_URI=mongodb://127.0.0.1:27017/apaar_setu_dev?replicaSet=rs0&directConnection=true`.

**Option C - MongoDB Atlas or your own replica set:** put its connection string in `MONGODB_URI` (Atlas clusters are replica sets). Keep the database name containing `dev`/`demo` if you want to use `npm run demo:reset`.

## Seed the synthetic demo data

```bash
npm run seed
```

The seed refuses to run when `NODE_ENV=production` or when the database contains non-demo users. It creates synthetic regions, institutions, courses, organisations, seat policies `DEMO-v1` (published) and `DEMO-v2` (awaiting approval), the STU-005 cross-college conflict, the 12-student shared-contact risk case, a stale-policy batch, and the demo accounts below. **Passwords are generated randomly and printed once in your terminal** (or set `DEMO_PASSWORD` in `.env`). Re-running is safe: nothing is duplicated and existing passwords are kept unless you pass `-- --reset-passwords`.

To start over (development only, drops the configured database): `npm --prefix server run demo:reset -- --confirm`.

## Run the app

```bash
npm run dev          # API on http://localhost:5000 and React app on http://localhost:5173
```

(or run `npm run dev:server` and `npm run dev:client` in two terminals). Open **http://localhost:5173**. The Vite dev server forwards `/api` to Express, so the browser sees one origin.

**Production-style run:** `npm run build`, then start the server with `NODE_ENV=production` (it serves `client/dist` from the same origin). Behind HTTPS keep `COOKIE_SECURE=true` (the default in production) and set `TRUST_PROXY=1` behind a proxy. To put the demo online (Render + MongoDB Atlas, free tiers), follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Demo accounts (development only)

Created by `npm run seed`, all with reserved `.test` addresses:

| Account | Role | Scope |
| --- | --- | --- |
| `operator.demo@example.test` | College Operator (maker) | ABC-DEMO |
| `head.demo@example.test` | College Head (checker) | ABC-DEMO |
| `national.demo@example.test` | AICTE National Officer | national |
| `regional.demo@example.test` | AICTE Regional Officer | REGION-DEMO |
| `admin.demo@example.test` | AICTE System Administrator | system |
| `issuer.demo@example.test` | Degree-Awarding Body | ISSUER-DEMO (ABC-DEMO, PQR-DEMO) |
| `verifier.demo@example.test` | Verifier | VERIFIER-DEMO |
| `student.demo@example.test` | Student | STU-001 |
| `approver.demo@example.test` | second System Administrator (policy approval) | system |
| `operator.xyz.demo@example.test` / `head.xyz.demo@example.test` | College Operator / Head | XYZ-DEMO (other side of the conflict) |

Passwords are **not** in this repository. They are printed by the seed command only.

Follow [`docs/DEMO_GUIDE.md`](docs/DEMO_GUIDE.md) for the seven-minute demonstration.

## Tests

```bash
npm test                 # backend (182 tests) + frontend (25 tests)
npm run test:server      # starts a throw-away MongoDB replica set, isolated database per test file
npm run test:client      # Vitest + React Testing Library
npm run lint             # syntax check of all server files
npm run build            # production build of the client
```

Backend tests never touch your development data. To reuse an existing replica set for tests, set `TEST_MONGODB_URI`.

**Optional browser checks** (headless Chrome, needs the app running with seeded data): `E2E_PASSWORD=<your DEMO_PASSWORD> npm run test:browser` - see [`e2e/README.md`](e2e/README.md).

## Useful developer scripts

| Command (inside `server/`) | What it does |
| --- | --- |
| `npm run db:dev` | Local single-node replica set |
| `npm run seed` | Synthetic demo data (safe to re-run) |
| `npm run demo:reset -- --confirm` | Drop the dev/demo database and re-seed (refuses in production / on non-dev names) |
| `npm run demo:tamper-audit -- --sequence 12` | Alter one audit event directly in MongoDB to demonstrate detection; `-- --restore` undoes it |
| `npm run check:ledger` | Compare seat counters with enrolments holding seats |

## Prototype limitations (read before demonstrating)

- Synthetic data only; identity checks, AICTE approval data and DigiLocker are **mock adapters**.
- Seat capacities, admission windows and risk thresholds are **synthetic configuration**, not official policy.
- QR codes hold a link with an opaque reference (with a keyed checksum). They are **not signed verifiable credentials** and cannot be verified offline.
- The audit hash chain **detects** uncoordinated changes; it does not make MongoDB tamper-proof.
- No OTP/e-sign, email delivery, MFA or production identity provider. Activation/reset links are shown once to the administrator.
- No performance, accuracy or compliance claims have been measured. A formal WCAG/GIGW audit has not been done.

More detail: [`docs/SECURITY_AND_LIMITATIONS.md`](docs/SECURITY_AND_LIMITATIONS.md). Other docs: [architecture](docs/ARCHITECTURE.md) · [API reference](docs/API_REFERENCE.md) · [deployment](docs/DEPLOYMENT.md) · [requirements traceability](docs/IMPLEMENTATION_REQUIREMENTS_TRACEABILITY.md) · [implementation status](docs/IMPLEMENTATION_STATUS.md).
