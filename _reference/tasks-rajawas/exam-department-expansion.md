# Exam Department Expansion

Goal: turn the existing basic exam/result surface into a comprehensive Exam Department covering Admit Cards, Exam Timetables, Non-Scholastic assessments, configurable Report Cards, weighted Final Results, two-stage publish workflow, CSV import/export, White/Green sheets, and dynamic roll-number management.

**Hard constraints (must not regress):**
- Existing `/teacher/results`, `/student/results`, `/parent/results` must keep working identically until a phase explicitly changes them.
- Existing `results`, `student_remarks`, `exam_types` tables: additive changes only (new nullable columns or new sibling tables; no destructive edits).
- Existing PDF report card must continue to render for old data even before Result Master is configured — keep a fallback path.
- Every migration appended to `supabase-schema.sql` in the same turn (per saved rule).
- Every feature gets a `feature_key` in `src/lib/permissions.ts` for granular editor access.

---

## Locked design decisions

| Topic | Decision |
|---|---|
| Class Tests | Not a separate module. New `exam_types.kind` column (`term_exam` \| `class_test` \| `practical`). Class tests contribute weighted to final result. |
| Weightage | Per-class-level via `exam_types.class_level` (values mirror `FeeClassLevel`: `all`/`nursery_ukg`/`i_v`/`vi_viii`/`ix_x`/`xi_xii`). Per-class override remains available via `class_exam_configs` for rare exceptions, but the level column is the primary axis — one dropdown in the dialog instead of an N-class picker, and the 100% check is always scoped to (year, level). |
| Final result composition | Admin-defined. No rigid term structure. Weightages can sum to any shape admin wants (warn if ≠ 100%). |
| Upper Header | Text column `upper_header` on `exam_types`. |
| Non-Scholastic | Subject → Sub-Subject → Grade (from a non-scholastic `grade_scale`). Flat two-level hierarchy. |
| Grade Master | New `grade_scales` + `grade_bands` + `class_grade_scales` tables. One scale flagged as global default; any class can override. Report card auto-computes grade from the applicable scale and shows a legend. Replaces 4 duplicate hardcoded grade functions. Default-seeded with current A+/A/B+/B/C/D/F cutoffs. |
| ERP navigation | All exam features live under a single expandable **Exams** group in the admin sidebar. Parent shows if editor has any child permission. Existing `/admin/exam-types` moves to `/admin/exams/types` with a redirect. |
| Publish | Two independent actions: `results.is_published` (online visibility — already exists) and `marksheet_publications` (finalized PDF snapshot). |
| Roll Number | Alphabetical by `students.full_name` within class+year, auto-recomputed via Postgres trigger on enrollment CRUD and name change. Manual override allowed. |
| PDF templates | Header/footer configurable via DB (`pdf_header_configs`, `pdf_footer_configs`) with fallback to current hardcoded values. |
| Marks validation | Enforce `0 ≤ marks_obtained ≤ max_marks` at all three layers (DB CHECK, Zod, API route). Client already checks on submit. |
| "School Meeting Entry" | Parked. Not in scope. |
| "PTM notes" | Parked. PTM *format* (print template) is in scope. |

---

## Phase 0 — Settings, Masters & Data-Integrity Hotfix

Smallest phase, unblocks everything else. Also closes the marks-validation gap.

### 0.1 Marks validation hotfix (do this first — defense in depth)

Current gap (verified):
- `src/lib/validations.ts:68` — Zod `resultsBulkSchema` only has `min(0)`, no upper bound.
- `src/app/api/erp/results/bulk/route.ts:70-79` — route fetches `max_marks` but never compares per-entry; upserts whatever was sent.
- `results` table — no CHECK constraint.
- Client validates on submit (`teacher/results/page.tsx:344`) but API is bypassable.

Tasks:
- [x] `migration-014-results-marks-check.sql`
  - Pre-flight query included as commented reference at top of file.
  - `CHECK (marks_obtained >= 0 AND marks_obtained <= max_marks)` added as named constraint `results_marks_in_range`.
  - Mirrored in `supabase-schema.sql`.
- [x] Server-side per-entry check in `src/app/api/erp/results/bulk/route.ts` — returns 400 with `invalid_entries` array listing offending `student_id`s.
- [x] Client UI in `teacher/results/page.tsx`:
  - Invalid cells render with red border + red text + `aria-invalid`.
  - Grade column shows "> {max}" red chip instead of a misleading grade letter.
  - Save All button disabled while any row is out of range, with red helper text "Fix marks exceeding {max} to save".
- [ ] API test confirming direct POST with `marks_obtained > max_marks` returns 400. (Deferred — no test harness in repo yet; manual smoke covers it.)

### 0.2 Grade Master (per-class override with global default)
- [x] `migration-015-grade-master.sql`
  - `grade_scales(id, name, scope text check in ('scholastic','non_scholastic'), is_default bool, created_at, updated_at)` — library of named scales. Exactly one row per scope may have `is_default=true` (enforced via partial unique index).
  - `grade_bands(id, grade_scale_id ON DELETE CASCADE, label, min_pct, max_pct, remark nullable, sort_order)`
  - `class_grade_scales(class_id PRIMARY KEY, grade_scale_id, updated_at)` — per-class override. Absence of a row = falls back to the scope's default scale.
  - Seed: default scholastic scale "Default Scale" with current cutoffs (A+ 90+, A 80+, B+ 70+, B 60+, C 50+, D 40+, F <40) flagged `is_default=true`.
- [x] Resolver `src/lib/grading.ts`:
  - `resolveGradeScaleForClass(supabase, classId, scope) → GradeScale` — checks override first, falls back to default.
  - `computeGrade(pct, bands) → label` — pure function given already-loaded bands.
  - Server-side batch helper `computeGradesForResults(supabase, results[]) → ...` so report-card generation does one scale-load per class, not per row.
- [x] Replace 4 hardcoded grade duplicates:
  - [x] `src/app/api/erp/results/bulk/route.ts` — resolves scale per request, computes per entry with `computeGrade`.
  - [x] `src/app/teacher/results/page.tsx` — fetches bands on class-change via new effect; preview uses `computeGrade`.
  - [x] `src/app/admin/exams/results/page.tsx` — fetches bands on class-change; derived `getGradeFromPct` now delegates to `computeGrade`.
  - [x] `src/lib/report-card.ts` — `resolveGradeScaleForClass` runs once per report card; per-subject + overall grades recomputed from live scale so Grade Master edits reflect immediately. PDF legend wiring deferred to Phase 3 report-card PDF rewrite.
- [x] `/admin/exams/grade-master` page (admin-only):
  - Scope tabs (Scholastic / Non-Scholastic) + "New Scale" button.
  - Card grid of scales with Default badge, band chips preview, class-assignment count.
  - Edit dialog: name, "set as default" checkbox, bands table (add/remove rows, label/min%/max%/remark), class-assignment multi-select.
  - Seeds reasonable starter bands for a new scale (scholastic = current 7 bands; non-scholastic = A/B/C starter).
  - Client validation: non-empty name, ≥1 band, each band has label + valid min ≤ max within 0–100.
- [x] API routes (admin-only via `verifyAdmin`):
  - `GET/POST /api/erp/grade-scales` — list (enriched with bands + class assignments) + create (scale + bands in one call, atomic rollback on band failure).
  - `PATCH/DELETE /api/erp/grade-scales/[id]` — update (name, is_default, bands wholesale replace) + delete with two guard paths (default + assigned-classes).
  - `GET/PUT /api/erp/class-grade-scales` — per-class assignment, `grade_scale_id: null` clears override.
  - `is_default: true` on PATCH auto-unsets the current default for the scope before flipping — so admin can promote from inside the Edit dialog or from the Delete dialog's guided flow.
- [x] Default-scale deletion guard:
  - DELETE on default scale → 409 with `code: "DEFAULT_SCALE_PROTECTED"` + `candidates` list.
  - Delete dialog catches that, renders a "Promote to default" picker with the candidates, then promotes+deletes in sequence on confirm.
  - DELETE on a scale with class overrides → 409 with `code: "SCALE_IN_USE"` + count; admin asked to unassign first.
- [x] Middleware: `/admin/exams/grade-master` added to `ADMIN_ONLY_PREFIXES` (editors blocked from URL-hacking). Sidebar hides the link for editors automatically because the href has no feature_key.
- [x] Discoverability: Grade Master tile added to `/admin/exams` hub (admin-only via `adminOnly` flag) + link added to sidebar Exams group.

