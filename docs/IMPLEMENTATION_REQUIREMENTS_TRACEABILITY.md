# Requirements traceability

Maps the mandatory requirements in [`Instruction/`](../Instruction/) to code and tests. Spec files are referred to by their number (`01` = `01_Problem_Statement_and_Product_Scope.pdf`, ...). The combined PDF `AICTE_Complete_Vibecoding_Specification.pdf` was checked against the eleven individual PDFs: its extracted text is identical to their concatenation, so no conflicts between them were found.

Status: **Done** = implemented and covered by an automated test (backend `server/tests/*.test.js`, frontend `client/src/test/*.test.jsx`) or a recorded browser check; **Done (manual)** = implemented and checked in the headless-browser run only; **Partial** = closest safe version, limitation stated; **Not done** = deliberately out of scope.

Paths: `S/` = `server/src/`, `C/` = `client/src/`, `T/` = `server/tests/`.

## 00 / 01 / 02 - Scope, stack, invariants

| # | Requirement (source) | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 1 | Stack React + JS + Bootstrap, Node/Express, MongoDB/Mongoose; no TS/Nest/Postgres/Redis/Keycloak (00 §4, 02 §1-2) | `client/`, `server/` | build + test runs | Done |
| 2 | Synthetic data only; no real APAAR/Aadhaar/DOB (00 §4, 08 §3, 10 §1) | `fixtures/`, `S/adapters/fixtures/`, L1 rejects phone-like tokens | `T/validation.test.js` (formats) | Done |
| 3 | External systems behind named mock adapters (00 §4, 05 §2) | `S/adapters/mock*Adapter.js` | `T/validation.test.js` (L2), `T/credential.test.js` (DigiLocker mock) | Done |
| 4 | Capacities from identified config, no hard-coded quotas (00 §4, 07 §5) | `SeatPolicy` + `SeatLedger` with `sourceType`/`sourceReference`; fixtures `seat_policy_demo_v*.json` | `T/admin-policy.test.js` | Done |
| 5 | Only the server validates, authorises, reserves, commits (00 §4, 02 §7) | services + middleware | all backend tests | Done |
| 6 | Risk score = priority signal, never fraud verdict (00 §4, 07 L7) | `S/services/riskService.js`, L7 layer, UI notices | `T/risk.test.js` | Done |
| 7 | URL QR is not a signed credential; labelled (00 §4, 08 §5) | `S/services/credentialService.js` disclaimer, UI warnings, certificate watermark | `T/credential.test.js` | Done |
| 8 | Staging separate from official register (01 §2, 06 §2) | `StagingRow` vs `Enrolment` | `T/upload.test.js` "no official records" | Done |
| 9 | Primary user story steps 1-9 (01 §4) | whole system | `T/zz-e2e.test.js`, browser run | Done |
| 10 | Demo acceptance storyline (01 §7) | see `docs/DEMO_GUIDE.md` | e2e + browser run | Done |
| 11 | Env config incl. 5 MB / 10,000 rows / 1 h session (02 §5) | `S/config/env.js`, `.env.example` | `T/upload.test.js` limits, `T/auth.test.js` expiry | Done |
| 12 | Replica-set transactions documented and tested; standalone not presented as transactional (02 §6) | `S/config/db.js` topology detection, `S/utils/transaction.js` (503), `npm run db:dev`, tests on a replica set | `T/00-smoke.test.js` health, `T/commit.test.js` | Done |
| 13 | Bounded CSV, no trust in extension (02 §7) | `S/middleware/upload.js`, `batchIngestionService.assertLooksLikeCsvText` | `T/upload.test.js` | Done |
| 14 | In-process worker documents restart behaviour (02 §7, 05 §6) | `startValidation`, `recoverInterruptedJobs` | `T/validation.test.js` async mode | Done (restart recovery covered by code review, not a crash test) |
| 15 | Lockfiles; audit output recorded (02 §7, 08 §2) | `package-lock.json` ×3; `npm audit` = 0 | `IMPLEMENTATION_STATUS.md` | Done |
| 16 | Git checkpoints (00 §5, 09 §13) | local commits per milestone (not pushed) | `git log` | Done |

