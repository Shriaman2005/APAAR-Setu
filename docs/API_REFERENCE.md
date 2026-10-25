# APAAR Setu - API reference

Base path: `/api`. JSON in and out (CSV/PNG downloads where noted). This is the implemented contract; it follows spec `06_Database_and_API_Contract.pdf` and adds the endpoints the spec 04 buttons need (marked *added*).

## Conventions

- **Authentication:** server-side session in an HttpOnly cookie `apaar.sid` (SameSite=Lax, Secure in production). Obtain it with `POST /auth/login`.
- **CSRF:** every non-GET request must send `X-CSRF-Token`. Get a token from `GET /auth/csrf-token` (and use the new one returned by login / change-password).
- **Scope** (institution, region, own student, own organisation) is always taken from the signed-in user, never from the request. Records outside your scope return **404**.
- **Pagination:** list endpoints accept `page` (default 1) and `pageSize` (default 20, max 100) and return `{ items, total, page, pageSize, totalPages }`.
- **Errors:** `{ "error": { "code", "message", "details"?, "requestId" } }`. Never a stack trace.

| Status | Meaning |
| --- | --- |
| 400 | malformed request (bad JSON, bad upload form) |
| 401 | not signed in / session expired or revoked (`AUTH_REQUIRED`, `SESSION_REVOKED`, `INVALID_CREDENTIALS`) |
| 403 | role not permitted (`FORBIDDEN`), `CSRF_TOKEN_INVALID`, `MAKER_CHECKER_VIOLATION`, `CONSENT_NOT_ACTIVE`, `ORG_NOT_APPROVED`, `OUT_OF_SCOPE` |
| 404 | unknown, or concealed because it is outside your scope |
| 409 | state or capacity conflict (`BATCH_STATE_CONFLICT`, `CAPACITY_EXCEEDED`, `STALE_POLICY_VERSION`, `DUPLICATE_FILE`, `CONFLICT_ALREADY_RESOLVED`, ...) |
| 413 | `FILE_TOO_LARGE`, `TOO_MANY_ROWS`, `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_FILE_TYPE`, `FILE_CONTENT_NOT_CSV` |
| 422 | valid syntax but invalid fields (`VALIDATION_FAILED` with `details.fieldErrors`, `FIELD_NOT_EDITABLE`, `FIELD_NOT_ALLOWED`, ...) |
| 429 | `RATE_LIMITED` |
| 500 / 503 | unexpected error / `TRANSACTIONS_UNAVAILABLE` (MongoDB is not a replica set) |

Role abbreviations: **OP** college operator, **HEAD** college head, **NAT** national officer, **REG** regional officer, **ADM** system administrator, **DAB** degree-awarding body, **VER** verifier, **STU** student.

---

