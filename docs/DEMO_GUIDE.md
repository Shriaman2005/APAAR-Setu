# APAAR Setu - Demo guide

A repeatable demonstration based on spec `10_Synthetic_Demo_Data_and_Scenarios.pdf` (section 7, "seven-minute demo") plus the failure scenarios. Everything uses synthetic data from [`fixtures/`](../fixtures/).

**Say this at the start:** "APAAR Setu is a student prototype with synthetic data. It is not an official AICTE or APAAR system. Identity checks, AICTE approval data and DigiLocker are mock adapters; QR codes are status links, not signed credentials."

## Before the demo

1. Start the database: `npm run db:dev` (leave it running).
2. Fresh demo data: `npm --prefix server run demo:reset -- --confirm` (or `npm run seed` on an empty database). Note the passwords printed in the terminal, or set `DEMO_PASSWORD` in `.env` beforehand.
3. Start the app: `npm run dev`, open http://localhost:5173.
4. Use a separate browser profile or a private window per role so you can stay signed in as two users at once.

Accounts: `operator.demo`, `head.demo`, `national.demo`, `regional.demo`, `admin.demo`, `approver.demo`, `issuer.demo`, `verifier.demo`, `student.demo`, `head.xyz.demo` (all `@example.test`).

## The seven-minute flow

### 1. Upload (operator)

1. Sign in as **operator.demo@example.test** → **Upload batch**.
2. **Download template** and **Download version note** (show the "synthetic, not an official template" notice and the permitted values on the right).
3. Academic year **2026-27** → **Choose CSV file** → `fixtures/missing_required_field.csv` → **Run pre-check** (client check passes: the header is fine) → **Submit upload**.
4. The batch ID appears with status **Validating**; open it - it becomes **Needs correction**.

*Expected:* row 2 `L1_REQUIRED_FIELD` on `courseCode`, row 3 `L1_REQUIRED_FIELD` on `studentName`; "Mark ready for review" is disabled and the yellow box lists exactly why.

### 2. Fix errors (operator)

1. In **Validation issues**, click **Row 2** → set *Course code* to `CSE` → **Save correction**. Do the same for **Row 3** with *Student name* `Rishi Verma`.
2. The KPI "Changed since validation" shows 2 and readiness says "revalidate".
3. **Revalidate changed rows** → status **Validated**, 0 open errors.
4. Switch **Show → History** to show the earlier errors marked **Resolved** (before/after results are kept).

Optional: upload `bad_mock_external_id.csv` (11-digit ID → `L2_EXTERNAL_ID_FORMAT`, "format check only") and `duplicate_in_batch.csv` (rows 2 and 4 each name the other; use **Rows → Exclude** on row 4, then revalidate).

### 3. Seat ledger (operator → head)

1. Upload `fixtures/bucket_overflow.csv` (four NRI rows; NRI capacity is 3 in synthetic policy DEMO-v1).
   *Expected:* rows 2-4 pass, **row 5** gets `L4_BUCKET_CAPACITY_EXCEEDED` explaining capacity 3, 0 filled, 4 requested. Nothing is committed.
2. Open **Seat ledger** to show capacity/filled/remaining and the `SYNTHETIC_DEMO_CONFIG` label.
3. Now upload `fixtures/clean_batch.csv` → **Validated** → **Mark ready for review** (confirm).
4. Sign in as **head.demo@example.test** → **Submissions** → open the batch. Show the **seat ledger impact** table and the declaration.
5. **Certify and submit** → tick the declaration, type the batch ID (OTP/e-sign is not implemented - this is the labelled confirmation step) → **Certify and submit**.
   *Expected:* **Committed**; CSE / REGULAR filled increases by 4; the operator gets a notification.

Point out: an operator calling the certify API directly gets **403**, and a second click/retry never double-counts seats (tested).

### 4. Conflict (heads of both colleges, regional officer)

1. As **head.demo** → **Conflicts** → open the case for STU-005 (seeded: active at ABC-DEMO and XYZ-DEMO in 2026-27).
   *Expected:* the other college shows only institution, region and state - not course, bucket or dates. The notice says it is not a finding of fraud.
2. As **operator.demo** you can **Submit facts / evidence note** (the other college only sees that a response exists).
3. As **head.xyz.demo@example.test** → open the same case → **Mark our enrolment transferred** with a reason.
   *Expected:* case **Resolved (TRANSFERRED)**, XYZ's seat released exactly once, history kept.
4. Alternative path: **Justify both enrolments** → as **regional.demo**, **Accept** or **Reject justification**, or **Escalate to national level** (once).

### 5. Risk queue (national or regional officer)