## 03 - Authentication and authorisation

| # | Requirement | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 17 | Eight role enums and scopes (03 §3) | `S/config/constants.js`, `User` model, `userAdminService.SCOPE_RULES` | `T/authorization.test.js` | Done |
| 18 | Server-side sessions, regenerate on login, HttpOnly/SameSite/Secure, expiry, logout invalidation (03 §2, §7) | `S/app.js`, `S/controllers/authController.js` | `T/auth.test.js` | Done |
| 19 | bcrypt hashes, no plaintext (03 §7) | `authService.hashPassword` | `T/auth.test.js` | Done |
| 20 | CSRF for cookie requests, maintained library (03 §7, 08 §2) | `csrf-sync` in `S/middleware/csrf.js` | `T/auth.test.js` "CSRF" | Done |
| 21 | Strict CORS, no wildcard with credentials (03 §7) | `S/app.js` | - (configuration) | Done |
| 22 | Rate-limit login and public verify (03 §7, 08 §2) | `S/middleware/rateLimiters.js` | `T/auth.test.js` throttling, `T/credential.test.js` enumeration | Done |
| 23 | No self-service role selection / privileged registration (03 §7) | strict login schema; admin-only user creation | `T/auth.test.js`, `T/admin-policy.test.js` | Done |
| 24 | Disabled user rejected even with cookie (03 §7) | `loadCurrentUser` + `sessionVersion` | `T/auth.test.js` | Done |
| 25 | Permission matrix (03 §4) | `requireRole` per route + service scope checks | `T/authorization.test.js` (46 checks) | Done |
| 26 | Auth endpoints login/logout/me/change-password/admin users/password-reset (03 §5) | `S/routes/authRoutes.js`, `adminRoutes.js` | auth + admin tests | Done |
| 27 | Login UI: field validation, show password, single submit, generic error, no dead "forgot password" (03 §6) | `C/pages/public/LoginPage.jsx` | `C/src/test/auth-and-navigation.test.jsx`, browser run | Done |
| 28 | Mandatory auth tests list (03 §8) | - | `T/auth.test.js`, `T/authorization.test.js` | Done |

## 04 - Role features and buttons