## Health and public

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/health` | public | `{ status, database, topology, transactionsSupported }` |
| GET | `/verify/:credentialRef` | public, rate-limited | Minimal QR status: `VALID` / `REVOKED` / `INVALID_OR_TAMPERED`, credential type, issuer, issue date, reference fingerprint, disclaimer. No personal data |

## Authentication

| Method | Path | Access | Body / notes |
| --- | --- | --- | --- |
| GET | `/auth/csrf-token` | public | `{ csrfToken }` |
| POST | `/auth/login` | public, throttled (failed attempts) | `{ email, password }` → `{ user, csrfToken }`. Session id regenerated. Generic 401 for every failure |
| GET | `/auth/demo-accounts` | public | *added, prototype demos only*. `{ enabled, accounts: [{ email, role, scope }] }`: the seeded demo accounts offered for one-click sign-in; empty when `DEMO_LOGIN` is off |
| POST | `/auth/demo-login` | public, throttled; exists only when `DEMO_LOGIN` is on | *added, prototype demos only*. `{ email }` of a seeded, active demo account → `{ user, csrfToken }`, exactly like `/auth/login` (session regenerated; audit `AUTH_LOGIN_SUCCEEDED` with `method: DEMO_ACCESS`). Any other account → 404 |
| POST | `/auth/logout` | any | Destroys the session; idempotent |
| GET | `/auth/me` | signed in | `{ user: { id, email, displayName, role, status, institution, regionIds, studentRef, organisation } }` |
| POST | `/auth/change-password` | signed in | `{ currentPassword, newPassword }` → `{ changed, csrfToken }`; other sessions end |
| POST | `/auth/set-password` | public, throttled | *added*. `{ token, newPassword }` completes activation or an admin-initiated reset (one-time token) |

Password policy: 12-128 characters, at least one letter and one digit, must not contain the email name.

## Admission batches (`/batches`)

| Method | Path | Access | Body / notes |
| --- | --- | --- | --- |
| GET | `/batches/template-info` | OP | *added*. Columns, permitted course/bucket values per academic year, limits, row-number convention |
| GET | `/batches/template.csv` | OP | *added*. Header-only template (TEMPLATE-DEMO-v1) |
| POST | `/batches` | OP | multipart: `file` (.csv), `academicYear`; optional header `Idempotency-Key`. → `202 { batchId, status: "VALIDATING", receivedRows }` (or `200 … idempotentReplay: true`). Errors: 409 `DUPLICATE_FILE`, 413, 415, 422 `CSV_*` |
| GET | `/batches` | OP, HEAD | Own institution; filters `status`, `search` |
| GET | `/batches/:batchId` | OP, HEAD | `{ batch, readiness: { canMarkReady, markReadyBlockers, canCertify, certifyBlockers, counts, activePolicyVersion }, permissions }` |
| GET | `/batches/:batchId/review` | OP, HEAD | *added*. Head review: ledger impact, issue summary by rule, declaration text, confirmation note |
| GET | `/batches/:batchId/rows` | OP, HEAD | Staged rows; filters `status` (VALID, HAS_ERRORS, HAS_WARNINGS, PENDING, STALE, EXCLUDED), `search`. Demo ID masked for the head |
| GET | `/batches/:batchId/rows/:rowNumber` | OP, HEAD | *added*. Row with original upload snapshot, corrections, current issues and issue history |
| GET | `/batches/:batchId/issues` | OP, HEAD | Filters `severity`, `status`, `layer`, `rowNumber`, `needsAction=true`, `view=current|history` |
| GET | `/batches/:batchId/issues.csv` | OP, HEAD | Issues export (masked, formula-safe) |
| GET | `/batches/:batchId/summary.csv` | HEAD | Submission summary export (masked) |
| GET | `/batches/:batchId/history` | OP, HEAD | *added*. Audit timeline of the batch |
| PATCH | `/batches/:batchId/rows/:rowNumber` | OP | `{ changes: { field: value } }` - only the 9 CSV fields; 422 `FIELD_NOT_EDITABLE`; staging only |
| POST | `/batches/:batchId/rows/:rowNumber/exclude` | OP | *added*. `{ reason }` (10+ chars) |
| POST | `/batches/:batchId/rows/:rowNumber/include` | OP | *added* |
| POST | `/batches/:batchId/revalidate` | OP | → `202`; reruns all layers |
| POST | `/batches/:batchId/issues/:issueId/justify` | OP | *added*. `{ justification }` - warnings (and pending, if the setting allows) only |
| POST | `/batches/:batchId/mark-ready` | OP | *added* (spec 04 "Mark ready for review"). `{ note? }`; 409 `MARK_READY_BLOCKED` with `details.blockers` |
| POST | `/batches/:batchId/discard` | OP | *added*. `{ reason }` |
| POST | `/batches/:batchId/return` | HEAD | `{ reason }` |
| POST | `/batches/:batchId/dispositions` | HEAD | *added*. `{ issueIds: [...], reason }` - accepts JUSTIFIED dispositions |
| POST | `/batches/:batchId/certify` | HEAD | `{ declarationAccepted: true, confirmBatchId }` → `{ status: "COMMITTED", commitSummary, idempotentReplay }`. 409 `CERTIFICATION_BLOCKED` / `STALE_POLICY_VERSION` / `CAPACITY_EXCEEDED`; 500 `COMMIT_TRANSACTION_FAILED` (rolled back, retryable); 503 without a replica set. **Retry semantics:** repeating after success returns the stored result and writes nothing |

## Institutions, register, conflicts

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/institutions` | OP, HEAD (own), REG (region), NAT, ADM | *added* |
| GET | `/institutions/:id/seat-ledger?academicYear=YYYY-YY` | OP/HEAD own, REG in region, NAT, ADM | `:id` = id or institution code. Buckets with capacity, filled, remaining, policy version, source type |
| GET | `/enrolments` | OP, HEAD (own, unmasked), REG/NAT (scoped, masked) | Filters `state`, `academicYear`, `courseCode`, `institutionId` (officers), `search` (college) |
| GET | `/enrolments/:enrolmentRef` | OP, HEAD (own) | *added*. Details, history, allowed transitions (head) |
| PATCH | `/enrolments/:enrolmentRef/state` | HEAD (own) | `{ toState, reason }`; transition table enforced; seat released once; may resolve a conflict |
| GET | `/conflicts` | OP/HEAD (involved), REG (region), NAT | Filters `status` (`OPEN_ALL`, OPEN, AWAITING_REVIEW, RESOLVED), `escalationLevel`. Student refs masked |
| GET | `/conflicts/:id` | same | Case, sides (other institution minimal), events, `availableActions` |
| POST | `/conflicts/:id/resolve` | OP, HEAD, REG, NAT | `{ action, reason }`. OP: `SUBMIT_FACTS`; HEAD: `WITHDRAW_OWN_ENROLMENT`, `TRANSFER_OWN_ENROLMENT`, `SUBMIT_JUSTIFICATION`; officers: `ACCEPT_JUSTIFICATION`, `REJECT_JUSTIFICATION`, `ADD_NOTE`. 409 `CONFLICT_ALREADY_RESOLVED` |
| POST | `/conflicts/:id/escalate` | REG, NAT | `{ reason }`; regional → national once |

