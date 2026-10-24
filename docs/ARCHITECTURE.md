# APAAR Setu - Architecture

This describes what is actually implemented. It follows spec `05_System_Architecture_and_Workflows.pdf`: one modular Express application (not microservices), a React client, MongoDB, and named mock adapters for external systems.

## 1. Components

```
 Browser (React + Bootstrap)                       Public QR status page (no login)
        │  HttpOnly session cookie + X-CSRF-Token          │
        ▼                                                  ▼
 ┌─────────────────────────── Express API (/api) ───────────────────────────┐
 │ helmet → request log → CORS → JSON parser → express-session (MongoDB)     │
 │ → loadCurrentUser → csrf-sync → routes → controllers → SERVICES           │
 │                                                                           │
 │  Services (business rules)                     Mock adapters (labelled)    │
 │  • batchIngestion  (CSV → staging, jobs)       • mockIdentityAdapter       │
 │  • validation/pipeline + L1..L7 layers           (APAAR-like, deterministic)│
 │  • batchWorkflow / batchQuery                  • mockApprovalAdapter       │
 │  • commitService  (certify, 1 transaction)       (AICTE approval fixture)  │
 │  • seatLedger / seatPolicy                     • mockDigiLockerAdapter     │
 │  • enrolment / conflict / risk                   (records "not sent")      │
 │  • verification (consent) / credential                                     │
 │  • audit (hash chain) / notification / settings / dashboards / reports     │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
                 MongoDB replica set (transactions) + sessions collection
```

- **Routes and controllers are thin**: they validate the request shape (zod, strict) and call one service function.
- **Authorisation is layered**: `requireRole(...)` on every protected route, then each service re-checks *scope* (institution, region, own student, own organisation) and *state* (e.g. only a `READY_FOR_REVIEW` batch can be certified). Out-of-scope records return **404** so their existence is not revealed.
- **The browser is never trusted for scope**: institution, region, student reference and organisation always come from the stored user record loaded on every request.

## 2. Request flow (example: certify a batch)

1. `POST /api/batches/:batchId/certify` with `X-CSRF-Token` and body `{ declarationAccepted, confirmBatchId }`.
2. `express-session` loads the session from MongoDB; `loadCurrentUser` reloads the user (must be `ACTIVE` and `sessionVersion` must match - so disabled users and reset passwords end sessions immediately).
3. `csrf-sync` compares the header with the token stored in the session.
4. `requireRole('COLLEGE_HEAD')` → 403 for anyone else (an operator calling it directly gets 403).
5. `validateBody(schemas.certify)` → 422 on unexpected fields.
6. `commitService.certifyBatch`:
   - finds the batch **within the head's institution** (404 otherwise), returns the stored result if already `COMMITTED` (idempotent replay);
   - checks maker ≠ checker, transaction support, readiness (blockers, dispositions, stale rows, policy version);
   - a stale policy version sends the batch back to `NEEDS_CORRECTION` (never commits mixed capacities);
   - **lock**: conditional update `READY_FOR_REVIEW|COMMIT_FAILED → COMMITTING` (only one concurrent request wins);
   - **one transaction**: re-check state/policy/blockers → reserve seats per bucket with conditional `$inc` → create/link students → insert enrolments with history → detect conflicts → mark `COMMITTED` → append audit event. Any failure aborts everything.
   - capacity shortfall → `NEEDS_CORRECTION` + `409 CAPACITY_EXCEEDED`; unexpected failure → `COMMIT_FAILED` (retryable).
7. After the transaction: notifications and rule-based risk evaluation (best effort, outside the transaction, as spec 05 allows).

## 3. State machines (single source: `server/src/config/constants.js`)

### Upload batch

```
UPLOADED ──► VALIDATING ──► NEEDS_CORRECTION ◄──────────────┐
                 │  ▲            │  ▲                        │
                 ▼  │            ▼  │ (edit / exclude)       │
              VALIDATED ──► READY_FOR_REVIEW ──► COMMITTING ─┼─► COMMITTED (final)
                               │      ▲              │       │
                               ▼      │              └► COMMIT_FAILED (retry / return / revalidate)
                    RETURNED_FOR_CORRECTION                   │
   (UPLOADED / NEEDS_CORRECTION / VALIDATED / RETURNED / COMMIT_FAILED) ──► DISCARDED (final)
```