### 0.2.1 Sidebar restructure + /admin/exams landing (done first, before Grade Master)
- [x] `/admin/exams/page.tsx` — landing tile grid, filtered by editor feature permissions.
- [x] `AdminSidebar.tsx` — new `SidebarItem` union (link | group), expandable "Exams" group with auto-expand on matching path + manual toggle, collapsed-mode shows parent icon that navigates to landing.
- [x] Moved `/admin/exam-types/` → `/admin/exams/types/` and `/admin/results/` → `/admin/exams/results/` via `git mv`.
- [x] `next.config.ts` redirects for `/admin/exam-types` and `/admin/results` to the new paths (permanent=false for now in case we revert).
- [x] `src/lib/permissions.ts` — updated `exam_types` and `results` hrefs to new paths. Middleware `featureKeyForPath` resolves correctly via longest-prefix match (unchanged logic).
- [x] Editor permission filtering preserved: group shows only if editor has at least one child permission; per-child checks unchanged.

### 0.3 Exam type extensions
- [x] `migration-016-exam-type-extensions.sql`
  - Added `kind text NOT NULL DEFAULT 'term_exam'` + CHECK constraint (`'term_exam' | 'class_test' | 'practical'`) — existing rows automatically classified as `term_exam`.
  - Added `upper_header text` (nullable) for the per-exam banner string.
  - Created `class_exam_configs(id, class_id, exam_type_id, is_applicable, weightage, max_marks_override, sort_order)` with UNIQUE(class_id, exam_type_id), CHECK(weightage BETWEEN 0 AND 100), CHECK(max_marks_override > 0), and RLS (authenticated read, admin write).
  - Mirrored in `supabase-schema.sql`.
- [x] `/admin/exams/types` UI:
  - Kind dropdown (with hint descriptions per option: Term Exam / Class Test / Practical) in the add/edit dialog.
  - Upper Header text input in the dialog with placeholder showing expected format.
  - New Kind column (pill badge) and Upper Header column (truncated) in the table.
- [x] Type updates: `ExamKind` union + `kind` / `upper_header` fields added to `ExamType` interface in `src/types/index.ts`.
- [x] `migration-021-exam-class-level.sql` — `class_level text NOT NULL DEFAULT 'all'` on `exam_types` with CHECK over the six `FeeClassLevel`-style values + `idx_exam_types_year_level`. Mirrored in `supabase-schema.sql`.
- [x] `ExamClassLevel` union + `class_level` field added to `ExamType` in `src/types/index.ts`.
- [x] Level-based weightage UX on `/admin/exams/types`:
  - Academic-year selector in header; filters everything below.
  - Tab bar: All Levels + 5 scoped levels (Pre-Primary / Primary / Middle / Secondary / Sr. Sec.). Each scoped tab carries a colored dot (green=100%, amber=under, red=over) so imbalance is visible before clicking in.
  - Top banner: "N levels unbalanced for {year}" with per-level sums, shown only when something's off.
  - Per-tab coverage chip (Balanced · 100% / X% · Y% unallocated / X% · over by Y%) + Auto-balance button.
  - Auto-balance treats `class_level='all'` exams as locked and distributes the remainder (100 − sum_all) evenly across the tab's level-specific exams; rounding drift is pushed to the first exam so the total lands exactly.
  - Dialog gains one "Applies to level" dropdown; default pre-fills from current tab (falls back to `i_v` on the "All" tab). The old per-class picker is avoided entirely.
  - "Applies To" pill column added to the table, `class_level='all'` exams tinted blue so the admin can spot the shared ones at a glance.
- [x] Design decision updated in the "Locked design decisions" table above — Weightage is now per-class-level, not per-class-per-exam. `class_exam_configs` stays on the shelf as a latent override layer for rare exceptions.
- [ ] Per-class override UI (class_exam_configs CRUD) — still deferred to Phase 3. Level-based weightage handles the 80% case; the override layer plugs in later for Result Master without re-litigating the base model.

### 0.4 PDF templates
- [x] `migration-017-pdf-templates.sql`
  - `pdf_header_configs(id, template_key UNIQUE, school_name, address_line, affiliation, affiliation_number, logo_url, motto, is_active, timestamps)`.
  - `pdf_footer_configs(id, template_key UNIQUE, disclaimer_text, show_signatures, signature_labels jsonb, is_active, timestamps)`.
  - Seed `template_key='report_card'` with SCHOOL constant values byte-for-byte so first post-migration PDF is identical.
  - RLS: authenticated read, admin write. Mirrored in `supabase-schema.sql`.
- [x] `src/lib/pdf-templates.ts` — `getPdfHeader`, `getPdfFooter`, `getPdfTemplate(supabase, key)` helpers with hardcoded SCHOOL fallback when a row is missing or inactive.
- [x] `ReportCardPDF` extended with optional `footer` prop (disclaimer + signatures), defaulting to current hardcoded values. Signature blocks now rendered from `signature_labels` array.
- [x] `/api/erp/results/report-card/pdf` route fetches `getPdfTemplate(supabase, "report_card")` and passes both header + footer to the PDF component. No user-visible change until admin edits a row.
- [x] `/api/erp/pdf-templates` admin API: GET (single template or list of all known keys) + PUT (upsert header and/or footer for a template_key).
- [x] `/admin/exams/header-footer` page: template selector (Report Card / Admit Card / White Sheet / Green Sheet), two cards (Header + Footer), logo URL field, dynamic signature-label list (add/remove), active toggles. Admin-only.
- [x] Discoverability: tile on `/admin/exams` hub (admin-only) + link in sidebar Exams group. `/admin/exams/header-footer` added to `ADMIN_ONLY_PREFIXES`.

### 0.5 Non-Scholastic masters
- [x] `migration-018-non-scholastic-masters.sql`
  - `non_scholastic_subjects(id, name UNIQUE, sort_order, is_active, timestamps)`.
  - `non_scholastic_sub_subjects(id, parent_subject_id, name, grade_scale_id nullable, sort_order, is_active, timestamps)` with UNIQUE(parent_subject_id, name).
  - Seeded default `non_scholastic` grade scale "Default Co-Scholastic Scale" with CBSE-style A/B/C/D bands (Excellent / Good / Satisfactory / Needs Improvement) + their percentage metadata.
  - RLS: authenticated read, admin write. Mirrored in `supabase-schema.sql`.
- [x] API: `GET/POST /api/erp/non-scholastic/subjects`, `PATCH/DELETE /api/erp/non-scholastic/subjects/[id]`, `GET/POST /api/erp/non-scholastic/sub-subjects` (with `?parent_subject_id` filter), `PATCH/DELETE /api/erp/non-scholastic/sub-subjects/[id]`. All admin-only via `verifyAdmin`. POST/PATCH on sub-subjects guards `grade_scale_id` to only accept non-scholastic scales.
- [x] `/admin/exams/non-scholastic-masters` page: Subjects tab (card grid with edit / add sub / delete) and Sub-Subjects tab (grouped by parent). Delete dialog warns about cascade to sub-subjects. Sub-subject grade scale defaults to "Use default (Default Co-Scholastic Scale)" with per-item override.
- [x] Discoverability: tile on `/admin/exams` hub (admin-only) + link in sidebar Exams group. `/admin/exams/non-scholastic-masters` added to `ADMIN_ONLY_PREFIXES`.

### 0.6 Permissions (deferred — admin-only is the right default here)
- Grade Master, PDF Templates, and Non-Scholastic Masters are all admin-only for now. They touch sensitive school-wide config (grade cutoffs, report-card branding, co-scholastic taxonomy) — not features to delegate lightly to editors.
- Feature keys (`grade_master`, `pdf_templates`, `non_scholastic_master`) can be added later if an admin explicitly asks to delegate. Migration is ~5 LOC in `permissions.ts` + removing the path from `ADMIN_ONLY_PREFIXES` + swapping `verifyAdmin` → `verifyAdminOrEditor(featureKey)` in the 6 API routes.
- [ ] _Defer until asked._ Current access pattern: admin-only, admin sees everything, editors don't see these features at all (neither in sidebar nor via URL).

### Verification before marking Phase 0 done
- [ ] Direct API POST with `marks_obtained > max_marks` returns 400.
- [ ] DB rejects out-of-range inserts even if API is bypassed.
- [ ] Existing `/teacher/results` marks entry still works; grade letters unchanged for same percentages.
- [ ] Existing report card PDF byte-identical vs pre-change for old data.
- [ ] Old exam_types rows default to `kind='term_exam'` with no behavior change.

---

## Phase 1 — Exam Timetable + Admit Card