| # | Requirement | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 29 | Shared: sign in/out (server-confirmed), refresh, search/filter/clear, export with masking (04 §2) | `AppShell.jsx`, `PageHeader` refresh, list pages, CSV endpoints | browser run, `T/dashboard.test.js` exports | Done |
| 30 | Public verify: scan (camera), upload QR image, verify, clear; minimal status (04 §2) | `C/pages/public/VerifyPage.jsx` (jsQR in browser; images never uploaded), `GET /verify/:ref` | `T/credential.test.js`, browser run | Done (camera path checked in code only; no camera in headless test) |
| 31 | Operator: upload wizard (template + note, choose/remove, pre-check, submit idempotent) (04 §3) | `C/pages/college/UploadWizard.jsx`, `POST /batches` + `Idempotency-Key` | `T/upload.test.js`, `C/.../components-and-logic.test.jsx` pre-check, browser run | Done |
| 32 | Operator: batch list/detail/refresh, issue filters, search, edit/save/cancel, revalidate, export issues, seat ledger, conflicts, mark ready; no certify (04 §3) | `C/pages/college/batch/*`, `BatchListPage.jsx`, `SeatLedgerPage.jsx`, `ConflictPages.jsx` | `T/correction.test.js`, `T/authorization.test.js`, `C/.../pages.test.jsx` | Done |
| 33 | Head: pending submissions, summary, issue details, return (reason), accept disposition, declaration, no fake OTP, certify, cancel, conflicts, export summary, audit (04 §4) | `BatchDetailPage.jsx`, `CertifyDialog.jsx`, `IssuesPanel.jsx`, `AuditExplorerPage.jsx` | `T/commit.test.js`, `T/correction.test.js`, `C/.../pages.test.jsx` | Done |
| 34 | National: refresh, filters, drill-down with breadcrumbs, risk queue (open/assign/note/reviewed/false positive/escalate), conflict monitor, export, verify chain, no policy powers (04 §5) | `AicteDashboard.jsx`, `RiskPages.jsx`, `ConflictPages.jsx`, `AuditExplorerPage.jsx`, read-only `PolicyPages` | `T/risk.test.js`, `T/dashboard.test.js`, `T/audit.test.js`, `T/authorization.test.js` | Done |
| 35 | Regional: same within assigned regions; other regions 403 (04 §6) | `dashboardService.aicteDashboard({ regional: true })`, scoped services | `T/authorization.test.js` regional scope | Done |
| 36 | Admin: create (pending activation), save changes (no self-escalation), disable/re-enable, controlled reset; policies draft/validate/compare/submit/approve-publish (different approver); verify chain; settings; no certification (04 §7) | `UsersPage.jsx`, `AdminMiscPages.jsx`, `PolicyPages.jsx`, `userAdminService`, `seatPolicyService`, `settingsService` | `T/admin-policy.test.js`, `T/auth.test.js` | Done |
| 37 | Issuer: scoped masked search, minimum details, generate, download QR/certificate, status, revoke (reason), export (04 §8) | `IssuerPages.jsx`, `CredentialPanel.jsx`, `credentialService` | `T/credential.test.js`, browser run | Done |
| 38 | Verifier: onboarding (no real KYC), request (reference, purpose, allowed fields, expiry), refresh, approved result only, cancel; no bulk verify (04 §9) | `VerifierPages.jsx`, `verificationService`, `userAdminService.submitVerifierOrganisation` | `T/consent.test.js`, `T/admin-policy.test.js`, browser run | Done |
| 39 | Student: view own record, request correction, consent open/approve/deny/revoke, access log, credential download/refresh, direct edit → 403 (04 §10) | `StudentPages.jsx`, `studentService`, `PATCH /students/me` → 403 | `T/consent.test.js`, `T/authorization.test.js`, `C/.../pages.test.jsx` | Done |
| 40 | Button rules: loading, success/failure feedback, disabled reason, confirmation for high-impact actions, refresh after mutation, no dead buttons (04 §11) | `Button` (`loading`, `disabledReason`), `ConfirmDialog`, `ReasonDialog`, `useAction` | `C/.../components-and-logic.test.jsx`, browser route sweep (60 routes) | Done |

## 05 - Architecture and workflows

| # | Requirement | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 41 | Modular Express app, thin routes, services own rules (05 §1-2) | `S/routes`, `S/controllers`, `S/services` | - | Done |
| 42 | Upload & commit sequence incl. scope from session, re-check at commit, rollback (05 §3) | `batchIngestionService`, `commitService` | `T/commit.test.js` | Done |
| 43 | Conflict sequence with minimum disclosure and preserved history (05 §4) | `conflictService` | `T/lifecycle-conflict.test.js` | Done |
| 44 | Consent & QR sequence; altered reference → generic invalid (05 §5) | `verificationService`, `credentialService` | `T/consent.test.js`, `T/credential.test.js` | Done |
| 45 | Observability: request id/route/status/duration/actor; never log secrets; health endpoint (05 §8) | `S/middleware/requestLogger.js`, `GET /health` | `T/00-smoke.test.js` | Done |

## 06 - Data and API contract

| # | Requirement | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 46 | Random `studentRef`; Student separate from Enrolment; staging separate (06 §2) | `Student`, `Enrolment`, `StagingRow` | commit tests | Done |
| 47 | Collections and constraints listed in 06 §3 | `S/models/*` (+ documented additions) | index behaviour in commit/conflict/credential tests | Done |
| 48 | Ledger invariant 0 ≤ filled ≤ capacity (06 §3-4) | conditional updates + collection validator | `T/commit.test.js` validator test | Done |
| 49 | One batch state enum + transition table (06 §4) | `BATCH_TRANSITIONS`, `transition()` | correction/commit tests | Done |
| 50 | Reconciliation of counters (06 §4, 07 §6) | `reconcileLedgers`, `npm run check:ledger`, admin page | commit/lifecycle tests | Done |
| 51 | REST contract endpoints (06 §5) | `S/routes/*` - all listed paths implemented | see `docs/API_REFERENCE.md` | Done |
| 52 | Status codes 400/401/403/404/409/413/422/429/500 and safe JSON errors (06 §6) | `S/middleware/errorHandler.js`, `AppError` | many tests | Done |
| 53 | Bounded pagination; scope never from browser; idempotent mutations documented (06 §6) | `S/utils/pagination.js`, strict schemas, idempotent certify/issue/upload | commit/credential/upload tests | Done |