Every transition is a conditional update (`findOneAndUpdate({ status: { $in: allowedFrom } })`) and is checked against `BATCH_TRANSITIONS`. A server restart marks `VALIDATING` batches retry-required and `COMMITTING` batches `COMMIT_FAILED` (`recoverInterruptedJobs`).

### Enrolment lifecycle (spec 07 section 7)

| From | To | Seat effect |
| --- | --- | --- |
| PROVISIONAL | CONFIRMED | none |
| PROVISIONAL | WITHDRAWN / TRANSFERRED / DROPPED | release |
| CONFIRMED | WITHDRAWN / TRANSFERRED / COMPLETED / DROPPED | release |
| WITHDRAWN, TRANSFERRED, COMPLETED, DROPPED | - | final |

`STAGED` is represented by staging rows, never by an Enrolment document. Rows committed while their mock identity check was still pending (only possible under the `ALLOW_WITH_HEAD_DISPOSITION` setting) become `PROVISIONAL`; all others `CONFIRMED`. **Release happens exactly once**: the update filter includes `seatHeld: true` and sets it to `false`, and the ledger decrement requires `filled >= 1`.

### Other lifecycles

- **Conflict:** `OPEN → AWAITING_REVIEW` (justification) `→ RESOLVED` (accepted) or back to `OPEN` (rejected); `OPEN → RESOLVED` automatically when only one institution still holds an active enrolment (withdraw/transfer/drop/complete). Escalation level `REGIONAL → NATIONAL` (once).
- **Risk case:** `OPEN → ASSIGNED → REVIEWED | FALSE_POSITIVE`, or `ESCALATED` (still open). Evidence snapshots are only appended.
- **Consent / verification request:** `PENDING → APPROVED | DENIED | CANCELLED | EXPIRED`, `APPROVED → REVOKED | EXPIRED` (expiry applied lazily on every read).
- **Seat policy:** `DRAFT → PENDING_APPROVAL → PUBLISHED` (previous published → `SUPERSEDED`); approver ≠ author; `PENDING_APPROVAL → DRAFT` when returned.
- **User:** `PENDING_ACTIVATION → ACTIVE ⇄ DISABLED`.

## 4. Transaction boundaries

| Operation | Inside one transaction |
| --- | --- |
| Certify batch | batch state, seat ledger increments, students, enrolments + history, conflict detection, audit event |
| Enrolment state change (head) | enrolment + history, seat release, conflict auto-resolution, audit |
| Conflict withdraw/transfer | the above + conflict event |
| Publish seat policy | supersede old version, publish new, upsert ledgers, audit |
| Every audit append | chain-head compare-and-swap + event insert (a mini transaction when not already inside one) |
| Create verification request | consent + request + audit |

Transactions use `mongoose.connection.transaction()`, which retries on transient write conflicts. If the deployment is standalone, these operations refuse with `503 TRANSACTIONS_UNAVAILABLE` (audit appends fall back to a compare-and-swap loop; a crash between the two writes would show as a sequence gap in verify-chain).

**Database-level invariants:** unique indexes (one published policy per year; one seat-holding enrolment per student/course/year/institution; one enrolment per staging row; one open conflict per student/year; one active credential per enrolment/type; unique audit sequence; idempotency keys) and a **collection validator** on `seatledgers` enforcing `0 <= filled <= capacity`.

## 5. Validation pipeline

`services/validation/pipeline.js` loads one context per run (batch, active policy, courses, ledgers, matching register students, their active enrolments, contact-token counts) and runs pure layer functions in order:

| Layer | File | Outcomes |
| --- | --- | --- |
| L1 schema | `l1Schema.js` | required fields, formats, real dates, configured course/bucket codes, phone-like tokens rejected → ERROR |
| L2 identity (MOCK) | `l2Identity.js` | 12-digit format → ERROR; mock name mismatch / not found → WARNING; service pending/unavailable → PENDING; register identity conflict → ERROR; register name differs → WARNING |
| L3 duplicates | `l3Duplicates.js` | same student (code or demo ID) + course + year repeated → ERROR on every row, naming the others; already active at this institution → ERROR |
| L4 seat ledger | `l4SeatLedger.js` | per bucket: rows beyond `capacity - filled` → ERROR; no ledger / no published policy → ERROR. Additional (supernumerary) buckets never trigger a total-only overflow |
| L5 cross-college | `l5CrossCollege.js` | active elsewhere in the same year → WARNING (+ conflict case after commit) |
| L6 consistency | `l6Consistency.js` | academic year ≠ batch, year of study beyond duration, future date → ERROR; outside admission window → WARNING |
| L7 risk | `l7RiskSignals.js` | shared contact token, late addition, high share of additional buckets → RISK_FLAG (never blocks) |