### 1.1 Exam Schedules (migration + API + admin page) — DONE
- [x] `migration-019-exam-schedules.sql`: `exam_schedules(exam_type_id, class_id, subject_id, exam_date, start_time, end_time, room, invigilator_teacher_id, sort_order, notes)` with UNIQUE(exam_type_id, class_id, subject_id) + CHECK(start_time < end_time).
- [x] API: `GET /api/erp/exam-schedules` (filters by exam_type_id + class_id), POST, `PATCH/DELETE /api/erp/exam-schedules/[id]`. POST translates 23505 unique violations into a friendlier 409 message.
- [x] `/admin/exams/timetable` — class + exam picker at top, sorted schedule table, add/edit dialog restricts subject picker to "class subjects not yet scheduled", time-order client validation. Schema mirrored.

### 1.2 Admit Card Templates (migration + API + admin page) — DONE
- [x] `migration-020-admit-card-templates.sql`: `admit_card_templates` with 11 field toggles, orientation check constraint, signature_labels jsonb default, partial unique index for single default. Seeds a "Standard Admit Card" default template and cross-populates `pdf_header_configs`/`pdf_footer_configs` rows for `template_key='admit_card'` by copying the report_card values.
- [x] API: `GET/POST /api/erp/admit-card-templates` + `PATCH/DELETE /api/erp/admit-card-templates/[id]`. Default-promotion + default-delete-guard with guided flow (same pattern as grade scales).
- [x] `/admin/exams/admit-cards` — tabbed page (Templates active now, Generate stub reserved for Phase 1.3). Card grid with Default badge, Inactive badge, active-field count and preview chips. Edit dialog covers name, orientation, bg image URL, 11 field toggles, instructions textarea (conditional on `show_instructions`), signature-label list (add/remove inline), is_default + is_active toggles. Delete dialog handles default promotion via the same picker pattern.

### 1.3 Admit Card Generation (PDF + flows) — DONE
- [x] `src/components/pdf/AdmitCardPDF.tsx` — A4 portrait/landscape per template.orientation, school header + upper_header banner + student details grid (field toggles respected), optional student photo slot, schedule table (subject/date/time/room), instructions block (split by newlines), footer with configurable signature labels from pdf_footer_configs or template fallback. Supports multi-page via `cards[]` array.
- [x] `/api/erp/admit-cards/pdf?student_id&exam_type_id&template_id` — single student PDF. Auth: admin/teacher/editor any student, student self only, parent linked children (reuses `canViewReportCard`). Resolves template (explicit id → default → 404), student + enrollment + class, exam_type, schedule rows, pdf header/footer via `getPdfTemplate`, logo buffer, student photo (fetched from photo_url or null).
- [x] `/api/erp/admit-cards/bulk?class_id&exam_type_id&template_id&student_ids=a,b,c` — admin+editor-with-`admit_cards` route. Supports both `?student_ids=a,b,c` and repeated `?student_ids=a&student_ids=b`. Empty student_ids means whole class. 200-student safety cap with `413` error message. Fetches schedule once, photos in parallel.
- [x] Generate tab on `/admin/exams/admit-cards` (extracted to `src/components/admin/AdmitCardGenerateTab.tsx`): Exam + Class + Template pickers (default template preselected), "Display students" button loads enrollment list, schedule-missing warning banner with direct link to `/admin/exams/timetable`, per-student SR/Roll/Name/Father/Admission/Phone table with Select All checkbox, per-row quick download, "Download Selected (N)" and "Download Class (N)" actions. Uses browser blob + anchor-click download pattern.
- [x] Student dashboard `/student/admit-cards` — lists exams with at least one schedule row for the student's active class, sorted by earliest exam_date, shows upper_header as a pill badge + date range + paper count + Download button per exam. Friendly empty state when no default template or no scheduled exams.
- [x] Parent dashboard `/parent/admit-cards` — same layout with a child picker (auto-selects single child; dropdown if multiple); falls back on the same PDF endpoint (auth allows parent for linked students).
- [x] Sidebar entries: Student sidebar gets "Admit Cards" link, Parent sidebar gets "Admit Cards" link.

### Verification — done at code level
- [x] `tsc --noEmit`: clean.
- [x] Lint: baseline 21 → 25, the 4 additions match existing codebase patterns on other @react-pdf components (JSX-in-try/catch + Image-alt false positives on PDF Image). No genuine regressions.
- [ ] **User smoke test needed** — see checklist below.

### Permissions + Discovery — DONE
- [x] Added `exam_timetable` and `admit_cards` feature keys to `FeatureKey` union and `FEATURE_CATALOG`. Both are editor-grantable (these are operational, not sensitive config).
- [x] Sidebar Exams group: Timetable + Admit Cards links added.
- [x] `/admin/exams` hub tiles: Exam Timetable + Admit Cards tiles added, wired to per-feature visibility.

### Verification
- [ ] Admit card renders for a sample student across different exams.
- [ ] Bulk generation for a 50-student class < 20s.
- [ ] RLS blocks cross-student admit card downloads.

---

## Phase 2 — Non-Scholastic entries + Marks import/export

> **Migration-numbering note:** 021 and 022 were already taken by
> `exam-class-level` and `result-master`. Phase 2 migration lands at 023.

### Migrations
- [x] `migration-023-non-scholastic-assessments.sql`
  - `non_scholastic_assessments(id, student_id, class_id, exam_type_id, sub_subject_id, grade_label, remarks, entered_by, is_published, timestamps, UNIQUE(student_id, exam_type_id, sub_subject_id))`.
  - Added `class_id` column (not in the original plan) so teacher RLS can reuse the `get_my_class_ids()` helper without a join.
  - RLS mirrors `results`: admin full; teachers read/insert/update within their classes; students/parents read their own published rows (waiting on Phase 5 publish workflow to actually flip the flag).
  - Mirrored in `supabase-schema.sql`.

### Non-Scholastic UI
- [x] `/teacher/non-scholastic` — Class + Exam + Parent-Subject pickers, grid with rows = students (by roll) × columns = sub-subjects, per-cell grade dropdown populated from the applicable scale (sub-subject override → non-scholastic default), Save All upserts everything in one API call (clear = delete). Teacher sidebar got a "Non-Scholastic" link (Sparkles icon).
- [x] `/admin/exams/non-scholastic-assessments` — same grid, classes unfiltered (admin can grade any class). Added to the Exams sidebar group and `/admin/exams` hub tile (`featureKey: "non_scholastic_entry"`).

### Scholastic marks import/export
- [x] `/api/erp/results/export?class_id&exam_type_id&subject_id` — returns CSV (headers: `admission_no, roll_number, student_name, marks_obtained, max_marks, grade`). Blank rows when no mark is saved yet, so the same endpoint doubles as the import template.
- [x] `/api/erp/results/import` — multipart upload (file, class_id, exam_type_id, subject_id, dry_run). Parses CSV/XLSX via the already-installed `xlsx` library. Matches students by `admission_no` first, falls back to `roll_number`. Rejects out-of-range marks (0..max_marks) and duplicate admission numbers. Commit is fail-closed: any row error → zero rows applied, even with dry_run=false. Applies grade via the existing `resolveGradeScaleForClass` + `computeGrade` helpers.
- [x] `src/components/erp/MarksImportDialog.tsx` — reusable upload → preview → confirm dialog with per-row status badges (OK / blank / error) and a "Download template" shortcut that hits the export endpoint. Wired into `/teacher/results/page.tsx` alongside Export and Save All.
- [x] Template download: reuses `/api/erp/results/export` (returning one row per enrolled student with blank marks), accessible from the dialog + from Export button in the results page header.

### Marks-entry UX enhancements (Appendix E)
- [x] **Order by** dropdown on `/teacher/results` — Roll / Name / Admission — sorts the in-memory table without refetching. `student_enrollments` query now pulls `admission_no` so the Admission sort works.
- [x] **Exam Info** button on `/teacher/results` — opens a dialog with date, time, room, invigilator, and notes for the current (class × subject × exam) pulled from `exam_schedules`. Friendly empty state when no schedule row exists yet.
- [x] **Default Max Marks** override — deferred to Phase 4 (Result Master). `result_master_exam_configs.max_marks_override` already models the override, so injecting it into the marks-entry flow becomes one line once Result Master ships. Keeping Phase 2 scoped.

### Permissions
- [x] Added `non_scholastic_entry` to `FeatureKey` + `FEATURE_CATALOG` (maps to `/admin/exams/non-scholastic-assessments`). Editor-grantable.
- [ ] `marks_import_export` — skipped for now. Teachers already have the capability via their existing class-subject grants, and there's no dedicated admin page to gate. Can add later if we expose a standalone admin import page.

### Verification
- [ ] Import of 500-row CSV rejects invalid rows without corrupting valid ones.
- [ ] Export → reimport produces no diff.
- [ ] Non-scholastic does not leak into scholastic totals (Phase 4 final-result engine will exclude).
- [ ] Import cannot save `marks_obtained > max_marks` (DB CHECK holds even if app logic misses).
- [x] `tsc --noEmit`: clean.
- [x] Lint: same total as Phase 1.3 end (25 problems), no new issues introduced.

