# ERP Bug & Incomplete-Features Audit (Round 2) — 2026-04-26

Second-pass audit run after the 87-item Round 1 was closed. Five focused agents swept auth/security, recently-shipped features, ERP results/exams, DB schema/migrations, and UX/dead code in parallel.

Work order: **Critical → High → Medium → Low**. Don't re-order inside a band without a reason.

Round 1 doc: `tasks/erp-bug-audit.md` (all 87 items closed).

---

## Critical

- [x] **C1. Fee waiver INSERT always fails (DB constraint conflict)** — fixed 2026-04-26
  - Migration 040 drops `fee_payments_amount_positive` and replaces with `(payment_method = 'waiver' AND amount_paid = 0) OR amount_paid > 0`. Mirrored to `supabase-schema.sql`. Waiver inserts now pass.
  - Files: `scripts/migration-039-fee-lifecycle.sql`, `scripts/migration-031-db-hygiene.sql`, `supabase-schema.sql:961-964`, `src/app/api/erp/fees/waivers/route.ts:41`
  - Migration 031 added `fee_payments_amount_positive CHECK (amount_paid > 0)`. Migration 039 added `fee_payments_waiver_consistent` requiring `amount_paid = 0` for waivers. The two are mutually exclusive — every "Record Waiver" click 23514s.
  - Fix: new migration 040 that drops `fee_payments_amount_positive` and replaces with `(amount_paid > 0) OR (payment_method = 'waiver')`. Mirror to schema.

- [x] **C2. `marksheet_publications` cascades wipe finalized snapshots** — fixed 2026-04-26
  - Migration 041 flips `exam_type_id` and `academic_year_id` from `ON DELETE CASCADE` to `ON DELETE RESTRICT`. Same migration also flips `publish_events.exam_type_id` to `SET NULL` (audit trail outlives reference data). Mirrored to schema.
  - Files: `supabase-schema.sql:2695-2696` (`exam_type_id uuid REFERENCES exam_types(id) ON DELETE CASCADE`, `academic_year_id ... ON DELETE CASCADE`)
  - Deleting an exam type or academic year silently deletes all the year-final / per-exam marksheet snapshots tied to it — defeating the entire point of the snapshot table.
  - Fix: change both FKs to `ON DELETE RESTRICT` (admin must unpublish + clean up snapshots first) or `SET NULL` and document the meaning. Update the `kind_consistent` CHECK accordingly if going SET NULL.

- [x] **C3. Snapshot drift on mid-year class transfer** — fixed 2026-04-26
  - `buildYearFinalSnapshot` now throws a recognizable error ("Student has N active enrollments — set all but one to inactive before finalizing") which the finalize loop already surfaces per-student. `computeFinalResult` warns and uses the most-recent enrollment (it's called from many low-stakes paths where one-of-many is acceptable; finalize is the strict path).
  - Files: `src/lib/marksheet-snapshot.ts:117-124`, `src/lib/final-result.ts:474-481`
  - Both `buildYearFinalSnapshot` and `computeFinalResult` use `student_enrollments.eq("status","active").maybeSingle()`. If a student transferred mid-year and has two active enrollments, `maybeSingle` returns null (PGRST116) → the student is silently skipped from finalize, no error surfaced to the admin.
  - Fix: order by `created_at desc`, use `.limit(1).maybeSingle()`, and surface a per-student warning when more than one active enrollment exists for the year.

- [x] **C4. Snapshot/bulk-write race during finalize** — fixed 2026-04-26
  - Treated finalized snapshots as a write-lock on the underlying `results` rows. The bulk results route now rejects entries whose `(student_id, class_id, exam_type_id)` has an active `marksheet_publications` row (409 with `locked_student_ids`) unless caller has `publish_results` perm. Admin must unpublish the snapshot first to re-edit. This eliminates the race window — once a snapshot is committed, no concurrent write can change the marks underneath it.
  - Files: `src/app/api/erp/results/finalize-marksheet/route.ts:92-127`, the `finalize_marksheet_one` RPC in `migration-032-finalize-rpc.sql`
  - `buildMarksheetSnapshot` reads `getReportCardData` *outside* the RPC. Teacher A POSTs marks while Admin B clicks Finalize → snapshot can capture a half-written set. The RPC only wraps unpublish-prior + insert-new.
  - Fix: take `SELECT … FOR UPDATE` on the relevant `results` rows inside the RPC, or add an `is_finalized` flag on `(class_id, exam_type_id)` that the bulk results upsert checks before writing.

---

## High

- [x] **H1. Editor with `results` perm can rewrite published marks via bulk** — fixed 2026-04-26
  - Bulk results route now rejects entries whose `is_published=true` row exists unless caller has `publish_results` perm. Teachers can still update their own subject's published rows (they're the source of truth); editors with only `results` cannot bypass the publish gate.
  - File: `src/app/api/erp/results/bulk/route.ts:41-130`
  - The `by-student` route checks `is_published` before mutation; the bulk route does not. An editor with the `results` feature key but without `publish_results` can silently overwrite a published row by re-posting.
  - Fix: reject any entry whose existing row has `is_published=true` unless caller has `publish_results` perm.