1. Sign in as **national.demo@example.test** → **Risk queue** → open the shared-contact case at PQR-DEMO.
   *Expected:* score **90/100** with the formula "30 + 5 x students sharing the token", 12 students, masked token and student references, ruleset `RISK-RULES-DEMO-v1`, the notice that it is not a probability of fraud.
2. **Assign reviewer** (only officers in scope are listed) → **Add note** → **Mark reviewed** (summary required) *or* **Mark false positive** (reason required; evidence is kept).

### 6. Consent (verifier and student)

1. As **student.demo@example.test** → **My record** → copy the **verification reference** (`SR-…`). (STU-001's record exists once the clean batch from step 3 is certified.)
2. As **verifier.demo@example.test** → **New request** → paste the reference, purpose *Employment background check*, fields *Student name* + *Enrolment status* (only allowed fields are offered; the server rejects others), expiry 7 days → **Submit request**. Status: **Pending**; "View approved result" is disabled.
3. As the student → **Consent inbox** → **Approve** (you may untick a field) → confirm.
4. As the verifier → **View approved result** → only the approved fields are shown.
5. As the student → **Access history** shows who saw what and when. Then **Active consents → Revoke consent** → the verifier's result is now refused.

### 7. QR credential and audit (issuer, public, national officer)

1. As **issuer.demo@example.test** → search `STU-002` → **View permitted details** → **Generate Enrolment certificate (DEMO)**. The QR, reference and the "not a signed credential" warning appear. **Open printable certificate** shows the DEMO watermark.
2. **Check public status** (or scan the QR at http://localhost:5173/verify with a phone camera/upload) → **Valid**, no personal data.
3. Back as issuer → **Revoke** with a reason → the same status page now says **Revoked**. Changing one character of the reference gives **Invalid or tampered**.
4. As **national.demo** → **Audit explorer** → **Verify chain** → **PASS**.
5. In a terminal: `npm --prefix server run demo:tamper-audit -- --sequence 5` (edits one stored event directly in MongoDB). **Verify chain** again → **FAIL at sequence 5**. Restore with `npm --prefix server run demo:tamper-audit -- --restore`.

Explain the limit honestly: the chain detects this uncoordinated change; someone able to rewrite every hash could avoid detection, which is why production needs separately protected checkpoints.

## Further scenarios

| Scenario | How | Expected |
| --- | --- | --- |
| Stale seat policy | As **approver.demo** → **Seat policies** → DEMO-v2 → **Approve and publish** (admin.demo cannot - maker-checker). Then as **head.demo** open `BATCH-ABC-DEMO-SEED-STALE` | **Certify** is disabled with the reason "validated under DEMO-v1 but DEMO-v2 is now active" (a direct API call is refused with `409 STALE_POLICY_VERSION` and the batch is sent back). Head → **Return for correction** → operator **Revalidate** → head certifies under DEMO-v2 |
| Registry pending | Upload `registry_pending.csv` | `L2_IDENTITY_CHECK_PENDING`, batch blocked (default policy). In **Settings** switch *Policy for PENDING identity checks* to `ALLOW_WITH_HEAD_DISPOSITION` → batch flagged for revalidation → after justification/acceptance the rows commit as **PROVISIONAL** and are never shown as verified |
| Mock service outage | **Settings** → *Mock identity service availability* = `UNAVAILABLE`, upload any file | Every identity check is PENDING; switch back and revalidate to complete them |
| Warnings and risk flags | Upload `warnings_demo.csv` | L2 name mismatch (warning), L6 admission outside window (warning) + L7 late addition (risk flag, non-blocking), L5 student active at XYZ-DEMO (warning → conflict case after certification). Operator **Justify** → head **Accept selected dispositions** → certify |
| Return for correction | Head → **Return for correction** with a reason | Operator sees the reason and can edit again |
| Enrolment lifecycle | Head → **Register** → open a record → e.g. **Mark withdrawn** | Seat released once; history kept; a second withdrawal is refused |
| Student correction | Student → **My record → Request correction** (name) → head → **Correction requests → Accept** | Register name updated, old name kept in history |
| User administration | Admin → **Users → Create user** | Account is *pending activation*; a one-time link is shown once (no email is sent) |
| Regional isolation | As **regional.demo** edit the dashboard URL to `?regionId=REGION-OTHER-DEMO` | 403 - other regions are never shown |
| Accessibility | Utility strip: **A+**, **High contrast**, **हिन्दी** | Text up to 150%, high-contrast palette, Hindi site chrome |

## If something goes wrong

- "This action needs MongoDB transactions": the database is not a replica set - use `npm run db:dev`.
- Forgot the demo passwords: `npm --prefix server run seed -- --reset-passwords`.
- Seat numbers look wrong: `npm --prefix server run check:ledger` (or **Admin → Ledger check**).