## 07 - Validation, seat ledger, lifecycle, conflicts

| # | Requirement | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 54 | Golden rule: staging until validation, review, certification, safe commit (07 §1) | whole pipeline | e2e | Done |
| 55 | L1..L7 with specified severities (07 §2) | `S/services/validation/l1..l7` | `T/validation.test.js` (pass + fail per layer) | Done |
| 56 | Severity semantics ERROR/WARNING/PENDING/INFO/RISK_FLAG (07 §3) | `ruleCatalog.js`, `issueFactory.handlingFor` | `T/validation.test.js` "severity handling", `T/pending-policy.test.js` | Done (no rule currently emits INFO; the severity is supported) |
| 57 | Illustrative cases: missing field, 11-digit ID, duplicate, NRI 4 > 3, additional buckets, transfer, registry unavailable, repeated phone, correction, rule change (07 §4) | fixtures + layers | validation, correction, commit, lifecycle tests | Done |
| 58 | Seat ledger identity course/year/bucket with provenance (07 §5) | `SeatLedger` unique index, `policyVersion`, `sourceType` | admin-policy tests | Done |
| 59 | Commit invariants: recheck, atomic, rollback, no duplicate certification (07 §6) | `commitService` | `T/commit.test.js` (concurrency, forced failure, idempotency) | Done |
| 60 | Enrolment lifecycle table with explicit seat effects (07 §7) | `ENROLMENT_TRANSITIONS`, `enrolmentService.applyTransition` | `T/lifecycle-conflict.test.js`, `T/pending-policy.test.js` | Done |
| 61 | Conflict workflow detect → notify → resolve (withdrawn/transferred/justified) → close only when satisfied (07 §8) | `conflictService` | `T/lifecycle-conflict.test.js` | Done |
| 62 | Required tests list (07 §9) | - | validation/commit/lifecycle/risk tests | Done |

## 08 - Security, privacy, testing, acceptance

| # | Requirement | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 63 | Control table: passwords, sessions, CSRF, authorisation, public endpoints, uploads, secrets, sensitive data, database, audit, errors, dependencies (08 §2) | see `SECURITY_AND_LIMITATIONS.md` | auth/authorization/upload/audit tests, npm audit | Done |
| 64 | Data minimisation: masking, opaque references, consent per read (08 §3) | masking utils, credential refs, `getResult` | consent/credential/dashboard tests | Done |
| 65 | Honest audit-chain boundaries (08 §4) | `auditService.verifyChain().guarantee`, docs | `T/audit.test.js` | Done |
| 66 | QR boundaries (08 §5) | disclaimers in API and UI | `T/credential.test.js` | Done |
| 67 | Required automated test groups incl. UI (08 §6) | backend 182 tests, frontend 25 tests, optional browser journey + 60-route sweep (`e2e/`) | see `IMPLEMENTATION_STATUS.md` | Done (UI accessibility audit not done) |
| 68 | Acceptance gate (08 §7) | README, demo guide, mock labels, targets not claimed | - | Done |
| 69 | Never-make-these-claims list (08 §8) | wording throughout UI/docs | review | Done |

## 09 - Build order and 10 - Demo data

