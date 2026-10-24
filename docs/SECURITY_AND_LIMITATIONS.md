# APAAR Setu - Security, privacy and limitations

This is a **learning/demo prototype with synthetic data** (spec `08_Security_Privacy_Testing_and_Acceptance.pdf`). It must not store real government or student records, and it is not production-ready until a separate security, legal, operations and integration review is done.

## 1. Authentication

| Control | Implementation | Evidence |
| --- | --- | --- |
| Password storage | bcrypt (cost 12; 4 in tests), never plaintext or reversible; hashes excluded from every query and response (`select: false` + `toJSON` transform) | `models/User.js`, `services/authService.js`, `tests/auth.test.js` |
| Password policy | 12-128 characters, at least one letter and one digit, not containing the email name | `authService.checkPasswordPolicy` |
| Login errors | Same 401 code and message for unknown email, wrong password, disabled or not-yet-activated accounts; a dummy bcrypt comparison keeps timing similar | `verifyCredentials`, auth tests |
| Sessions | `express-session` with the MongoDB store `connect-mongo`; cookie `apaar.sid` is HttpOnly, SameSite=Lax, Secure in production (`COOKIE_SECURE`), 1-hour idle expiry (`SESSION_MAX_AGE_MS`, rolling) | `app.js` |
| Session fixation | Session id regenerated on login and on password change | `authController.js`, test "session id is rotated" |
| Revocation | Every request reloads the user: disabled accounts, password changes/resets (via `sessionVersion`) end existing sessions immediately | `middleware/auth.js`, test "disabled user is rejected even with an existing session cookie" |
| Logout | Destroys the server-side session and clears the cookie; idempotent; the UI only shows "signed out" after the server confirms | auth tests, `AppShell.jsx` |
| Account provisioning | No public registration or role selection. Administrators create accounts as *pending activation* and receive a one-time link (only its SHA-256 hash is stored, 72 h expiry); resets use a 24 h one-time link and invalidate the old password. No email is sent in the prototype | `userAdminService.js`, admin tests |
| Throttling | Failed logins (20 / 15 min per IP, configurable), set-password (10 / 15 min), public QR status (60 / min), verification requests (30 / h per verifier) | `middleware/rateLimiters.js`, tests for login and QR throttling |

## 2. CSRF and CORS

- **CSRF:** `csrf-sync` (maintained, Synchroniser Token Pattern). A random token is stored in the server-side session and must be sent as `X-CSRF-Token` on every POST/PUT/PATCH/DELETE; GET requests never change state. The client fetches the token at start-up and refreshes it once automatically if it expired. Tested: missing and wrong tokens are rejected with 403.
- **CORS:** only the configured `CLIENT_ORIGIN` with credentials, never a wildcard. In development the Vite proxy makes the app same-origin; in production Express serves the built client from the same origin.

## 3. Authorisation

- Every protected route declares its roles (`requireRole`), and every service re-checks **scope and state**:
  - college users: own institution only (batches, rows, issues, ledger, enrolments, conflicts, corrections, audit for the head);
  - regional officers: assigned regions only (dashboards return 403 for other regions/institutions; cases outside the region return 404);
  - students: own `studentRef` only (consents of other students are 404; direct edits of the record are 403);
  - verifiers: own requests only, approved organisation required; issuers: affiliated institutions only.
- Scope is never read from the request body or query; schemas are **strict**, so smuggled fields such as `institutionId` or `role` are rejected (422).
- **Maker-checker:** only the college head can certify (an operator calling the API gets 403; the uploader can never certify); a seat policy must be published by a different administrator than its author; system administrators cannot certify batches.
- Administrators cannot change roles (create a new account instead), cannot change their own scope and cannot disable themselves.
- 46 automated authorisation checks cover positive and negative cases for all eight roles (`tests/authorization.test.js`), plus scope checks in most other test files.

## 4. Upload safety

- Only `.csv` with an allow-listed MIME type, one file, bounded by `MAX_UPLOAD_MB` (413) and `MAX_ROWS_PER_BATCH` (413).
- Content is sniffed: ZIP/XLSX, PDF, images, executables and NUL bytes are rejected (415); the text must be valid UTF-8.
- Strict parser (`csv-parse`): inconsistent column counts or broken quotes → 422 with a line number; unknown or missing header columns → 422.
- Files are held in memory for the request only (no temporary files to clean up); only the sanitised base file name is stored (path tricks such as `../../etc/passwd.csv` are neutralised).
- Uploads create **staging rows only**; nothing reaches the official register before certification (tested).
- Exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@` prefixed with `'`).

## 5. Privacy and data minimisation