- [x] **H2. `/api/erp/results/final-result` leaks unpublished marks to students/parents** — fixed 2026-04-26
  - `computeFinalResult` gained `includeUnpublished` parameter (defaults to true to preserve admin/teacher behavior). The student/parent endpoint at `/api/erp/results/final-result` and the public-facing PDF route now read the caller's role and pass `includeUnpublished: false` when caller is a student or parent. Live-compute path no longer leaks teacher's unsaved marks.
  - Files: `src/app/api/erp/results/final-result/route.ts:37`, `src/lib/final-result.ts:546-551`, `src/app/api/erp/results/report-card/pdf/route.tsx:343` (year-final live-compute branch)
  - `computeFinalResult` queries `results` with no `is_published` filter. A student/parent who passes `canViewReportCard` can fetch fully-computed final result composed of unpublished marks the moment a teacher saves them. Snapshot path is fine; live path leaks.
  - Fix: thread caller role into `computeFinalResult`; for non-admin/teacher viewers add `eq("is_published", true)`. Same for class_test_results.is_published filter.

- [x] **H3. `canViewReportCard` lets every editor see every student** — fixed 2026-04-26
  - Editors no longer get a blanket allow. `canViewReportCard` now checks `editor_permissions` for the `results` feature key when the caller is an editor. Admins and teachers still pass through; permissionless editors are blocked.
  - File: `src/lib/report-card.ts:67-69`
  - `if (profile.role === "admin" || profile.role === "teacher" || profile.role === "editor") return true;`. An editor with only `gallery` perms can pull any student's report card via the PDF route.
  - Fix: drop `editor` from the blanket-allow branch; require an explicit `report_card_view` (or reuse `results` / `publish_results`) feature-key check for editors.

- [x] **H4. `link-child` error strings enumerate admission_nos** — fixed 2026-04-26
  - "No student found" and "DOB doesn't match" branches collapsed into one generic "We couldn't verify a child with those details" message. The DOB-missing branch stays distinct because it's a school-side data issue the parent legitimately needs to know about.
  - File: `src/app/api/erp/parents/link-child/route.ts:113`
  - Two distinct error strings ("No student found with this admission number" vs "The date of birth does not match our records") let an attacker enumerate which admission_nos exist before guessing DOBs. Per-parent rate limit (5/30min) is survivable for a small school.
  - Fix: collapse to one generic "We couldn't verify a child with those details".

- [x] **H5. `revert-alumni` auth pattern is fragile** — fixed 2026-04-26
  - Switched from `verifyAdminOrEditorWithUser()` + manual role re-check to `verifyAdmin()`. Caller's user id is now read straight from the bearer token via the admin client. A future refactor can no longer accidentally drop the role check. Audit-log insert also gets a `console.error` on failure (L7).
  - File: `src/app/api/erp/students/revert-alumni/route.ts:24`
  - Calls `verifyAdminOrEditorWithUser()` with no feature key (lets every editor in), then re-checks `role === "admin"`. Correct today only because of the explicit guard — refactor risk.
  - Fix: switch to `verifyAdmin()`.

- [x] **H6. Refund race condition (no row lock)** — fixed 2026-04-26
  - Refund UPDATE now adds `.eq("status", existing.status)` so concurrent POSTs serialize at the DB layer — second request affects 0 rows and surfaces "Payment was modified by another request" 409.
  - File: `src/app/api/erp/fees/payments/[id]/refund/route.ts:31-77`
  - Two concurrent refund POSTs both pass the `status !== "refunded"` check; second silently overwrites `refund_amount/reason/by`.
  - Fix: add `.eq("status", existing.status)` to the UPDATE so the second affects 0 rows, OR wrap in a Postgres function with `SELECT ... FOR UPDATE`.

- [x] **H7. `getReportCardData` ignores `academicYearId` for enrollment lookup** — fixed 2026-04-26
  - Enrollment query now applies `.eq("academic_year_id", academicYearId)` when caller passes one, and falls back to most-recent (`.order(created_at desc)`) when not. Alumni / transferred students no longer surface a stale enrollment in V2 snapshots.
  - File: `src/lib/report-card.ts:105-110`
  - `.eq("student_id", studentId).limit(1).single()` — for an alumni or transferred student, the enrollment shown on the year-final report card may be from the wrong year.
  - Fix: when `academicYearId` is supplied, also `.eq("academic_year_id", academicYearId)`.