| # | Requirement | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 70 | Milestone report items (09 §12) | `IMPLEMENTATION_STATUS.md` | - | Done |
| 71 | CSV contract: 9 columns, institution from session, row-level checks (10 §2) | `batchIngestionService`, L1 | upload/validation tests | Done |
| 72 | Clean sample CSV and negative fixtures (10 §3-4) | `fixtures/*.csv`, `*.json` (exact clean CSV from 10 §3) | validation tests | Done |
| 73 | Seat-ledger demo config DEMO-v1 (10 §5) | `fixtures/seat_policy_demo_v1.json` | validation L4 test | Done |
| 74 | Seeded accounts per role; no fixed passwords in code; refuses production; hashes; idempotent; demo warning (10 §6) | `S/seed/demoSeed.js`, `server/scripts/seed.js` | used by every test; re-run checked manually | Done |
| 75 | Seven-minute demo flow (10 §7) | `docs/DEMO_GUIDE.md` | `T/zz-e2e.test.js`, browser run | Done |
| 76 | Fixture hygiene: deterministic, separate failure modes, dev-only reset, DEMO labels (10 §8) | fixtures, `demo:reset` (no HTTP reset), `-DEMO` export names | - | Done |

## Colour theme / UI design (`Instruction/color_theme.md`)

| # | Requirement | Implementation | Status |
| --- | --- | --- | --- |
| 77 | GST-portal layout: utility strip, header with logo, navy nav with orange active underline, home blocks, navy footer with prototype line, last-updated date, back to top | `C/app/AppShell.jsx`, `C/pages/public/HomePage.jsx` | Done, with one deliberate change: at the user's request (2026-10-25) the home page shows only a welcome message with Login and Verify credential; the news, due-dates, help-topics, help-desk and resources blocks were removed |
| 78 | Palette tokens, button variants, cards, KPI tiles, tables, badges (icon + text), alerts, forms, stepper, modal overlay | `C/styles/theme.css`, `C/components/*` | Done |
| 79 | Accessibility checklist: skip link, A-/A/A+ up to 150%, high contrast, visible focus, no colour-only information | `PreferencesContext.jsx`, theme | Done; Lighthouse/axe audit **not** run |
| 80 | Language selector | English + Hindi for site chrome, home and sign-in (labelled "आंशिक"/partial) | Partial |
| 81 | Own logo, no GST branding, not presented as official | `Instruction/apaar_setu_variant2.png` used; disclaimers | Done |

## Documented additions beyond spec 06 (each required by a spec 04 button)

`regions`, `organisations`, `riskcases`, `accesslogs`, `correctionrequests`, `systemsettings`, `auditchainheads` collections; endpoints marked *added* in `API_REFERENCE.md` (row exclusion, operator justification, mark-ready, dispositions, discard, template info, review summary, risk queue, reports, notifications, verifier onboarding, student self-service, issuer search). Two extra demo accounts per role pair (`approver.demo`, XYZ operator/head) are required to demonstrate policy maker-checker and both sides of a conflict.

## Interpretations of ambiguous points (no contradictions found between documents)

| Topic | Source | Decision (safest reversible interpretation) |
| --- | --- | --- |
| "Mark ready" needs "warning dispositions recorded" while "Accept warning disposition" is a head action | 04 §3 vs §4 | Two steps: operator **justifies** (needed for mark-ready), head **accepts** (needed for certify) |
| PENDING identity checks | 07 §3, 10 §4 | Admin setting, default `BLOCK_UNTIL_RESOLVED`; alternative commits as PROVISIONAL with `externalLinkStatus = PENDING`, never "verified" |
| Duplicate key | 07 §2 (L3), 10 §4 | Same student code **or** demo ID + course + academic year within a batch; plus "already active at this institution" |
| Which states occupy a seat | 07 §7 | PROVISIONAL and CONFIRMED occupy; all other states release once |
| Stale policy | 07 §4 | Certification refused; batch sent back for revalidation (no mixed capacities) |
| Student identity key in the demo | 10 §2-4 | `studentCode` matches rows to register students; `studentRef` stays the random primary reference |
| Row numbering | 07 / 10 | Spreadsheet convention: header = row 1, first student = row 2 |
| Spec folder | master prompt | Specs live in `Instruction/` (not `docs/specs/...`); left in place |
