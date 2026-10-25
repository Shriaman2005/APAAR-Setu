# Implementation status

Factual record of the build (started 2026-10-24 from an empty folder containing only `Instruction/`). Nothing below is marked done unless it was implemented **and** checked as stated.

## 1. Specification review

- All eleven individual PDFs (`00`-`10`) were read in full, plus `color_theme.md` and the logo.
- The combined PDF `AICTE_Complete_Vibecoding_Specification.pdf` (49 pages) was compared with the individual files: its extracted text is identical to their concatenation (0 differing lines), so there are no conflicts between them.
- The architecture diagram page (05, page 2) was rendered and checked against its text.
- The specs are in `Instruction/`, not `docs/specs/AICTE_Vibecoding_Spec_Pack/` as the original prompt expected; they were left where they are.

## 2. What is implemented

All eight roles with backend permissions and working UI flows (see `IMPLEMENTATION_REQUIREMENTS_TRACEABILITY.md` for the item-by-item mapping):

- Authentication: sessions in MongoDB, bcrypt, CSRF, throttling, activation/reset links, disable/enable, change password.
- CSV upload → staging → seven validation layers (async in-process job) → correction/exclusion/revalidation with history → operator justification → mark ready → head disposition acceptance / return / certification.
- Transactional commit with atomic seat reservation, conflict detection and audit; idempotent retries; restart recovery.
- Seat policies with maker-checker publishing, version compare, stale-policy handling; seat ledger with database validator and reconciliation.
- Enrolment lifecycle with exactly-once seat release; conflict workflow (withdraw, transfer, justify, AICTE review, escalate).
- Rule-based risk cases (assign, notes, reviewed, false positive, escalate).
- Verifier onboarding, purpose-bound consent with field allow-list, approve/deny/revoke/expiry, access history.
- Degree-awarding body credentials, QR PNG, printable DEMO certificate, public status page with camera/image/manual input, revocation.
- Hash-chained audit with verify-chain and a development tamper/restore script.
- Dashboards for all roles from real aggregations; national/regional drill-down; masked CSV reports.
- GST-portal-style UI with text size, high contrast, partial Hindi, responsive layout.
- Synthetic fixtures, safe idempotent seed, development-only reset, local replica-set launcher.

## 3. Commands run and results (latest run, 2026-10-25)

| Command | Result |
| --- | --- |
| `npm run test:server` (Node test runner + Supertest, real MongoDB 8.2.6 single-node replica set from mongodb-memory-server) | **182 passed, 0 failed** (43 suites, ~72 s) |
| `npm run test:client` (Vitest 5 + React Testing Library, jsdom) | **25 passed, 0 failed** (3 files) |
| `npm run lint` (syntax check of all server files) | **118 files OK** |
| `npm run build` (Vite 8 production build) | **Success**; main chunk 330 kB (102 kB gzip), role areas lazy-loaded |
| `npm audit` in root, `server/` (also `--omit=dev`) and `client/` | **0 vulnerabilities** each |
| `npm run db:dev` | Local replica set `rs0` started on 127.0.0.1:27017 |
| `npm run seed` twice, then `demo:reset -- --confirm` | Created demo data; second run idempotent (passwords unchanged, scenario not duplicated) |
| `npm run test:browser` (headless Chrome 156 via puppeteer-core, app started with `npm run dev`) | Journey **11/11 steps passed**, route sweep **60/60 routes** across all 8 roles, no console errors / page errors / 5xx; journey re-run on the same database also passed |
| Production mode (`NODE_ENV=production`, Express serving `client/dist`) | SPA and deep links served; CSP, HSTS, nosniff, frame and referrer headers present; session cookie `HttpOnly; SameSite=Lax`; app renders under the CSP with no errors and self-hosted Noto Sans loaded |
| Manual API flow through the Vite proxy with curl (upload → validate → mark ready → certify; operator certify attempt) | Committed 4 rows; operator received 403 |

Environment: Ubuntu 24.04, Node 22.23.4, npm 11.13. Docker and a system MongoDB were **not** available, so the Docker Compose file is untested.

## 4. Defects found during the build and fixed