- All data is synthetic; the 12-digit "demo identifier" is fake and only checked against a **mock** registry fixture. Phone-number-like contact tokens are rejected.
- Officers see masked student references and initials; officer exports contain counts only; the issuer list shows initials; the head's review masks the demo identifier.
- The public QR endpoint returns status, credential type, issuer, issue date and a reference fingerprint - never names, codes or identifiers - and credential references are random (not enumerable). An altered reference is rejected by a keyed checksum before any lookup.
- Consent is bound to purpose, fields and expiry and is re-checked on **every** read; revocation and expiry block later access; every disclosure is logged for the student.
- Logs contain request id, path (no query string), status, duration and actor reference only - never bodies, passwords, tokens or session ids.
- A consent screen is **not** a legal compliance certification. Confirm applicable privacy law with a qualified owner before any real use.

## 6. Data integrity and transactions

- MongoDB **must be a replica set** for certification, enrolment changes, conflict resolution and policy publication. On a standalone server those actions return `503 TRANSACTIONS_UNAVAILABLE` rather than running as separate writes.
- Seat counters change only through conditional atomic updates; the `seatledgers` collection validator enforces `0 <= filled <= capacity` at database level; a reconciliation check compares counters with enrolments (`npm run check:ledger`, admin "Ledger check").
- Tested: concurrent last-seat certification (exactly one wins), concurrent double certification (one commit), forced failure inside the transaction (nothing written), stale policy (no mixed capacities), exactly-once seat release.

## 7. Audit chain - honest guarantees

- Each event stores `previousHash` and `hash` over a canonical JSON form; the Mongoose model refuses updates and deletes; "Verify chain" recomputes everything and reports the failing sequence.
- **What it proves:** a stored event that was changed, removed or reordered *without* recomputing the chain is detected (tested, and demonstrable with `npm run demo:tamper-audit`).
- **What it does not prove:** MongoDB is not immutable. Someone with full database access could rewrite every later hash consistently. Production would need separately protected signing keys or external checkpoints. Do not call it "tamper-proof", "immutable" or "blockchain".

## 8. QR credentials - honest guarantees

- The QR contains `PUBLIC_VERIFY_BASE_URL/verify/CRD-<random>-<checksum>`. The page shows the **current** stored status (VALID / REVOKED / INVALID_OR_TAMPERED).
- It is **not** a cryptographically signed verifiable credential: it cannot be verified offline, does not prove the holder's identity and depends on this server being available. A printed copy does not prove current validity.
- The checksum uses `CREDENTIAL_REF_SECRET` (or a value derived from `SESSION_SECRET`); changing it invalidates existing QR references.

## 9. Mock integrations (nothing real is contacted)

| Adapter | Stands in for | Behaviour |
| --- | --- | --- |
| `mockIdentityAdapter` | APAAR-like identity registry | Deterministic: IDs in `adapters/fixtures/mockIdentityRegistry.json` → MATCHED / NAME_MISMATCH; IDs starting `999` → PENDING; others → NOT_FOUND; admin setting can make the whole service UNAVAILABLE |
| `mockApprovalAdapter` | AICTE approval (intake) data | Reads the synthetic course fixture |
| `mockDigiLockerAdapter` | DigiLocker issuance | Records `SIMULATED_NOT_SENT`; sends nothing |

Every UI place that shows these results says "mock" or "simulated". No real API credentials exist in this project and no real-service integration has been tested.

## 10. Dependencies

Versions are locked in `package-lock.json` files. `npm audit` reported **0 vulnerabilities** for the root, `server/` (including `--omit=dev`) and `client/` packages on 2026-10-25. Re-run before any demo.

## 11. Known limitations

- **No real integrations** (APAAR, ABC, DigiLocker, AICTE EoA), no real KYC for verifier organisations.
- **No OTP / e-sign / MFA / SSO**; certification uses a declaration plus typed batch ID (clearly labelled).
- **No email/SMS**: notifications are in-app; activation and reset links are shown once to the administrator.
- **Rate limits are in memory** (one server process); a multi-instance deployment would need a shared store.
- **Validation runs as an in-process job**, not a durable queue; interrupted jobs are marked retry-required on restart. No load testing was done, so no throughput claim is made (the 5 MB / 10,000-row limits are proposed demo defaults).
- **Synthetic policy values:** seat capacities, admission windows, risk thresholds, the conflict review target (14 days) and the disposition rules are documented demo configuration, not official policy.
- **Risk scores** are a transparent rule-based priority, not machine learning and not a probability of fraud; there is no accuracy figure.
- **Hindi** covers the site chrome, home and sign-in pages only; workflow pages are English.
- **Accessibility:** built with UX4G-style patterns (skip link, focus rings, text resize to 150%, high contrast, text + icon status badges), but no Lighthouse/axe/WCAG audit was run - do not claim WCAG 2.1 AA or GIGW compliance.
- **Docker Compose** file is provided but was not tested in the build environment (Docker was unavailable there).
- Session cookies use SameSite=Lax; deploying the client and API on different sites would need a reviewed cookie/CORS setup.