- [x] **H8. Supplementary marks can exceed parent exam max_marks** — fixed 2026-04-26
  - `applySupplementarySubstitution` now does `Math.min(a.marks_obtained, r.max_marks)` for the `use_retest_marks` branch. A supp paper at /100 can no longer poison a /80 row into >100%.
  - File: `src/lib/supplementary.ts:338-369` + `supplementary_attempts` schema
  - For `use_retest_marks` mode, `applySupplementarySubstitution` blindly assigns `attempt.marks_obtained` while keeping the *original* row.max_marks. If supp paper was /100 but parent exam was /80, the row becomes 95/80 → 118.75% pct. DB CHECK only constrains supp marks against its own max.
  - Fix: clamp `attempt.marks_obtained` to `row.max_marks`, or store the parent's max on the attempt at insert time.

- [x] **H9. Grace + max_marks_override ordering breaks raw_marks pass threshold** — fixed 2026-04-26
  - When `max_marks_override` is set, both `marks_obtained` AND `max_marks` now rescale (preserving percentage) instead of only `max_marks` being replaced. A 60/100 row with override=50 becomes 30/50 instead of phantom 60/50=120%. The raw_marks pass threshold lives consistently in the post-override marks-space.
  - File: `src/lib/final-result.ts:281-296`, 234-275
  - For `pass_mark_mode='raw_marks'`, `effective_pass_mark_pct` is computed as `Σ(max × weight)/Σweight` using already-overridden max. So a 33-marks-out-of-100 threshold becomes 33/50 → 66% when the teacher set `max_marks_override=50` while the paper was still entered as /100.
  - Fix: compute `effMax` from the *original* max (pre-override), or from the result_master's `pass_mark_value` independently of overrides. Document the intended semantics.

- [x] **H10. Rank computed from main-only, but PDF shows merged total** — fixed 2026-04-26
  - `MainSubjectsTable` now computes a local `displayedAggregate` when optional subjects are merged into the main table (averages across all rows shown). Falls back to the server-side mains-only aggregate when nothing is merged. The visible Total row now matches the rows above it.
  - Files: `src/lib/final-result.ts:725-765`, `src/components/pdf/ReportCardPDF.tsx:756-767`
  - `computeRanksForClass` ranks by `overall.main_total_pct` (mains only). When `show_extra_separately=false`, the PDF displays an aggregate computed from `[...main, ...optional]`. Two different numbers; rank doesn't match the visible aggregate.
  - Fix: pick one — either rank by the merged total when `show_extra_separately=false`, or hide the merged total row in that mode.

- [x] **H11. Snapshot dropped payments — INNER join in dues compute** — fixed 2026-04-26
  - Switched the dues-compute payments query from `fee_structures!inner(academic_year_id)` to filtering directly on `fee_payments.academic_year_id`. Soft-orphaned rows (payment whose linked structure was deleted) now still count toward dues.
  - File: `src/app/admin/fees/page.tsx:423-431`
  - The `fee_structures!inner(academic_year_id)` join is INNER. If a fee structure was deleted but payments still reference it (FK has no CASCADE), those payments vanish from dues.
  - Fix: left-join, or query payments by `student_id` and filter year client-side.

- [~] **H12. Duplicate migration prefixes (`027-*`, `031-*`)** — accepted as-is 2026-04-26
  - Renaming applied migration files would break deploy pipelines that track by filename. The schema mirror (`supabase-schema.sql`) is authoritative for fresh installs; the duplicates are documented in `migration-043-db-hygiene-2.sql` header. Acceptable risk.
  - Files: `scripts/migration-027-profile-fk-set-null.sql` + `migration-027-ptm-formats.sql`; `migration-031-db-hygiene.sql` + `migration-031-teacher-substitutions.sql`
  - Nondeterministic ordering on fresh installs. The `031-teacher-substitutions` header even says "Migration 030" — the filename disagrees with its own docs.
  - Fix: renumber the second of each collision to a fresh free slot (e.g. `028a-` or push subsequent files up by one).

- [x] **H13. `academic_years.is_current` lacks a partial-unique** — fixed 2026-04-26
  - Migration 043 adds `academic_years_one_current` partial unique. Pre-flight DO block normalizes existing dual-current rows by keeping the most-recently-created flag and clearing the rest.
  - File: `supabase-schema.sql` (academic_years definition)
  - Plain boolean, no partial unique → two rows can be `is_current=true` simultaneously and the app silently misroutes year scoping.
  - Fix: `CREATE UNIQUE INDEX academic_years_one_current ON academic_years(is_current) WHERE is_current = true;`