The rule catalogue (`ruleCatalog.js`) is the explicit disposition policy: ERRORs must be fixed or the row excluded; WARNINGs need an operator justification **and** head acceptance; PENDING follows the admin setting `pendingIdentityPolicy` (default: block until the check completes); INFO / RISK_FLAG need no action.

**History and staleness:** each staging row has `rowVersion` (bumped on edit/exclude) and `validatedRowVersion`. Issues carry a fingerprint (rule + row + field + evidence key). On revalidation an identical issue on an unchanged row keeps its justification/disposition; a changed row's old issue becomes `SUPERSEDED`; an issue no longer detected becomes `RESOLVED`. Readiness is always recomputed from the database, so stale results can never unlock "mark ready" or "certify".

**Background job:** in `async` mode the upload/revalidate request returns `202 VALIDATING` and the job runs in-process; the UI polls. Status is stored in MongoDB; on restart unfinished jobs are marked retry-required. This is a lightweight in-process worker, not a durable queue (spec 05 section 6).

## 6. Data model (MongoDB collections)

Spec 06 collections: `users`, `institutions`, `courses`, `students`, `enrolments`, `seatledgers`, `seatpolicies`, `uploadbatches`, `stagingrows`, `validationissues`, `conflicts`, `consents`, `verificationrequests`, `credentials`, `auditlogs`, `notifications`.

Added (each needed by a spec 04 button): `regions` (allow-list for regional scope), `organisations` (issuer/verifier scope and onboarding), `riskcases` (risk queue with assignment/notes/review), `accesslogs` (student access history), `correctionrequests` (student correction workflow), `systemsettings` (documented demo settings), `auditchainheads` (serialises audit appends), `sessions` (express-session store).

Identifiers: `studentRef` is a random UUID-based platform reference; `studentCode` is the synthetic demo code used to match rows to the register; `syntheticExternalId` is the fake 12-digit mock identifier. Public references (`BATCH-…`, `ENR-…`, `CONF-…`, `RISK-…`, `VRQ-…`, `CNS-…`, `CRD-…`) are random, never sequential.

## 7. Audit chain

`hash = SHA-256(canonical JSON of {sequence, timestamp, actor, role, action, entity, institution, regions, reason, eventPayloadHash, previousHash})`, `eventPayloadHash = SHA-256(canonical JSON of the safe payload)`, genesis `previousHash = 64 zeros`. `verifyChain()` recomputes every hash and link, checks sequence continuity and the chain head, and reports each failing sequence. The Mongoose model refuses updates/deletes. Limits are in `SECURITY_AND_LIMITATIONS.md`.

## 8. Client architecture

- `app/App.jsx` - routes grouped by role behind `ProtectedRoute` (UX only); role areas are lazy-loaded.
- `features/auth/AuthContext.jsx` - loads `/api/auth/me`, signs out the UI when any API call returns 401.
- `services/apiClient.js` - fetch wrapper: cookies, CSRF header (refreshed once automatically), normalised `ApiError`.
- `hooks/useApi.js` - `useApi` (load + reload + error) and `useAction` (single-flight mutations, toasts).
- `components/` - accessible shared pieces (Modal with focus handling, ConfirmDialog, ReasonDialog, StatusBadge with icon + text, DataTable, Pagination, KpiTile, SeatBar, Stepper).
- Pages never decide permissions: buttons are enabled from server-provided `permissions` / `readiness` / `availableActions`, and every action is re-checked by the API.

## 9. Observability

One JSON log line per request (request id, method, path without query string, status, duration, actor reference). Bodies, passwords, tokens and session ids are never logged. `GET /api/health` reports database connectivity and whether transactions are available.
