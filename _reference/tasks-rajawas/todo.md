# Articles fix + Bulk import for Fees & Results

Two independent tracks. Track A is shipped; Track B is mid-build.

---

## Track A — Latest Updates / Articles 404 fix — ✅ DONE

- [x] A1. Add link-safety guard in `LatestUpdates.tsx` (sanitize `card.link`)
- [x] A4. Draft 4 articles. SQL seed at `scripts/migrations/cms/seed-articles-launch.sql`
- [x] A6. CMS "View live" link cross-origin fix in `apps/cms/src/app/articles/page.tsx`
- [ ] A7. User runs the seed script in Supabase SQL editor → verify cards appear on home page

---

## Track B — Historical bulk import (fees + results)

### Source format (confirmed from real samples, 2026-05-11)

**Fees:** "Day Book (Account Wise) Report" XLSX.
- Header at row 6: `S.No., Class, Section, "SR | Student Name | Father Name", APR, MAY, JUN, JUL, AUG, SEP, OCT, NOV, DEC, JAN, FEB, MAR, Total`
- Each month cell can contain zero or more payments in format: `{amount} | {dd/mm/yyyy} | {receipt#}:` separated by whitespace
- The "SR | Student | Father" column has pipes; SR (= ERP `admission_no`) may be blank for new admits

**Results:** "ResultGreensheet" XLSX, one per class.
- Header at row 5 or 6: `Sr, SR No, Student Name, Father Name, Mother Name, Category, Dob, Gender, Class, Section, Roll No, Total Metting, Present Metting,` then **6 columns per subject** ({SUBJECT} UPTO HALF YEARLY MAX, OBT, ANNUAL EXAM MAX, OBT, GRAND TOTAL MAX, OBT), then `Total Max Marks, Total Obt Marks, Division, Percentage, Rank, Result`
- Marks may carry a trailing " D" (distinction marker — strip before parsing)
- Subject set differs per class (Class I has 8 subjects, Class VI has 10)

### Auto-creation (added after user feedback 2026-05-11)

Both importers auto-create any missing `classes`, `sections`, and `streams` during commit. Dry-run preview lists what will be added. This removes the friction of pre-creating year-by-year class rosters for historical imports — classes are deterministic from the source data anyway.

### Locked product decisions

1. **Class names:** Built-in word→Roman map (FIRST→I, …, TWELFTH→XII, NURSERY/PLAY GROUP/LKG/UKG → unchanged, `(SCI.)`→Science stream, `(COMM.)`→Commerce stream). Dry-run lists distinct unmapped names; dialog renders dropdowns so user can pick the ERP equivalent before commit.
2. **Receipt numbers:** Rewrite to `HIST-{YYYY}-{original#}` to guarantee uniqueness and preserve audit trail.
3. **Fee structure:** Auto-create one `fee_structures` row per `(academic_year, class)` with `fee_type='Historical'`, `amount=0`. All imported payments for that bucket link there.
4. **Payment method:** Add new enum value `'historical_unknown'` (migration 054). Default for all imported rows.
5. **Editability:** Imported rows are fully editable in `/admin/fees` — they accept follow-up payments, edits, and receipts like native rows.
6. **Exam types:** Importer auto-creates `Half Yearly (Imported {YYYY}-{YY})` and `Annual (Imported {YYYY}-{YY})` per academic year encountered.
7. **Subjects:** Auto-create any subject name not already in the `subjects` table.
8. **Revert:** Admin-only button; deletes only rows with matching `import_batch_id` and `source='historical_import'`. Confirmation requires typing the batch ID. Blocked if any row has a downstream artifact (receipt PDF, follow-up payment, report card).

### Schema migrations

- [x] B-S1. `migration-051-import-source-fees.sql` — adds `source`+`import_batch_id` to `fee_payments`
- [x] B-S2. `migration-052-import-source-results.sql` — adds `source`+`import_batch_id` to `results`
- [x] B-S3. `migration-054-payment-method-historical-unknown.sql` — adds `'historical_unknown'` enum value (053 is taken by transport-pickup-audit)
- [x] B-S4. Schema mirrored into `supabase-schema.sql`
- [x] B-S5. `feePaymentSchema` accepts new payment_method value
- [ ] B-S6. User applies migrations 051, 052, 054 in Supabase Studio

### Shared helpers (`packages/shared/src/lib/historical-import/`)

- [x] B-H1. `class-name-map.ts` — wordform→Roman + stream parser (smoke-tested against real samples, all 17 distinct class names mapped)
- [x] B-H2. `parse-account-wise-fees.ts` — parses Day Book XLSX into `{ student_ref, payments[] }` rows (957 rows / 3534 payments parsed cleanly from real export)
- [x] B-H3. `parse-greensheet-results.ts` — parses Result Greensheet into `{ admission_no, class, section, marks: [{subject, exam, max, obtained}] }` rows (Class I and Class VI samples parse cleanly)
- [x] B-H4. `types.ts` — shared `RowResult`, `BatchSummary` shapes
- [x] B-H5. `index.ts` re-exports for ergonomic imports

### Fees historical importer

- [x] B-F1. `/api/fees/historical-import` POST — two-phase dry-run/commit, name-fallback matching, auto-creates Historical fee_structure buckets, ON CONFLICT receipt# DO NOTHING
- [x] B-F3. `/api/fees/historical-revert` POST — admin-only, type-to-confirm, blocks if any row refunded or follow-up native payment exists
- [x] B-F4. `HistoricalFeesImportDialog.tsx` — upload, preview, in-dialog class mapping, commit
- [x] B-F5. Wired into `/admin/fees` payments section header
- [ ] B-F6. "Historical Imports" sub-panel: list past batches with revert button per batch (deferred — revert callable via direct POST with batch_id for now)

### Results historical importer

- [x] B-R1. `/api/results/historical-import` POST — auto-creates `Half Yearly (Imported …)` + `Annual (Imported …)` exam_types, auto-creates missing subjects, upserts on `(student_id, subject_id, exam_type_id)`
- [x] B-R2. `/api/results/historical-revert` POST — admin-only, blocks if any row referenced by a marksheet publication
- [x] B-R3. `HistoricalResultsImportDialog.tsx`
- [x] B-R4. Wired into `/admin/exams/results` page header
- [ ] B-R5. "Historical Imports" sub-panel with revert per batch (deferred — see B-F6)

### Validation

- [ ] B-V1. E2E fees: upload `Day Book (Account Wise) Report 2025-26.xlsx` → preview → fix unmapped classes → commit → verify rows appear in `/admin/fees` and on a student's payment history
- [ ] B-V2. E2E results: upload `SIX CLASS.xlsx` + `FIRST CLASS.xlsx` → commit → verify auto-created exam_types and rows appear on student marksheets
- [ ] B-V3. Idempotency: re-upload same file → row count unchanged (ON CONFLICT skip)
- [ ] B-V4. Revert: import → revert → confirm rows gone, native rows untouched
- [ ] B-V5. RBAC: editor without admin role gets 403 on revert