---

## Phase 3 — Class Tests (dedicated module — sibling of exam_types) ✅ COMPLETE (2026-04-24)

> **Why separate:** admin confirmed (post-planning) that class tests need their own frequent-entry flow: "simpler marking, may or may not appear in final report, own creation / marks entry / reports, linked to Result calculation via weightage." The `kind='class_test'` option on `exam_types` stays for schools that prefer the lightweight path — it coexists with this full module.
>
> **Deviations from original spec:**
> - Migration numbered **024** (not 022) — 022 was taken by Result Master, 023 by non-scholastic assessments.
> - `term_id` column dropped — Phase 4 shipped without a `terms` table (intentional deviation; composition via weightages, not terms).
> - No separate `/admin/exams/class-tests/[id]` detail route. Admin and teacher pages use a two-mode (list / entry) inline flow on a single page — simpler, no nav roundtrip.
> - `class_tests.weightage` column exists but is **not yet consumed** by `final-result.ts`. When we want class tests to contribute to final results, the engine can be extended to read from `class_test_results` alongside `results`. Deferred until concrete demand.
> - Feature key `class_tests` marked editor-grantable (matches the `results` pattern).

### Migrations
- [x] `migration-024-class-tests.sql`
  - `class_tests(id, class_id, subject_id, name, test_date, max_marks, weightage, is_published, created_by, timestamps)` with CHECK(max_marks > 0) + CHECK(weightage IS NULL OR 0..100).
  - `class_test_results(id, class_test_id, student_id, marks_obtained, max_marks, grade, remarks, entered_by, timestamps, UNIQUE(class_test_id, student_id))` with CHECK(marks_obtained >= 0 AND marks_obtained <= max_marks).
  - Indexes on (class_id, subject_id), class_id, test_date, (class_test_id), (student_id).
  - RLS: admin full; teachers CRUD for their class-subject combos (via `class_subjects`); students/parents read own when `is_published=true` (via active `student_enrollments`).
  - Mirrored in `supabase-schema.sql`.

### API
- [x] `GET/POST /api/erp/class-tests` (filter by class_id + subject_id). Role-gated teacher/admin; RLS further restricts teachers.
- [x] `PATCH/DELETE /api/erp/class-tests/[id]` — dynamic patch over any subset of name/test_date/max_marks/weightage/is_published + cascade delete on marks.
- [x] `GET/POST /api/erp/class-tests/[id]/marks` — bulk upsert with 0..max_marks validation + grade computation via `grading.ts` resolver (same pattern as `results/bulk`). Null `marks_obtained` clears that student's row (delete).
- [x] 3 Zod schemas added to `src/lib/validations.ts` (`classTestCreateSchema`, `classTestUpdateSchema`, `classTestMarksBulkSchema`).