## Risk queue (*added*, spec 04 sections 5-6)

| Method | Path | Access | Body |
| --- | --- | --- | --- |
| GET | `/risk-cases` | REG (region), NAT | Filters `status` (`OPEN_ALL`, ...), `priority`, `assignedToMe` |
| GET | `/risk-cases/:id` | same | Score, formula, reasons, evidence + history, ruleset version, notes, events, `availableActions` |
| GET | `/risk-cases/:id/assignees` | same | Officers inside the case scope |
| POST | `/risk-cases/:id/assign` | same | `{ assigneeId }` (422 `ASSIGNEE_OUT_OF_SCOPE`) |
| POST | `/risk-cases/:id/notes` | same | `{ text }` |
| POST | `/risk-cases/:id/review` | same | `{ summary }` (10+ chars) |
| POST | `/risk-cases/:id/false-positive` | same | `{ reason }` - original signal and evidence kept |
| POST | `/risk-cases/:id/escalate` | same | `{ reason }` |

## Dashboards and reports

| Method | Path | Access |
| --- | --- | --- |
| GET | `/dashboard/college` | OP, HEAD |
| GET | `/dashboard/aicte/national?academicYear=&regionId=&stateCode=&institutionId=` | NAT (breakdown REGION → INSTITUTION → COURSE) |
| GET | `/dashboard/aicte/region?...` | REG (403 `OUT_OF_SCOPE` for other regions/institutions) |
| GET | `/dashboard/admin` | ADM (*added*) |
| GET | `/dashboard/issuer` · `/dashboard/verifier` · `/dashboard/student` | DAB · VER · STU (*added*) |
| GET | `/reports/national.csv?academicYear=` | NAT (*added*; aggregated, no names) |
| GET | `/reports/region.csv?academicYear=` | REG (*added*; assigned regions only) |

## Administration (`/admin`)

| Method | Path | Access | Body / notes |
| --- | --- | --- | --- |
| GET | `/admin/users` | ADM | Filters `role`, `status`, `search`. Never returns hashes |
| POST | `/admin/users` | ADM | `{ email, displayName, role, institutionId? , regionIds?, organisationId?, studentCode? }` - scope fields validated per role → `{ user (PENDING_ACTIVATION), activationLink (shown once), deliveryNote }` |
| GET | `/admin/users/:id` | ADM | |
| PATCH | `/admin/users/:id` | ADM | `{ displayName?, institutionId?, regionIds?, organisationId? }`; `role` → 422 `ROLE_CHANGE_NOT_ALLOWED`; own scope cannot change |
| POST | `/admin/users/:id/disable` · `/enable` | ADM | `{ reason }`; cannot target yourself; disabling ends sessions |
| POST | `/admin/users/:id/password-reset` | ADM | → `{ resetLink (shown once), expiresAt }`; old password stops working |
| GET | `/admin/reference-data` | ADM | *added*. Roles + scope rules, regions, institutions, organisations |
| GET | `/admin/students-without-accounts` | ADM | *added* |
| GET | `/admin/organisations` | ADM | *added* |
| POST | `/admin/organisations/:id/approve` · `/reject` | ADM | *added*. `{ reason }` (prototype, no real KYC) |
| GET | `/admin/seat-policies` · `/admin/seat-policies/:id` | ADM, NAT (read-only) | |
| GET | `/admin/seat-policies/compare?from=&to=` | ADM, NAT | *added*. Metadata and capacity differences |
| POST | `/admin/seat-policies` | ADM | Create draft `{ academicYear, version, sourceReference, notes?, admissionWindow, scopes[] }` |
| PATCH | `/admin/seat-policies/:id` | ADM (author, draft only) | *added* |
| POST | `/admin/seat-policies/:id/validate` | ADM | Errors/warnings stored with a content hash |
| POST | `/admin/seat-policies/:id/submit` | ADM (author) | *added*. Requires a passing validation of the current content |
| POST | `/admin/seat-policies/:id/publish` | ADM (**different** administrator) | One transaction; previous version kept as SUPERSEDED; returns `batchesNeedingRevalidation` |
| POST | `/admin/seat-policies/:id/reject` | ADM (different administrator) | *added*. `{ reason }` → back to DRAFT |
| GET | `/admin/settings` · PUT `/admin/settings` | ADM | *added*. `{ changes: { key: value }, reason }` - only `mockIdentityServiceMode`, `pendingIdentityPolicy`, `conflictReviewSlaDays` |
| GET | `/admin/ledger-reconciliation` | ADM, NAT | *added*. Seat counters vs enrolments holding seats |