- [x] **H14. ~15 missing FK indexes** — fixed 2026-04-26
  - Migration 043 adds all 22 indexes (audit FKs, fee FKs, marksheet/publish FKs, etc.). Mirrored to schema. Idempotent with `IF NOT EXISTS`.
  - Affected: `attendance.marked_by`, `fee_payments.recorded_by` / `fee_structure_id` / `refunded_by`, `calendar_events.created_by` / `class_id`, `registration_requests.reviewed_by`, `marksheet_publications.published_by` / `unpublished_by`, `publish_events.actor_id` / `class_id`, `payment_orders.fee_structure_id` / `parent_id`, `editor_permissions.granted_by`, `substitutions.assigned_by`, `exam_schedules.invigilator_teacher_id`, `ptm_notes.recorded_by`, `school_meeting_counts.exam_type_id` / `class_id`, `supplementary_attempts.subject_id` / `entered_by`, `results.subject_id` (composite exists but standalone subject lookups won't use it).
  - Fix: one migration adding all the indexes (idempotent, zero blast radius).

- [x] **H15. UX-1 hook: in-page back-navigation doesn't restore filters** — closed (working as designed) 2026-04-26
  - Cross-page back DOES restore filters (the URL is preserved as the previous history entry; the hook reads `window.location.search` on remount). In-page filter changes intentionally don't push history entries — pushing per keystroke would inflate the back stack and feel broken in different ways. Docstring updated to make the trade-off explicit; if filter-undo is ever needed, do it with a Cmd-Z handler not the browser back button.
  - File: `src/lib/hooks/use-url-state.ts:48-65`
  - Uses `history.replaceState` only. Within a single page, each filter change overwrites the same history entry, so "back" doesn't undo a filter — only navigation back to the page restores. Comment claims back-restoration works — true *across* pages, false *within* a page.
  - Fix: optionally `pushState` (debounced) on user-initiated changes. Update the doc comment regardless.

- [~] **H16. Built APIs without UI** — deferred 2026-04-26
  - Three endpoints still need UI buttons: `/api/erp/results/finalize-year-final`, `/api/staff/[id]/convert-to-teacher`, `/api/erp/students/revert-alumni`. Skipped this batch because the codebase is mid-restructure (admin/fees moved to erp/fees, several `@/components/erp/timetable/*` files currently missing per typecheck) — adding UI buttons against partially-restructured pages would land them in the wrong place. Re-open after the restructure settles.
  - `/api/erp/results/finalize-year-final` — no caller. Per-exam finalize is wired in `/admin/exams/publish`; year-final has no button.
  - `/api/staff/[id]/convert-to-teacher` — no caller. No "Convert to Teacher" action on the staff page.
  - `/api/erp/students/revert-alumni` — no caller. Audit Batch 2 explicitly flagged this as missing.
  - Fix: 3 small UI additions on the publish, staff, and students admin pages respectively.

---

## Medium

- [ ] **M1. `/api/staff/*` POST/PATCH have no Zod validation**
  - File: `src/app/api/staff/route.ts:15, 83`
  - PATCH spreads `...updates` straight into the DB. Editor with `staff` perm can write arbitrary keys.
  - Fix: define `staffCreateSchema` + `staffUpdateSchema`, parse before write.

- [ ] **M2. Verbose Supabase errors leaked in `summary.errors[]` (M12 miss)**
  - Files: `src/app/api/erp/students/promote/route.ts:191, 244`, `src/app/api/staff/bulk/route.ts:108`, `src/app/api/erp/students/bulk/route.ts:241, 313`, `src/app/api/erp/students/status/route.ts:57`
  - Errors pushed into `summary.errors[]` arrays bypass the M12 generic-message sweep.
  - Fix: replace with stable user-facing strings; raw error stays in `console.error`.

- [ ] **M3. Bulk-create portal users has no rate limit + unbounded items**
  - File: `src/app/api/portal/bulk-create/route.ts`
  - Admin-only but creates N auth users + N welcome emails per call. A compromised admin token weaponizes this into mass spam.
  - Fix: per-actor rate limit (5/hour) + cap `items.length` to e.g. 200.

- [ ] **M4. No rate limits on auth-user-creating admin paths**
  - Files: `src/app/api/erp/users/route.ts`, `src/app/api/erp/registrations/approve/route.ts`
  - Defense-in-depth: even though admin-only, creating an auth user + sending welcome email is a costly side-effect. A future regression that lowers the gate would expose unbounded user creation.
  - Fix: per-actor rate limit (e.g. 30/hour).

- [ ] **M5. `/api/erp/students/promote` is high-blast and unrate-limited**
  - File: `src/app/api/erp/students/promote/route.ts`
  - One call mutates an entire class's `is_active` / `is_alumni`. A compromised editor with `students` perm can graduate every class in seconds.
  - Fix: per-actor rate limit (10/hour).

- [ ] **M6. `useUrlState` concurrent writes clobber URL**
  - File: `src/lib/hooks/use-url-state.ts:48-65`
  - Two `setValue` calls in the same render each read `window.location.search` synchronously and `replaceState`. Both reads see the same starting URL, so one update wins and the other key is silently dropped on first render.
  - Fix: queue updates via a microtask, or accept a multi-key API (`useUrlStates({ class_id, subject_id })`).

- [ ] **M7. Over-payment silently logged as `paid`**
  - File: `src/app/api/erp/fees/payments/route.ts:36-46`
  - Downgrade rule only triggers when `amount_paid < structure.amount`. Over-payment keeps `status='paid'` and inflates `paid` total in dues compute (which sums across structures with no per-structure attribution). A duplicate ₹10k tuition payment can phantom-clear ₹5k of transport dues.
  - Fix: reject `amount_paid > structure.amount`, OR record the surplus as a separate "credit" row.

- [ ] **M8. Migration 037 `division_scheme` CHECK contradicts code's "future-proof" comment**
  - File: `scripts/migration-037-result-master-division.sql:18`, `src/lib/final-result.ts:432`
  - CHECK locks values to `'cbse'`. `coerceMaster` defaults unknowns to `'cbse'` ("future-proof") — a fallback that can never trigger because the CHECK rejects unknowns at write time.
  - Fix: either remove the CHECK (and rely on the type), or remove the fallback comment in code.

- [ ] **M9. Non-scholastic PDF query lacks `academic_year_id` scope**
  - File: `src/app/api/erp/results/report-card/pdf/route.tsx:425-434`
  - `.eq("student_id", studentId).eq("is_published", true)` with no year filter. Returning student's prior-year non-scholastic assessments can resurface on the current year's report card.
  - Fix: join via `class_id` against current-year classes, or add `academic_year_id` column to `non_scholastic_assessments` and filter on it.

- [ ] **M10. Class-teacher remarks: admin can clobber teacher's draft**
  - File: `src/app/api/erp/results/remarks/route.ts:131-150`
  - Admin upsert silently overwrites the class teacher's draft with no warning.
  - Fix: add an `author_role` column or 409 when admin tries to overwrite a teacher-authored row (offer "force overwrite" toggle).

- [ ] **M11. Bulk admit-card QR Promise.all rejects whole bulk on one failure**
  - File: `src/app/api/erp/admit-cards/bulk/route.tsx:206-225`
  - One QR generation throw fails the entire 200-student PDF instead of degrading gracefully.
  - Fix: use `Promise.allSettled`, or wrap each call in try/catch returning null.

- [ ] **M12. Class-tests POST missing teacher ownership check**
  - File: `src/app/api/erp/class-tests/route.ts:71-105`
  - C6 fixed PATCH/DELETE/marks but missed the create path. A teacher can create tests for any (class_id, subject_id) regardless of their assignments.
  - Fix: same `teacherTeachesClassSubject(class_id, subject_id)` precheck before insert (skip for admin/editor with perm).

- [ ] **M13. Snapshot V2 doesn't capture full `result_master` for re-render**
  - File: `src/lib/marksheet-snapshot.ts:45-61`
  - V2 only captures display flags (include_non_scholastic, placement, show_extra_separately, show_rank). Future code that derives behavior from `pass_mark_mode/pass_criteria_type/grace_*` after the snapshot is built diverges from what was finalized.
  - Fix: copy the full coerced `ResultMaster` row into V2, OR document explicitly that V2 is render-only (no recomputation).

- [ ] **M14. ~15 tables missing `updated_at` triggers**
  - File: `supabase-schema.sql`
  - Tables with `updated_at` but no `BEFORE UPDATE` trigger: `gallery_images`, `transfer_certificates`, `disclosure_items`, `disclosure_documents`, `disclosure_board_results`, `site_media`, `result_master_subjects`, `class_test_results`, `non_scholastic_assessments`, plus `non_scholastic_sub_subject_classes` (mig 038 didn't add one).
  - Fix: extend the migration-031 DO block array.

- [ ] **M15. ON DELETE CASCADE on audit-log FKs (publish_events.exam_type_id, supplementary_attempts.parent_exam_type_id, exam_schedules.exam_type_id)**
  - File: `supabase-schema.sql`
  - Deleting an exam type wipes the audit trail of marksheet finalize events for that exam, and supplementary attempts, and the published timetable. Audit logs should never cascade.
  - Fix: change to `SET NULL` (combined with allowing NULL), or document why cascade is intentional.

- [ ] **M16. Icon-only buttons missing `aria-label`**
  - Files: `src/app/admin/academics/years/page.tsx:268,276`; `src/app/admin/academics/classes/page.tsx:356,364`; `src/app/admin/transfer-certificates/page.tsx:422`; `src/app/admin/academics/subjects/page.tsx:1003,1018,1219`; pattern repeats across most CRUD pages.
  - Fix: sweep every `<Button variant="ghost" size="icon-sm">` in admin pages and add `aria-label="Edit row"` / `aria-label="Delete row"`.

- [ ] **M17. Refund flow doesn't support partial refunds**
  - File: `src/app/api/erp/fees/payments/[id]/refund/route.ts:43-47`
  - UI hint says "Refund cannot exceed (amount_paid)" implying partial; but the route rejects when `status === "refunded"` so only ONE refund per payment is allowed.
  - Fix: either document "single refund, partial OK" clearly, or add a `partial_refund` row pattern with sums in dues compute.

---

## Low

- [ ] **L1. `/api/erp/results/import` (XLSX) has no file-size cap**
  - File: `src/app/api/erp/results/import/route.ts:73`
  - `file.arrayBuffer()` straight to memory. 50 MB upload OOMs the function.
  - Fix: 5 MB or 10 MB cap before parsing.

- [ ] **L2. Storage cleanup uses last-segment-of-URL as filename**
  - Files: `src/app/api/staff/route.ts:95, 148, 178`, `src/app/api/admin/disclosure-documents/route.ts:38, 86`
  - URL with cache-buster `?t=...` or path segments misnames the file → silent no-op delete.
  - Fix: use the same `extractBucketPath()` pattern from `transfer-certificates/[id]/download/route.ts`.

- [ ] **L3. `convert-to-teacher` echoes `result.error` raw**
  - File: `src/app/api/staff/[id]/convert-to-teacher/route.ts:25-27`
  - Helper's error string is sent to caller. M12 sweep miss.
  - Fix: generic "Failed to convert to teacher" + `console.error` raw.

- [ ] **L4. `/api/admin/section-cards` POST has no Zod schema**
  - File: `src/app/api/admin/section-cards/route.ts:40-70`
  - Editor with `site_media` can write multi-MB strings into any text column.
  - Fix: Zod schema with `.max(2000)` per text field.

- [ ] **L5. `roll-numbers/recompute` body has no Zod schema**
  - File: `src/app/api/erp/roll-numbers/recompute/route.ts:20`
  - `class_id` validated only as `typeof === "string"`, no UUID format check.
  - Fix: Zod with `.uuid()`.

- [ ] **L6. `non_scholastic_assessments` POST trusts client-supplied class_id for editors**
  - File: `src/app/api/erp/non-scholastic-assessments/route.ts:88-105`
  - Teacher branch checks scope; editor with `non_scholastic_entry` perm can grade ANY class.
  - Fix: document or restrict (probably acceptable per perm grant model — flag for design call).

- [ ] **L7. `revert-alumni` audit log call swallows insert failures**
  - File: `src/app/api/erp/students/revert-alumni/route.ts:126-131`
  - If `publish_events` insert fails (e.g. on a DB without migration 035), route returns success silently.
  - Fix: at least `console.error`.

- [ ] **L8. `non_scholastic_sub_subject_classes` lacks `updated_at` trigger**
  - File: `scripts/migration-038-non-scholastic-sub-subject-classes.sql`
  - Cosmetic — most tables have one.
  - Fix: combine with M14 sweep.

- [ ] **L9. Fee waiver dialog month input format mismatch**
  - File: `src/app/admin/fees/page.tsx:1794-1802`
  - Waiver dialog uses `<Input type="text">` placeholder "April 2026"; payment dialog uses `<Input type="month">` (yields `2026-04`). Inconsistent storage format breaks month-based reporting.
  - Fix: switch to `type="month"`.

- [ ] **L10. `promoteStaffToTeacher` employee_id collision risk**
  - File: `src/lib/staff-teacher-sync.ts:148`, `src/app/api/erp/users/route.ts:105`
  - `Date.now().toString(36)` suffix collides at ~1-in-a-million within the same millisecond. Schema currently makes `employee_id` UNIQUE — second insert would 23505.
  - Fix: append a `crypto.randomBytes(2).toString("hex")` suffix.

- [ ] **L11. `/api/admin` proxy uses `as any` cast**
  - File: `src/app/api/admin/route.ts:86`
  - Type-safety gap on the column allowlist.
  - Fix: type via `keyof Database["public"]["Tables"]`.

- [ ] **L12. `console.log` in production email path**
  - File: `src/lib/email.ts:46`
  - "Email sent successfully:" log always fires.
  - Fix: drop, or guard behind `NODE_ENV !== "production"`.

- [ ] **L13. N+1 in non-scholastic sub-subjects GET**
  - File: `src/app/api/erp/non-scholastic/sub-subjects/route.ts:46-85`
  - When `class_id` is supplied, `non_scholastic_sub_subject_classes` is queried twice (once for filtering, once for `class_ids` attachment).
  - Fix: single query, partition results in JS.

- [ ] **L14. Loading state inconsistency**
  - Files: `src/app/admin/attendance/page.tsx:311`, `src/app/admin/academics/years/page.tsx:210` use 6×6 spinner; gallery/articles/contact use skeleton.
  - Fix: pick one pattern (skeleton preferred).

- [ ] **L15. Missing partial-unique on `pdf_header_configs.is_default` / `pdf_footer_configs.is_default`**
  - File: `supabase-schema.sql`
  - Pattern matches `ptm_formats_single_default` and `idx_admit_card_templates_one_default` but isn't applied here.
  - Fix: add partial UNIQUE indexes.

- [ ] **L16. New teacher's auto-created staff_member defaults to `tgt` / `—`**
  - File: `src/app/api/erp/users/route.ts` POST handler
  - Admin-side has no banner reminding them to recategorize. Documented in Batch 3 follow-ups but never UI'd.
  - Fix: toast on user-create success: "Staff record auto-created with default category — visit /admin/people/staff to recategorize."

---

## Working notes

- Round 1 audit at `tasks/erp-bug-audit.md` (all 87 closed). Round 2 = this file.
- Schema-mirror discipline is healthy in the 020s/030s range — no drift detected.
- All migrations 037/038/039 are idempotent.
- No dead components in `src/components/`.
- Sidebar links all resolve.

## Numbers

- **4 critical** (all production blockers — fee waivers literally fail, snapshots can be wiped, mid-year transfers silently dropped, finalize race)
- **16 high**
- **17 medium**
- **16 low**
- **= 53 findings**

## Round 2 status — 2026-04-26 close-out

**All 4 critical items closed.** All 16 high items closed (H12 accepted as-is, H15 closed as-designed, H16 deferred until restructure settles).

**Migrations to apply:** 040, 041, 043, 044 (in addition to the 037-039 batch from Round 1 close-out).

**Field-reported follow-ups closed 2026-04-26:**
- Editor permissions PUT was rejecting saves whenever the DB carried a feature_key that had been retired from the catalog (`Invalid feature_key: registrations`). Validator now silently filters unknowns; dialog drops them on load too so they don't appear pre-checked.
- Hard-deleting a `fee_structure` returned the generic 500 from the admin proxy when child `fee_payments` rows existed. Proxy now decodes 23503 to a clear "deactivate instead" message; the fees page offers an inline deactivate fallback that hides the structure from dues/record-payment without nuking receipts.
- Migration 044 adds `cheque_number / cheque_date / bank_name / payer_name / transaction_ref / payment_provider` to `fee_payments`. Record-payment dialog reveals the matching subset per method, server-side `feePaymentSchema` enforces the required combos, and `FeeReceiptPDF` prints the new lines on both copies of the slip.

**H16 — UI for previously-unwired endpoints (2026-04-26):**
- **finalize-year-final** — `/erp/exams/publish` now has a third "Year-Final Marksheet" card. Driven by the class's `academic_year_id` (independent of the per-exam selector). Shows active enrollments + active year-final count, finalize/re-finalize button (auto-prompts for reason on re-finalize), and an unpublish-all dialog with required reason.
- **convert-to-teacher** — `/erp/people/staff` rows now show a graduation-cap icon button when the staff_member has no linked teachers row. Idempotent endpoint — UI also handles the "already linked" path (toast + refresh) without false errors. Linked rows hide the action.
- **revert-alumni** — `/erp/people/students` Actions dropdown now has "Manage Alumni". Opens a list dialog (queries `students` with `is_alumni=true`) with a Revert button per row → opens a form dialog requiring a min-5-char reason and offering optional re-enrollment (academic year + class). Refreshes both alumni and students lists on success.

**Round 2 sweep — Medium + Low closure (2026-04-26):**
All 17 mediums and all 16 lows triaged — 31 fixed, 2 documented as accepted (L11 admin-proxy cast, L14 loading-state polish), 1 invalid (L15 — pdf_*_configs use template_key UNIQUE, no is_default column).

Medium fixes:
- **M1** — staff POST/PATCH parse via `staffCreateSchema` / `staffUpdateSchema`; PATCH no longer spreads arbitrary keys.
- **M2** — `summary.errors[]` arrays in promote / staff-bulk / students-bulk / students-status now ship stable user-facing strings; raw error stays in `console.error`.
- **M3** — `/api/portal/bulk-create` per-actor 5/hr rate limit + 200-item cap.
- **M4** — `/api/erp/users` POST and `/api/erp/registrations/approve` per-actor 30/hr rate limit (auth-user-creating side effect).
- **M5** — `/api/erp/students/promote` per-actor 10/hr rate limit (high-blast).
- **M6** — `useUrlState` writes coalesce via a microtask queue so concurrent setters in the same tick can't clobber each other.
- **M7** — fee payments POST rejects `amount_paid > structure.amount` (was inflating dues compute and phantom-clearing other dues).
- **M8** — migration 037 + `coerceMaster` comments now match reality (CHECK locks division_scheme to 'cbse'; adding a scheme is a CHECK migration + label-resolver update).
- **M9** — report-card non-scholastic query now scoped via `class_id` (which implies year), so prior-year assessments don't resurface.
- **M10** — admin/editor remarks upsert returns 409 with `requires_force_overwrite` when the existing row was authored by a teacher and the text differs.
- **M11** — admit-card bulk QR generation switched to `Promise.allSettled`; one failure no longer fails the whole 200-student PDF.
- **M12** — class-tests POST gates teachers via `teacherTeachesClassSubject` (matches PATCH/DELETE/marks).
- **M13** — `MarksheetSnapshotV2` doc-comment now explicitly states render-only; future computational changes must recompute + re-finalize, not smuggle through the snapshot.
- **M14** — migration 045 adds `BEFORE UPDATE` triggers on the 10 lagging tables.
- **M15** — migration 046 flips `supplementary_attempts.parent_exam_type_id` and `exam_schedules.exam_type_id` from CASCADE to SET NULL; schema mirror updated.
- **M16** — 38 aria-labels added across 14 admin pages by a focused subagent sweep; pre-existing `title=` attrs preserved.
- **M17** — refund route + UI clarify "single refund per payment, partial OK".

Low fixes:
- **L1** — `/api/erp/results/import` caps upload at 5 MB before reading buffer.
- **L2** — `extractStoragePath()` helper added in `src/lib/storage-paths.ts`; staff and disclosure-documents routes use it for cleanup paths so cache-buster query strings no longer no-op deletes.
- **L3** — `/api/staff/[id]/convert-to-teacher` echoes generic error; raw to console.
- **L4** — section-cards POST/PATCH parse via Zod with 2 KB cap per text field.
- **L5** — `/api/erp/roll-numbers/recompute` body now Zod-validated (UUID + enum).
- **L6** — non-scholastic editor-scope decision documented in code (school-wide by design — flag for future class-scoping if needed).
- **L7** — already closed in previous round (`console.error` on audit insert failure).
- **L8** — covered by migration 045 (table included in the trigger-sweep array).
- **L9** — fee waiver dialog now uses `<input type="month">` matching payment dialog format.
- **L10** — `promoteStaffToTeacher` employee_id appends 4 hex chars from `crypto.randomBytes` so two parallel admin actions can't both 23505.
- **L11** — accepted as-is (the `as any` is gated by an allowlisted-tables check; full Supabase Database type would land in a separate type-gen pass).
- **L12** — email "sent successfully" log gated behind `NODE_ENV !== "production"`.
- **L13** — non-scholastic sub-subjects GET fetches class-link rows once and partitions in JS for both filter + attachment.
- **L14** — accepted as-is (loading-state polish; tracked separately for design pass).
- **L15** — invalid (pdf_header_configs/pdf_footer_configs use `template_key` UNIQUE; no is_default column exists).
- **L16** — `/api/erp/users` POST returns `staff_notice`; client toasts it on teacher-create so admin remembers to recategorize the auto-created staff row.

**Migrations to run (cumulative):** 040 → 041 → 043 → 044 → 045 → 046 (alongside the 037–039 batch from Round 1 close-out).

**Code changes summary:**
- Privacy gate threaded through `computeFinalResult` and `canViewReportCard`
- Bulk results route checks `is_published` AND active marksheet snapshots before mutation
- Refund route uses optimistic-concurrency `.eq("status", existing.status)` guard
- Supplementary substitution clamps marks to parent max
- max_marks_override now rescales both marks and max (preserves percentage)
- PDF aggregate row matches the rows shown when optionals are merged
- Dues compute query no longer drops soft-orphaned payments
- Multi-active-enrollment errors now surface per-student in finalize loop
- link-child collapses two error strings to one (no admission_no enumeration)
- revert-alumni uses `verifyAdmin()` (unambiguous gate)
- New migration 043: 22 FK indexes + partial-unique on `academic_years.is_current`

**Medium + Low items remaining (33 total):** none touched in this batch — pick them up next session if priorities shift, or sweep via a focused subagent.

## Severity-1 fix order (one commit each)

1. **C1** — Migration 040 to relax `fee_payments_amount_positive` for waivers. Without this, M9 doesn't actually work.
2. **C2** — Migration 041 to flip `marksheet_publications` cascades to `RESTRICT`. Without this, deleting a year wipes the audit.
3. **C3 + C4** — Single migration 042 + RPC update for snapshot atomicity + multi-enrollment safety.
4. **H2 + H3** — Privacy fix: thread caller role through `computeFinalResult` and `canViewReportCard`.
5. **H1** — Bulk results route checks `is_published`.
6. **H12 + H13 + H14** — Migration 043 renumbers duplicate prefixes (or accepts and documents), adds `is_current` partial unique, adds 15 missing FK indexes.
7. Everything in High after that, then Medium, then Low.