| Defect | How it was found | Fix |
| --- | --- | --- |
| `RiskCase.events` used a key named `type`, which Mongoose read as a type declaration; the seed failed and the failed test setup left a connection open (test run hung) | first test run | `type: { type: String }`; test setup disconnects on failure; `--test-force-exit` |
| Router-wide `requireAuth` on routers mounted at `/api` would have returned 401 for public routes registered later | code review before first run | per-route `requireRole` (which also returns 401) |
| Batch `transition()` trusted callers' "from" states instead of the transition table | code review | checks `BATCH_TRANSITIONS`; table extended with the two COMMIT_FAILED exits it needed |
| **Modal focus jumped to the first field after every keystroke** (typing "REGULAR" put "R" in one field and "EGULAR" in another) | headless-browser check | modal open/close effect runs once; latest callbacks read through refs; regression test added |
| KPI tile modifier classes clashed with badge classes (tiles filled green/yellow) | screenshot review | `kpi-*` class names |
| Changing the PENDING-identity policy did not flag batches validated under the old policy | review while writing the demo guide | affected open batches are marked revalidation-required; end-to-end test added |
| Several test rows reused synthetic identifiers already linked to other seeded students (the app correctly rejected them) | failing tests | reserved identifiers `100000000001`-`100000000020` for tests; browser journey generates fresh identifiers |

## 5. Partially done or not done

| Item | Status |
| --- | --- |
| Hindi language | Partial: site chrome, home and sign-in only (labelled "partial") |
| Camera QR scanning | Implemented (getUserMedia + jsQR); not exercised automatically (no camera in headless tests). Image upload and manual entry paths are covered |
| Server crash/restart recovery | Implemented (`recoverInterruptedJobs`); not tested by killing a real process mid-job |
| INFO severity | Supported end to end, but no current rule emits INFO |
| Accessibility audit (Lighthouse/axe/WCAG/GIGW) | Not done - no compliance claim is made |
| Docker Compose replica set | Provided, untested (Docker unavailable) |
| Real APAAR / ABC / DigiLocker / AICTE integrations, OTP/e-sign, email, MFA/SSO, signed credentials, durable job queue, load testing | Out of prototype scope by specification; mock adapters and labels used instead |
| Public deployment | Live demo on Render (free web service from `render.yaml`) with a MongoDB Atlas M0 cluster, set up as in [`DEPLOYMENT.md`](DEPLOYMENT.md). Verified on the live site on 2026-10-25: health (Atlas replica set, transactions available); sign-in, session and dashboard for all 11 demo accounts; sample batch certified on Atlas; 58-page headless-Chrome sweep with no errors; CSP and HSTS headers; `HttpOnly; Secure; SameSite=Lax` session cookie; HTTP redirects to HTTPS. The free instance sleeps when idle |

## 6. Assumptions and decisions (proposed implementation, not official policy)

- Two-step warning disposition (operator justifies, head accepts); PENDING identity checks block by default.
- Duplicate key: student code or demo identifier + course + academic year; "already active at this institution" is also an L3 error.
- PROVISIONAL and CONFIRMED occupy seats; leaving them releases the seat exactly once.
- Stale seat-policy version → certification refused and batch sent back for revalidation.
- Synthetic values: capacities (spec 10 DEMO-v1), admission window 2026-07-01 to 2026-09-30, risk thresholds (3 shared students, 50% additional buckets with ≥5 rows), score formulas, 14-day conflict review target, 1/7/30-day consent expiry options, verification purposes and field allow-lists, 72 h activation / 24 h reset links.
- Extra demo accounts: `approver.demo` (second administrator for policy maker-checker) and the XYZ-DEMO operator/head (other side of the conflict).
- Additional collections and endpoints are listed in the traceability document.

## 7. Git checkpoints (local only, nothing pushed)

Milestone commits on branch `main`: server foundation → backend tests → client → documentation and browser checks. See `git log`.

## 8. Suggested next steps

1. Run Lighthouse/axe on the main pages and fix findings before any accessibility claim.
2. Have a faculty reviewer walk through `DEMO_GUIDE.md` on a fresh `demo:reset` database.
3. If the project continues: move rate limits and validation jobs to shared/durable stores for multi-instance hosting, add a signed-credential design (keys + offline verification) and protected audit checkpoints, and obtain real policy values from authorised owners.