## Audit and notifications

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/audit` | ADM, NAT (all), REG (region), HEAD (own institution) | Filters `action`, `entityType`, `entityRef` |
| POST | `/audit/verify-chain` | ADM, NAT | `{ status: PASS|FAIL, checkedEvents, headSequence, firstFailureSequence, failures[], verifiedAt, durationMs, guarantee }`; the run itself is then audited |
| GET | `/notifications` | signed in | *added*. Own notifications, `unread=true` filter, `unreadCount` |
| POST | `/notifications/:id/read` · `/notifications/read-all` | signed in | *added* |

## Verification and consent

| Method | Path | Access | Body / notes |
| --- | --- | --- | --- |
| GET | `/verification-requests/options` | VER | *added*. Documented purposes, allowed fields per purpose, expiry options (1/7/30 days) |
| GET | `/verification-requests` | VER (own) | *added* |
| POST | `/verification-requests` | VER (approved organisation), rate-limited | `{ studentRef, purpose, requestedFields[], expiryDays }`; 422 `FIELD_NOT_ALLOWED` on tampering; 409 duplicate pending |
| GET | `/verification-requests/:id` | VER owner / STU owner | Each side sees only its own view |
| GET | `/verification-requests/:id/result` | VER owner | *added*. Only approved fields from the current register; consent re-checked on every read (403 `CONSENT_NOT_ACTIVE`); writes an access-log entry |
| POST | `/verification-requests/:id/cancel` | VER owner | *added*. Pending only |
| GET / POST | `/verifier/organisation` | VER | *added*. Own organisation / submit onboarding `{ name, verifierCategory, description? }` |
| GET | `/consents` | STU | *added*. Own consents, filter `status` |
| POST | `/consents/:id/approve` | STU owner | `{ approvedFields[] (subset of requested), note? }` |
| POST | `/consents/:id/deny` · `/consents/:id/revoke` | STU owner | `{ note? }` |

## Students

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/students/me` | STU | *added*. Profile (masked demo ID, verification reference), enrolments + history |
| PATCH | `/students/me` | any signed-in user | Always **403 `DIRECT_EDIT_FORBIDDEN`** (spec 04: use a correction request) |
| GET | `/students/me/access-log` | STU | *added* |
| GET | `/students/me/credentials` | STU | *added* |
| POST | `/students/me/credential-requests` | STU | *added*. `{ enrolmentRef }` - notifies the affiliated issuer (once per 24 h) |
| GET / POST | `/students/me/correction-requests` | STU | *added*. `{ enrolmentRef, correctionType: NAME_CORRECTION|ENROLMENT_DETAIL, explanation (20+), evidenceNote?, proposedValue? }` |
| GET | `/correction-requests` | OP, HEAD (own institution) | *added* |
| POST | `/correction-requests/:id/decision` | HEAD | *added*. `{ decision: ACCEPT|REJECT, response }`; accepted name corrections update the register name (history kept) |

## Issuer and credentials

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/issuer/eligible-students` | DAB | *added*. Affiliated institutions only, masked, `search` = exact code or name part |
| GET | `/issuer/enrolments/:enrolmentRef` | DAB (in scope) | *added*. Minimum fields to issue + existing credentials |
| POST | `/credentials` | DAB | `{ enrolmentRef, credentialType: ENROLMENT_CERTIFICATE_DEMO|COMPLETION_CERTIFICATE_DEMO }`; idempotent (existing ACTIVE credential returned with `idempotentReplay`); mock DigiLocker step records `SIMULATED_NOT_SENT` |
| GET | `/credentials` | DAB | *added*. Issued by your organisation (holder initials) |
| GET | `/credentials/export.csv` | DAB | *added*. Masked export |
| GET | `/credentials/:ref` | DAB (issuer) / STU (holder) | *added* |
| GET | `/credentials/:ref/qr.png` | DAB / STU | *added*. QR encoding `PUBLIC_VERIFY_BASE_URL/verify/<ref>` |
| POST | `/credentials/:ref/revoke` | DAB (issuer) | `{ reason }` |

Credential reference format: `CRD-<32 random hex>-<12 hex HMAC checksum>`. The checksum lets the server reject altered references before any lookup; it is not a signature over the credential content.
