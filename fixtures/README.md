# Synthetic demo fixtures

Everything in this folder is **fabricated test data** (spec 10). No real students, identifiers,
institutions or AICTE quotas. Never replace these values with real APAAR/Aadhaar data.

| File | Used for | Expected result |
| --- | --- | --- |
| `clean_batch.csv` | First successful upload (operator of ABC-DEMO) | No errors; can be marked ready and certified |
| `missing_required_field.csv` | L1 schema | Row 2 `courseCode` and row 3 `studentName` get `L1_REQUIRED_FIELD` errors |
| `bad_mock_external_id.csv` | L2 format | 11-digit identifier -> `L2_EXTERNAL_ID_FORMAT` error (format only, no registry lookup) |
| `duplicate_in_batch.csv` | L3 duplicates | Rows 2 and 4 both get `L3_DUPLICATE_IN_BATCH` naming each other |
| `bucket_overflow.csv` | L4 seat ledger | NRI capacity 3: row 5 (4th NRI seat) gets `L4_BUCKET_CAPACITY_EXCEEDED` |
| `registry_pending.csv` | L2 pending | Identifiers starting `999` -> `L2_IDENTITY_CHECK_PENDING` (never "verified") |
| `warnings_demo.csv` | Warnings + risk | Name mismatch (L2), late admission (L6 warning + L7 risk flag), student active at XYZ-DEMO (L5) |
| `cross_college_conflict.json` | Seeded L5 conflict case | STU-005 active at ABC-DEMO and XYZ-DEMO -> open conflict case |
| `shared_contact_risk.json` | Seeded L7 risk case | 12 students share `PHONE-DEMO-SHARED` at PQR-DEMO -> risk case (not a fraud label) |
| `stale_policy_batch.json` | Stale policy | Batch validated under DEMO-v1; publishing DEMO-v2 blocks its certification |
| `seat_policy_demo_v1.json` / `_v2.json` | Seat policies | Synthetic capacities labelled `SYNTHETIC_DEMO_CONFIG` |
| `demo_reference_data.json`, `background_enrolments.json` | Seed | Regions, institutions, courses, organisations and extra enrolments for dashboards |

Row numbers follow the spreadsheet convention: row 1 is the header, so the first student is row 2.