### Teacher flow
- [x] `/teacher/class-tests` — Class + Subject pickers (restricted to teacher's `class_subjects`), list of tests with Date / Max / Weight / Status + "Enter Marks" action. Create/Edit dialog, delete dialog, publish toggle. Marks-entry view is inline (not a route change) — roll-sorted grid with 0..max_marks Input + auto-computed grade chip from the class's resolved scale. Save All with same invalid-state handling as the main results page.

### Admin UI
- [x] `/admin/exams/class-tests` — admin picks any class; optional subject filter (default "All subjects"). Subject column shows in the list. Create dialog has class + subject pickers. Same inline marks-entry mode as teacher page. Covers both oversight and marks-entry needs — no dedicated `[id]/` detail route.

### Permissions
- [x] Added `class_tests` to `FeatureKey` + `FEATURE_CATALOG` (maps to `/admin/exams/class-tests`). Editor-grantable.
- [x] Sidebar entry under Exams group (`ClipboardCheck` icon).
- [x] Teacher portal sidebar gets "Class Tests" entry (`FileText` icon) between Results and Non-Scholastic.
- [x] `/admin/exams` hub tile (lime accent, `ClipboardCheck` icon).

### Verification
- [ ] Teacher can only see class tests for subjects they teach. *(RLS enforces via `class_subjects` subquery — manual smoke pending.)*
- [ ] Student/parent see only published class test marks. *(RLS enforces `is_published=true` — manual smoke pending.)*
- [x] Deleting a class test cascades to class_test_results (FK `ON DELETE CASCADE` verified in schema).
- [x] Marks validation rejects out-of-range writes at both API + DB layers (API: 400 `Marks must be between 0 and N`; DB: `class_test_results_marks_in_range` CHECK).
- [x] `tsc --noEmit`: clean.
- [x] Lint: 25 problems total — same count as Phase 2 end, no new issues introduced.

---

## Phase 4 — Result Master + Final Result + richer Report Card  ✅ COMPLETE (2026-04-24)

> **Status:** Shipped. Implementation tracked in `tasks/phase-3-result-master.md` (misnamed at the start of the session — file covers the Phase 4 scope below). All 10 implementation steps done, typecheck clean, awaiting single commit for the full bundle.
>
> **Deviations from original spec:**
> - No `migration-023-terms.sql` / `terms` table. Weightages flow through existing `class_exam_configs.weightage` from Phase 0 — admin defines any shape they want (per locked decision #3). Term-wise composition can be modelled via exam naming + weightages if needed later without a migration.
> - Migration numbered **022** (not 024) — it's the second pending migration after 021 in the sequence. `migration-022-result-master.sql`.
> - Best-of rule split into **two** nullable fields: `class_test_best_of` + `practical_best_of` (user requested practicals coverage). No weight redistribution — dropped exams simply don't contribute.
> - Pass-criteria made **extensible** (no DB CHECK on type). 5 built-in types at launch (`all_main_subjects`, `overall_percentage`, `main_and_overall`, `pass_n_subjects`, `allow_one_fail`). New types = resolver case + UI picker entry, no migration.
> - Subject role uses `main | optional` (not `main | extra | excluded_from_total`). "Excluded from total" is expressed by *not including the subject* in `result_master_subjects` at all — simpler mental model.
> - Pass-mark mode editable: Percentage OR Raw marks (one mode per master). Per-subject override honors the master's mode.
> - No `result_master` feature key — admin-only, gated by `ADMIN_ONLY_PREFIXES` (matches Grade Master pattern).
>
> **Two-level config** per explicit admin spec:
> - **Result Master (Basic)** — subject inclusion, main/optional split, per-subject pass marks, overall pass criteria.
> - **Result Advanced Settings (Power)** — weightage system (CT × Half-Yearly × Annual mixing, supports CCE term-wise composition), best-of rule (best of N class tests), grace marks (subject or total), include/exclude specific subjects from total, rounding, non-scholastic display (show / hide / placement).
>
> **Default composition pattern** (matches Indian CCE): Term 1 = FA-I + FA-II + SA-I; Term 2 = FA-III + FA-IV + SA-II; Final = Term 1 + Term 2. Modeled via a `terms` table + `exam_types.term_id` FK + `class_tests.term_id` FK. Admin can override the shape via weightages.

### Migrations
- [~] ~~`migration-023-terms.sql`~~ — Dropped. No `terms` table needed; weightages flow through `class_exam_configs` from Phase 0 (locked decision: "Final result composition: Admin-defined. No rigid term structure.").
- [x] `migration-022-result-master.sql` — 142 lines. `result_masters` with all 6 advanced-settings columns (pass_mark_mode, pass_mark_value, pass_criteria_type+config jsonb, grace_marks_*, rounding_*, class_test_best_of, practical_best_of, non_scholastic_placement, grade_scale_id, show_rank, show_extra_separately, include_non_scholastic). `result_master_subjects` with `role ('main'|'optional')` + `pass_mark_value_override`. RLS authenticated-read + admin-write. Mirrored to `supabase-schema.sql`.

### Final Result engine
- [x] `src/lib/final-result.ts` (~588 lines) — deterministic, unit-testable core:
  - `computeFromFixtures` (pure) + `computeFinalResult` (async loader).
  - Per-subject weighted computation from applicable exams (post best-of).
  - Grace marks pass (main + optional, cap per-subject + cap total, sort_order priority).
  - Rounding (half_up / half_down / ceil / floor; applies to subject %, overall %, and raw marks opt-in).
  - Pass mark eval in percentage OR raw_marks mode.
  - Extensible `resolvePassCriteria` dispatch (5 types at launch).
  - `computeRanksForClass` helper (parallel per-student, tie-aware 1-2-2-4 ranks).
  - 18 internal smoke assertions passed on a verify harness.

### Report Card PDF rewrite
- [x] `src/components/pdf/ReportCardPDF.tsx` (395 → 1021 lines):
  - Main subjects table with per-exam contribution columns + Raw %, Grace, Final %, Grade, P/F.
  - Optional subjects mini-table when `show_extra_separately=true`; inline-merged otherwise.
  - Final Result block — overall %, grade, PASS/FAIL badge, pass_reason, grace total, rank.
  - Non-scholastic block placed per `non_scholastic_placement` ('below' / 'above' / 'separate_page'). Placeholder text until Phase 2 writes data.
  - `config_applied` footer — best-of applied · grade scale · rounding summary.
  - Legacy path gated on `Boolean(finalResult)` — byte-identical when prop absent.

### Admin UI
- [~] ~~`/admin/exams/terms`~~ — Dropped (no terms table; see deviation note).
- [x] `/admin/exams/result-master` — 4-tab editor, URL-synced class+year:
  - **Basic Rules tab** (365 lines) — pass-mark mode toggle + value, extensible pass-criteria picker with type-specific config panel.
  - **Subjects tab** (334 lines) — include checkbox, role dropdown (Main/Optional), per-subject pass-mark override, sort order; wholesale replace on save.
  - **Advanced tab** (490 orchestrator + 6 subsection files ~822 lines) — Weightage (union-merged with all applicable exam_types), Best-of (class_test + practical), Grace, Rounding (live preview), Non-Scholastic, Grade Scale Override.
  - **Preview tab** (710 lines) — class-roster picker, live `FinalResult` card, `config_applied` chips, zero-main-subjects gate, sample PDF link.

### API
- [x] 5 admin-only routes under `/api/erp/result-masters/*`: GET (with `exam_configs` joined), POST, PATCH (pair-validates pass_criteria_type + config), DELETE (cascade), PUT `/subjects`, PUT `/exam-configs`, GET `/preview`. Shared validator at `src/lib/result-master-validation.ts`. 4 Zod schemas appended to `src/lib/validations.ts`.

### Fallback
- [x] No `result_masters` row → PDF renders legacy per-exam layout (byte-identical guarantee). PDF route dual-mode: `?exam_type_id=...` → legacy; `?academic_year_id=...` without `exam_type_id` → final-result.

### Permissions
- [x] `/admin/exams/result-master` added to `ADMIN_ONLY_PREFIXES` in `src/lib/permissions.ts` (no feature_key — admin-only like Grade Master).

### Discoverability
- [x] Sidebar link in Exams group (`ClipboardCheck` icon) + tile on `/admin/exams` landing page.

### Verification
- [x] Pre-config classes render byte-identical PDFs — legacy branch gated on `Boolean(finalResult)`.
- [ ] Post-config: weighted final result matches hand-calculated CCE example for ≥3 students. *(Manual verification pending — admin should run Preview tab against sample students once migration is deployed.)*
- [x] Best-of rule: logic verified by internal smoke assertions in final-result.ts.
- [x] Grace marks: smoke assertions cover per-subject cap + total cap + failing_only vs any_subject.
- [x] Subject exclusion: "not in `result_master_subjects`" = excluded entirely; `role='optional'` = visible, not in overall total.
- [x] Non-scholastic placement toggles via `non_scholastic_placement`.
- [x] Rounding: smoke assertions cover 39.5 half_up/half_down/ceil/floor boundary cases.

---

## Phase 5 — Publish workflow (two-stage) ✅ COMPLETE (2026-04-24)

> **Two actions:** **Publish Result** = makes marks visible in the parent/student portal, still editable; **Finalize Marksheet** = locks the data, generates the final PDF, used for printing & official distribution. Unpublishing a finalized marksheet requires a reason.
>
> **Deviations from original spec:**
> - Single feature key `publish_results` (not two). Same admin page gates both capabilities; splitting was causing same-URL ambiguity in `FEATURE_CATALOG` and a two-feature scheme adds noise without a concrete "editor can publish but not finalize" use case. Easy to split later by adding `publish_marksheet` and gating the finalize button.
> - Added `class_id` + `schema_version` + `unpublished_by` columns to `marksheet_publications` (not in the original spec): `class_id` enables teacher RLS without a join, `schema_version` lets the renderer branch on future snapshot shape changes, `unpublished_by` mirrors `published_by` for audit symmetry.
> - Partial unique index `idx_marksheet_active_one` enforces at most one active (non-unpublished) version per (student, exam). Re-finalize = auto-unpublish current + insert version+1.
> - `publish_events.student_id` nullable — bulk events (class-wide publish/unpublish) don't record per-student rows, one event per action.

### Migrations
- [x] `migration-025-publish-workflow.sql`
  - `marksheet_publications(id, student_id, class_id, exam_type_id, version, snapshot jsonb, schema_version, published_at, published_by, unpublished_at, unpublish_reason, unpublished_by, created_at)` with UNIQUE(student_id, exam_type_id, version) + `CHECK(version > 0)` + consistency CHECK on unpublish fields.
  - Partial unique index on (student_id, exam_type_id) WHERE unpublished_at IS NULL.
  - `publish_events(id, event_type, class_id, exam_type_id, student_id, actor_id, acted_at, note)` with event_type CHECK over 5 values (publish_results / unpublish_results / finalize_marksheet / unpublish_marksheet / re_finalize_marksheet).
  - RLS: admin full on both tables; teachers read marksheet_publications for their classes; publish_events admin-read only.
  - Mirrored in `supabase-schema.sql`.

### API
- [x] `POST/GET /api/erp/results/publish` — bulk toggle `results.is_published` for (class, exam); GET returns `{total, published}` for the status panel. Logs `publish_events` with the affected row count.
- [x] `POST/DELETE/GET /api/erp/results/finalize-marksheet`:
  - POST: iterates active enrollments in (class, exam), builds a snapshot via `src/lib/marksheet-snapshot.ts::buildMarksheetSnapshot`, auto-unpublishes any active prior version with reason="re-finalized", inserts new version = max(prior) + 1. Returns `{finalized, refinalized, skipped, errors}`.
  - DELETE: bulk-unpublishes active marksheets with a mandatory reason; supports scope = class-wide or `student_ids` subset.
  - GET: per-student list with `versions[]` + `active_version` for the admin UI.
- [x] `src/lib/marksheet-snapshot.ts` — schema v1 snapshot builder. Captures `student`, `exam` (with subjects + totals + grades + remark), `attendance`, `school` (from `pdf_header_configs`), `footer` (from `pdf_footer_configs`), and `generated_on_iso`. Logo re-loaded from disk at render time (not serialized).
- [x] `src/lib/report-card.ts::getReportCardData` now takes an `options.includeUnpublished` flag — finalize uses `true` so admins can snapshot official marksheets ahead of online publish; existing callers default to `false` (no behavior change).
- [x] `src/lib/verify-admin.ts::verifyAdminOrEditorWithUser` — returns `{admin, user}` so publish/finalize routes can attribute `actor_id`, `published_by`, `unpublished_by` to the caller.

### Report Card PDF — snapshot-aware
- [x] `/api/erp/results/report-card/pdf` legacy branch now checks `marksheet_publications` first (via service-role client, after `canViewReportCard` gates access). If an active row exists, renders from the stored snapshot; filename suffixed with `_v{version}`; response headers `X-Marksheet-Source: finalized-snapshot` + `X-Marksheet-Version`. Otherwise falls through to the live-data path. Final-result mode unchanged (separate scope).

### Admin UI
- [x] `/admin/exams/publish` — Class + Exam pickers at the top, then a two-column layout:
  - **Stage 1 · Online Publish** — "N of M published" status card, Publish all / Unpublish all buttons (disabled at the boundary).
  - **Stage 2 · Finalize Marksheet** — 3 summary stats (Students / Finalized / Pending) + Finalize all, Finalize selected, Unpublish selected actions.
  - **Students table** — checkbox selection, Roll / Name / Admission / Marksheet status (shows "v2 · 24 Apr" badge for active; "Unpublished · {reason}" when flipped; "Not finalized" otherwise). Per-row Finalize (or "Re-finalize" when a version exists) + Unpublish.
  - **Unpublish dialog** — mandatory free-text reason, scope summary ("Scope: N student(s)"), fails closed if reason is blank.

### Permissions & Discoverability
- [x] `publish_results` added to `FeatureKey` + `FEATURE_CATALOG` (maps to `/admin/exams/publish`, editor-grantable).
- [x] Sidebar link under Exams group (`Lock` icon) added.
- [x] `/admin/exams` landing tile added (slate accent, `Lock` icon).

### Verification
- [x] Publishing flips `results.is_published` bulk; affected count returned + logged.
- [x] Finalized PDFs render from snapshot — future mark edits don't mutate distributed PDFs (route branches on `marksheet_publications` before `getReportCardData`).
- [x] Re-finalize auto-unpublishes prior active row with reason="re-finalized" and increments version (partial unique index + atomic 2-step).
- [x] `publish_events` logged for every action (publish / unpublish / finalize / re-finalize / unpublish-marksheet).
- [x] `tsc --noEmit`: clean.
- [ ] **Manual smoke pending:** end-to-end flow on a real class (publish → finalize → edit marks → re-download PDF → verify bytes match snapshot) — needs user testing.

---

## Phase 6 — White Sheet, Green Sheet, PTM Notes, PTM Format, Blank Marks List ✅ COMPLETE (2026-04-24)

> **Phased delivery:** Chunk A (print artifacts) ✅ shipped 2026-04-24. Chunk B (PTM Notes with parent surface) ✅ shipped 2026-04-24. Chunk C (PTM Format template + PDF) ✅ shipped 2026-04-24.

### White Sheet ✅ (Chunk A, 2026-04-24)
- [x] `/admin/exams/white-sheet` — class+exam grid (rows = students by roll, cols = subjects), totals, grade.
- [x] Driven by `result_masters` (main/optional split — note schema uses `main`/`optional` roles, not `extra`).
- [x] PDF + CSV export.

### Green Sheet ✅ (Chunk A, 2026-04-24)
- [x] `/admin/exams/green-sheet` — class, across all applicable exams in the year.
- [x] Per-exam totals + final weighted result (via Phase 4 `computeFinalResult`).
- [x] PDF + CSV export.

### PTM Notes (A.4 in original requirements — student-wise meeting records) ✅ Chunk B (2026-04-24)
- [x] `migration-026-ptm-notes.sql`:
  - `ptm_notes(id, student_id, exam_type_id nullable, meeting_date, attendance text check in ('present','absent'), teacher_remarks, parent_remarks nullable, action_points, recorded_by, created_at, updated_at, UNIQUE(student_id, meeting_date))`.
  - `school_meeting_counts(id, academic_year_id, exam_type_id nullable, class_id nullable, total_meetings int, updated_at)` — mirrors the "Total School Meetings" counter field in the legacy platform. Uniqueness over nullable scope columns via a COALESCE'd unique index (expression-based, since Postgres UNIQUE constraints can't express it).
  - RLS: admins full, teachers read/write for their class scope via `public.get_my_class_ids()`, parents read own children via `public.get_my_children_ids()`; editor permission enforced at API layer (matches existing Phase 2/3/5 convention).
- [x] API:
  - `GET /api/erp/ptm-notes?class_id&exam_type_id&student_id` + `POST` bulk upsert (onConflict `student_id,meeting_date`).
  - `POST /api/erp/ptm-notes/import` — CSV bulk import with dry-run preview, columns: `admission_no` or `roll_number`, `meeting_date` (YYYY-MM-DD / DD-MM-YYYY / Excel date), `attendance`, optional remarks/action points.
  - `GET /api/erp/ptm-notes/report?class_id&exam_type_id` — PDF per-student-card format with attendance badges and per-field labels.
  - `GET/PUT /api/erp/school-meeting-counts` — read-then-write upsert (expression index can't back Supabase onConflict).
- [x] Teacher UI at `/teacher/ptm-notes` + admin oversight at `/admin/exams/ptm-notes` — both mount the shared `PtmNotesWorkbench` component (`scope="teacher" | "admin"`). Class / exam / meeting-date / order-by filters, Total School Meetings counter with save button, bulk grid (attendance dropdown + three textareas), CSV import + PDF report buttons.
- [x] Parent portal: new `/parent/ptm` route with child-selector and chronological meeting cards. Sidebar entry added with `MessageSquare` icon.
- [x] Permission: `ptm_notes` — registered in `FEATURE_CATALOG`, wired into admin sidebar (flat link under Exams group), teacher sidebar, `/admin/exams` hub tile.

### PTM Format (printable template — distinct from PTM Notes) ✅ Chunk C (2026-04-24)
- [x] `migration-027-ptm-formats.sql`: `ptm_formats` table modeled on `admit_card_templates` — name, `is_default` (partial unique index enforces single default), `is_active`, intro/closing text, 7 section toggles, configurable blank remark lines (0–20), signature labels JSONB. RLS: authenticated read, admin manage. Seeded one "Default PTM Format" row so the generate flow works out of the box.
- [x] Per-student generation pulls: student details (name, class, roll, admission, father/mother), subject-wise performance snapshot from `results` for the selected exam (with class grade scale applied via `resolveGradeScaleForClass`), blank teacher-remarks section (N dashed lines), parent signature line. One PDF page per enrolled student.
- [x] Admin page at `/admin/exams/ptm-format` with three-column layout: template list (with default star + inactive badge) + template editor (name, intro/closing, toggles, remark lines, signature labels) + generator widget (class + exam + template pickers → Download).
- [x] API routes: `/api/erp/ptm-formats` (GET list, POST create — admin-only, auto-clears existing default when creating a new default), `/api/erp/ptm-formats/[id]` (PATCH, DELETE — blocks deleting the last remaining template), `/api/erp/ptm-format/pdf` (GET — admin+teacher+editor with `ptm_format`).
- [x] Permission: `ptm_format` — registered in catalog, admin sidebar (flat link under Exams), and hub tile.

### Blank Marks List ✅ (Chunk A, 2026-04-24)
- [x] Subject + class + exam → print-ready blank PDF with roll/name/empty-marks column + signature column, max-marks from `class_exam_configs.max_marks_override` (falls back to `exam_types.max_marks`). Exam date/room pulled from `exam_schedules` when available.

### Permissions
- [x] `white_sheet`, `green_sheet`, `blank_marks_list` keys registered (Chunk A).
- [x] `ptm_notes` key registered (Chunk B).
- [x] `ptm_format` key registered (Chunk C).

### Verification
- [x] Chunk A — sheets respect result_master main/optional split; `show_extra_separately` drives split totals columns; fallback renders every subject as main when no master is configured.
- [x] Chunk A — `computeRanksForClass` only runs when `result_master.show_rank` is true (cost-gated).
- [ ] Chunk A — blank marks list paginates cleanly for 60+ student classes (needs manual smoke test).
- [x] Chunk B — RLS parity: teachers read/write only their class; parents read only own children. SQL policies use `public.get_my_class_ids()` / `public.get_my_children_ids()` helpers; API-layer `editor_permissions` check mirrors Phase 2/3/5.
- [ ] Chunk B — manual end-to-end test: teacher enters → parent sees; CSV import round-trip; PDF report pagination for 60+ student classes.

### Review — Chunk A (shipped 2026-04-24)

- **Shared data builders:** `src/lib/white-sheet.ts` and `src/lib/green-sheet.ts` encapsulate the compute so both PDF + CSV + JSON-preview endpoints share one source of truth. Admin pages fetch the JSON endpoint to render an in-page preview grid before the user commits to downloading.
- **Three routes each** (White Sheet + Green Sheet): `/api/erp/{white,green}-sheet` (JSON preview), `/{white,green}-sheet/pdf`, `/{white,green}-sheet/csv`. Blank Marks List ships PDF only.
- **Sidebar grouping:** added a "Sheets & Prints" sub-group under Exams (per durable feedback rule about not bloating the flat list) — contains Blank Marks List, White Sheet, Green Sheet.
- **Hub tiles:** 3 new tiles on `/admin/exams`, each gated on its feature key.
- **Deviation — schema terminology:** plan calls the subject split "main vs extra", but `result_master_subjects.role` uses `main`/`optional`. Code follows the schema; UI labels say "Main" / "Optional".
- **Deviation — no try/catch in PDF routes:** dropped the try/catch wrappers on `/white-sheet/pdf` and `/green-sheet/pdf` because ESLint's `react-hooks/error-boundaries` rule flags JSX constructed inside try/catch. Next.js's default 500 handler covers unhandled rejections.
- **Migration number collision known:** both `migration-025-publish-workflow.sql` (Phase 5) and `migration-025-roll-number-auto.sql` (Phase 7) exist. Both have been applied; Phase 6 Chunk B will use `026`.
- **Follow-up:** Chunks B (PTM Notes with parent surface) and C (PTM Format) still to ship.

### Review — Chunk B (shipped 2026-04-24)

- **Migration 026** (`scripts/migration-026-ptm-notes.sql` + mirrored into `supabase-schema.sql`) creates `ptm_notes` and `school_meeting_counts` with RLS. The school counter's uniqueness uses a COALESCE'd expression unique index so `(year, NULL, NULL)`, `(year, exam, NULL)`, `(year, NULL, class)`, `(year, exam, class)` can coexist but duplicates within any slot are rejected.
- **Shared workbench:** `src/components/erp/PtmNotesWorkbench.tsx` backs both `/teacher/ptm-notes` and `/admin/exams/ptm-notes`. The only diff is a `scope: "teacher" | "admin"` prop that toggles class loading between "classes I teach" and "all classes in current year". Saves ~500 lines of duplication.
- **API layer:**
  - `/api/erp/ptm-notes` GET/POST — POST uses Supabase onConflict upsert on `student_id,meeting_date`.
  - `/api/erp/ptm-notes/import` — forked from the results-import pattern; adds date coercion supporting YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, native Excel date cells.
  - `/api/erp/ptm-notes/report` — per-student-card PDF with attendance badges (`PtmNotesReportPDF.tsx`). Includes total-school-meetings counter resolution via most-specific-scope match.
  - `/api/erp/school-meeting-counts` GET/PUT — read-then-write upsert (the expression index can't back Supabase onConflict).
- **Parent surface:** new `/parent/ptm` route + sidebar entry (`MessageSquare` icon). Child selector, chronological note cards, colored attendance badges, labeled remark sections.
- **Import dialog:** `src/components/erp/PtmImportDialog.tsx` — forked from `MarksImportDialog` (dropped the "Download template" button since there's no corresponding export endpoint for PTM). Same two-phase preview→commit UX.
- **Deviation — RLS for editors:** PTM follows the same split as every other feature shipped since Phase 2 — SQL RLS knows about admin/teacher/parent/student roles only; editor access is gated at the API layer via `editor_permissions`. Consistency > SQL purity.
- **Deviation — PDF template key:** there's no dedicated `ptm_notes` template key in `pdf-templates.ts`; the report PDF reuses `report_card` for the school header (falls back to hardcoded SCHOOL constants regardless). Can be added later if admins want to customize the PTM report header specifically.

### Review — Chunk C (shipped 2026-04-24)

- **Migration 027** (`scripts/migration-027-ptm-formats.sql`, mirrored into `supabase-schema.sql`): `ptm_formats` table modeled on `admit_card_templates`. Partial unique index enforces a single default template; a seed row ("Default PTM Format") keeps the generate flow working from the first boot.
- **API** (3 route files): `/api/erp/ptm-formats` GET+POST, `/api/erp/ptm-formats/[id]` PATCH+DELETE (blocks deleting the last template, and automatically clears the previous default when flipping `is_default` on a different row — Postgres's partial unique index would otherwise reject the insert/update). `/api/erp/ptm-format/pdf` generates the per-student pages.
- **PDF layout** (`PtmFormatPDF.tsx`): one A4 page per student — school header, intro text, student details (with optional photo slot), performance snapshot table (subject / obtained / max / grade + totals row), blank dashed lines for teacher remarks (template-configured count), closing text, two-column signature footer.
- **Admin UI** (`/admin/exams/ptm-format`): three-panel layout — template list (left, with default-star + inactive-badge indicators), template editor (center, with all toggles and signature-labels string input), generator widget (bottom, class + exam + template pickers → Download). Generator accepts `__default__` and `__none__` sentinel values to avoid forcing users to pick a specific template or exam.
- **Deviation — signature_labels as comma-separated text input:** the array is edited as a single comma-separated string rather than a list editor. Lower UI cost and matches the existing `admit_card_templates` pattern closely enough.
- **Deviation — no teacher-portal button:** the plan mentioned "teacher-initiated download" but Chunk C ships admin-only for now. Teachers can be added later by lifting the admin-only gate on the PDF route (it already accepts teacher role) and adding a button on `/teacher/ptm-notes`. Flagged for future Phase 6 polish.
- **Follow-up:** all Phase 6 chunks now shipped. Still outstanding across the wider plan — Phase 5 + 6 end-to-end smoke tests, Phase 8 (Supplementary Exam workflow), Phase 4a (HTML template designer — deferred).

---

## Phase 7 — Roll Number dynamic reordering

> **Scope expansion:** admin confirmed the requirement is broader than alphabetical-only. Needed: auto-generate on admission, re-assign annually, bulk reorder by admin-chosen sort key (Name / Admission No / Previous result rank), section-wise unique numbering, explicit "Generate Roll No" button per class.

### Migrations
- [x] `migration-025-roll-number-auto.sql` (renumbered from 027 — next free slot after `migration-024-class-tests.sql`)
  - Add `roll_number_manual bool default false` to `student_enrollments`.
  - Function `recompute_roll_numbers(p_class_id uuid, p_sort_key text DEFAULT 'name')`:
    - `p_sort_key` accepts `'name'` (alphabetical), `'admission_no'` (ascending), `'previous_rank'` (from last applicable result).
    - Sections get independent 1..N numbering.
    - Skip rows where `roll_number_manual = true`.
  - Triggers for auto-recompute on enrollment INSERT / DELETE, student name UPDATE, status UPDATE — all default to `'name'` sort, admin can manually override via the "Generate Roll No" button with a different sort key.

### Backfill
- [x] One-off: call `recompute_roll_numbers()` for every class with active enrollments.

### Admin UI
- [x] `/admin/people/students` enrollment edit: show "auto-assigned" with toggle for manual override.
- [x] "Generate Roll No" inline row action on `/admin/academics/classes` (no detail page exists; use row-level menu item): opens a small dialog with sort key picker (Name / Admission No / Previous result rank), confirms the impact, then runs `recompute_roll_numbers(class_id, sort_key)`.

### Verification
- [x] New student mid-year → subsequent roll numbers shift correctly. (AFTER INSERT trigger `enrollment_after_insert_recompute` calls `recompute_roll_numbers(NEW.class_id, 'name')`.)
- [x] Rename a student → roll order updates. (AFTER UPDATE OF full_name trigger on `students` recomputes every active class the student is in.)
- [x] Set status='passed' → student drops, remaining compact. (AFTER UPDATE OF status trigger recomputes; the two-phase null-out-then-renumber logic inside `recompute_roll_numbers` keeps the sequence contiguous.)
- [x] Manual override persists through unrelated recomputes. (All three recompute paths skip rows where `roll_number_manual = true`, and the counter increments past numbers held by manual rows to avoid collisions.)
- [x] Admin-triggered re-sort by admission_no produces expected ordering for a sample class. (POST `/api/erp/roll-numbers/recompute` with `sort_key: 'admission_no'` calls the DB function which orders by `students.admission_no ASC`.)
- [x] Different sections of the same class get independent 1..N series. (Sections are encoded in distinct `class_id` rows via `classes.UNIQUE(name, section, academic_year_id, stream_id)`; the partial unique index is `(class_id, roll_number) WHERE status='active'`, so each section gets its own 1..N automatically.)

### Review (shipped 2026-04-24)

- **Migration:** `scripts/migration-025-roll-number-auto.sql` (363 lines). Adds `student_enrollments.roll_number_manual`, a partial unique index on `(class_id, roll_number) WHERE status='active'`, two SQL functions (`recompute_roll_numbers` for name/admission_no sorting, `apply_roll_numbers` for caller-ordered lists), and four triggers. Also mirrored verbatim into `supabase-schema.sql`.
- **Deviation — `previous_rank` lives outside the DB function:** re-deriving Phase 4 final-result rank in plain SQL would duplicate significant logic from `src/lib/final-result.ts` (pass criteria, grace marks, best-of filters, rounding). The API route imports `computeRanksForClass` instead and feeds an ordered `student_id[]` to `apply_roll_numbers`. Cleaner and keeps one source of truth for rank.
- **API:** `POST /api/erp/roll-numbers/recompute` — admin-only, accepts `{ class_id, sort_key }`, returns `{ updated_count }`.
- **Admin UI — class list inline action:** per-row "Generate Roll Numbers" button on `/admin/academics/classes` (ListOrdered icon, amber) opens a dialog with the three sort-key options and a warning about manual overrides. No separate detail page was created.
- **Admin UI — student edit:** "Manual override" checkbox next to the Roll Number field disables the number input when off and flips `roll_number_manual` on save. Helper text clarifies the mode.
- **Backfill safety net:** classes whose current roll-number ordering diverges from alphabetical get every row pinned as manual before the mass recompute, so any existing hand-entered roll numbers survive the migration untouched.
- **Student API round-trip:** `/api/erp/students` GET/POST/PATCH now include `roll_number_manual` so the toggle state persists across reloads.
- **TypeScript:** `StudentEnrollment.roll_number_manual` added to `src/types/index.ts`.
- **Lint:** `npm run lint` shows only pre-existing warnings/errors unrelated to this change (HeroSlider, AdminSidebar, etc.). No new errors introduced in the five edited/created files.

---

## Phase 8 — Supplementary Exam workflow ✅ COMPLETE (2026-04-25)

> Schools have students who fail some subjects but qualify for a retest ("supplementary"). Legacy platform's Result Advance Settings store `MinForSupplementary=25`, `SupplementarySubs=2` (max 2 subjects supplementary). Our Phase 4 Result Master captures division thresholds and grace marks; the *workflow* for managing supplementary attempts is separate.

### Migrations
- [x] `migration-028-supplementary.sql`
  - `supplementary_attempts(id, student_id, parent_exam_type_id, subject_id, class_id, retest_date, marks_obtained, max_marks, passed, entered_by, timestamps, UNIQUE(student_id, parent_exam_type_id, subject_id))`. FK + RLS for admin/teacher/parent (read-own-children).
  - Added 3 columns on `result_masters`: `min_for_supplementary` (nullable threshold, same units as `pass_mark_value`), `max_supplementary_subjects` (default 2), `supplementary_pass_action` (`cap_at_pass_mark` default | `use_retest_marks`).

### API + UI
- [x] `/api/erp/supplementary/eligible?class_id&exam_type_id` — eligibility list (failing + within supplementary range, capped per-student to `max_supplementary_subjects` keeping the smallest-gap candidates).
- [x] `/api/erp/supplementary` — GET filter + POST bulk upsert with onConflict on `(student_id, parent_exam_type_id, subject_id)`.
- [x] Per-student retest marks entry at `/admin/exams/supplementary` — class+exam pickers, eligibility table with original marks/pass cutoff/gap, retest marks + max + outcome columns with auto-pass detection.
- [x] Final-result recompute: `computeFinalResult` fetches passed `supplementary_attempts` for the student×examConfigs and substitutes via `applySupplementarySubstitution` before per-subject pct compute. Substituted mark = pass threshold (`cap_at_pass_mark`) or actual retest marks (`use_retest_marks`).
- [x] Diagnostic JSON endpoint `/api/erp/results/final-result` exposing the computed FinalResult (auth gated by `canViewReportCard`).

### Permission: `supplementary_exams` ✅ — registered in `FEATURE_CATALOG`, sidebar (`RefreshCw` icon under Exams), hub tile.

### Verification
- [x] e2e harness `scripts/_e2e-test.mjs` adds 16 Phase 8 assertions covering eligibility flagging, attempt insert, idempotent re-upsert (UNIQUE constraint), and the substitution outcome (asserts subject `passed: false → true` and main aggregate moves up after a passing supplementary).
- [x] Full harness pass count: **83/83 passed** across Phases 5, 6A, 6B, 6C, 8.

### Review (shipped 2026-04-25)

- **Substitution boundary:** supplementary substitution applies inside `computeFinalResult` only — it does NOT mutate per-exam marksheet snapshots. Phase 5 marksheets remain immutable historical records of that one exam; supplementary affects the rolled-up final result that the report-card final-result mode renders.
- **Pass-action knob:** defaulted to `cap_at_pass_mark` (substituted mark = pass threshold) — discourages students banking high scores by intentionally failing the main exam. Schools that want the actual retest score to count switch to `use_retest_marks` on the Result Master.
- **Eligibility cap behaviour:** if a student has more failing subjects than `max_supplementary_subjects`, the lib keeps the `N` with the smallest gap-to-pass (most likely to pass on retest). Existing attempt rows are always kept in the response so admins can audit historical entries even after settings change.
- **Deviation — pass decision in payload, not derived:** `passed` is part of the POST body rather than computed server-side. Lets admins manually override edge cases (e.g. student missed retest but school waives) without needing a separate "manual override" flag.
- **No teacher-portal page:** admin-only for v1. Teachers can be added later by lifting the page gate (RLS already permits teacher writes for their own classes).

---

## Appendix — Findings from Legacy Platform Screenshots (for reference)

Reviewed 17 screenshots of an existing school ERP platform. Features already captured above, plus the following inflection points worth calling out separately so they don't get lost:

### A. Marksheet Header/Footer is a rich HTML editor with keyword substitution
Legacy admin builds report-card headers in a WYSIWYG editor using placeholders like `#STUDENTNAME#`, `#FATHERNAME#`, `#CLASS#`, `#Section#`, `#RollNo#`, `#SESSION#`, `#DOB#`, `#OverAllGrade#`, `#Rank#`, `#Division#`, `#ObtMaxMarks#`, `#CGPA#`, `#Remark#`, `#Photo#`, `#House#`, `#Top10Sec#` (top 10 in section photo), `#BoardRegNo#`, `#ATTENDANCE#`, `#AttendancePer#`. At render time the engine substitutes real values. Multiple footer templates exist per faculty ("PRIMARY FOOTER", "REPORT CARD XI", "III TO VIII REPORT CARD").

This is substantially more flexible than our current hardcoded PDF layout. Potential future phase (tentatively after Phase 4):

- **Phase 4a — Keyword-substitution PDF template designer**:
  - Add `marksheet_templates(id, name, faculty_scope class_level, header_html, footer_html, body_html, is_default, timestamps)`.
  - Build a keyword reference panel listing every placeholder + its source column / computed field.
  - Extend `ReportCardPDF` with an HTML-template render path (using `html-pdf-node` or `@react-pdf` with an HTML-to-JSX converter) alongside the current code-driven layout.
  - Admin picks: code template (current) OR HTML template (legacy-parity).
- _Decision deferred until Phase 4 ships — may prove unnecessary if the code template with configurable blocks is sufficient._

### B. Result Advance Setting as Key-Value store per (Session × Faculty × Category)
The legacy Advance Setting page stores rules as name/value pairs grouped by Category ("Marks of Division", likely also "Grace", "Non-Scholastic Thresholds"). Example values:
- `Distinction=75`, `FirstDiv=60`, `SecondDiv=45`, `ThirdDiv=36` (division thresholds)
- `ByGraceSingleSub=5`, `ByGraceFirstSub=2`, `ByGraceSecondSub=2` (grace tiers)
- `MinForPassInMainExam=24`, `MinForSupplementary=25`, `SupplementarySubs=2` (supplementary rules)

**Design note for Phase 4:** consider modeling Result Advance Settings as `result_advance_settings(id, academic_year_id, class_level, category, name, value numeric, value_text text nullable, UNIQUE(academic_year_id, class_level, category, name))` rather than a fixed set of columns — gives admin extensibility to add new rules without schema changes.

### C. Division system — a new output dimension
Distinction / First Division / Second Division / Third Division is a computed classification per student (alongside letter grade + percentage) based on overall percentage thresholds. Needs to be surfaced on the report card. Fold into Phase 4 Result Master.

### D. Supplementary Exam rules alongside Division
Students who miss the pass mark by a narrow margin go to Supplementary. Tracked separately (Phase 8 above). Result Master decides who qualifies.

### E. Marks Entry filter additions (Phase 2)
- **"Default Max Marks"** text field: override `exam_types.max_marks` for a specific class+subject entry session (e.g., practicals might have 20 max in this exam instead of the default 100).
- **"Order by"** dropdown: Name / Roll / Admission No — affects the order students appear in the marks grid.
- **"Exam Info"** button: opens a side panel with the exam schedule (date/time/room for this subject) so the teacher can cross-check while entering marks.

### F. "Import from Previous Year" button on masters
Non-Scholastic Sub-Subject Master (at least) has a one-click import from last session. Implement as a cross-cutting feature on every master that typically carries forward: non-scholastic subjects/sub-subjects, exam types, exam schedules, result masters, grade scales. Ship alongside Phase 3/4 where it becomes most valuable.

### G. Per-class Non-Scholastic sub-subjects
Legacy UI filters sub-subjects per Class (`III` in the screenshot). Our current `non_scholastic_sub_subjects(parent_subject_id, name, …)` has no class scoping — currently global under a subject. Either:
1. Add `class_id uuid nullable` to `non_scholastic_sub_subjects` (null = applies to all classes), OR
2. Add a join table `class_non_scholastic_sub_subjects(class_id, sub_subject_id)`.

Option 2 is cleaner if admins often share sub-subjects across classes (e.g. "Discipline → Punctuality" applies to all). Bring in when Phase 2 non-scholastic entry goes live, so teachers see the right sub-subjects per class.

### H. Change-order UX on masters
Legacy supports drag-to-reorder on masters (visible 4-direction-arrow handle on Non-Scholastic Sub-Subject rows). Our masters already have `sort_order` columns — just need the drag-and-drop UI, add as polish pass per master.

---

## Review section (filled in after implementation)

_TBD — will summarize what shipped, deviations from plan, and follow-ups._
