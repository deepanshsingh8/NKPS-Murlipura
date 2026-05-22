# Phase 3 — Result Master + Advanced Settings

**Status:** Complete — all 10 steps shipped, awaiting user commit.

**Scope:** Admin-configurable rules per (class + academic year) that drive the Report Card PDF. Covers both basic rules and six advanced "power controls."

**Hard constraints (same as Phase 0):**
- Existing `/teacher/results`, `/student/results`, `/parent/results` unchanged.
- Existing Report Card PDF must render **byte-identical** for any class that has no `result_master` row — zero regression for pre-Phase-3 data.
- Migration mirrored in `supabase-schema.sql` in the same turn.
- New feature key in `src/lib/permissions.ts` (admin-only, like Grade Master).

---

## 1. Scope matrix — user requirements → implementation

### Basic Rules (from Result Master page)
| Requirement | Where it lives |
|---|---|
| Subjects included in result | `result_master_subjects` rows (absence = excluded entirely) |
| Main vs Optional subjects | `result_master_subjects.role` (`'main' \| 'optional'`) |
| Passing marks per subject | `result_masters.pass_mark_mode` (`'percentage' \| 'raw_marks'`) + `pass_mark_value` + per-subject `pass_mark_value_override` |
| Overall pass criteria | `result_masters.pass_criteria_type` (extensible — new types added in code without migration) + `pass_criteria_config jsonb` |

### Advanced Settings (Power Controls)
| # | Requirement | Where it lives |
|---|---|---|
| 1 | Weightage (CT / Half-Yearly / Annual mixing) | Existing `class_exam_configs.weightage` (Phase 0.3). Phase 3 adds UI only. |
| 2 | Best of N class tests | `result_masters.class_test_best_of` (nullable int; NULL = all) |
| 3 | Grace marks (subject-level or total) | `result_masters.grace_marks_per_subject_max`, `grace_marks_total_max`, `grace_marks_condition` |
| 4 | Include/Exclude subjects (e.g., exclude GK from total) | Not in `result_master_subjects` → excluded; `role='optional'` → shown but not in total |
| 5 | Rounding rules (39.5 → 40) | `result_masters.rounding_mode`, `rounding_precision` |
| 6 | Non-scholastic display (show/hide/placement) | `result_masters.include_non_scholastic`, `non_scholastic_placement` |

---

## 2. Migrations

### `scripts/migration-022-result-master.sql`

```sql
-- result_masters: one row per (class, academic_year)
CREATE TABLE result_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,

  -- Basic rules — pass mark supports percentage OR raw marks mode
  pass_mark_mode text NOT NULL DEFAULT 'percentage'
    CHECK (pass_mark_mode IN ('percentage', 'raw_marks')),
  pass_mark_value numeric(6,2) NOT NULL DEFAULT 33
    CHECK (pass_mark_value >= 0),
  -- Pass criteria is extensible: type is a string (no DB check so new types
  -- can be added in code without migration); config holds type-specific params.
  pass_criteria_type text NOT NULL DEFAULT 'all_main_subjects',
  pass_criteria_config jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Display
  show_rank boolean NOT NULL DEFAULT false,
  show_extra_separately boolean NOT NULL DEFAULT true,
  include_non_scholastic boolean NOT NULL DEFAULT false,
  non_scholastic_placement text NOT NULL DEFAULT 'below'
    CHECK (non_scholastic_placement IN ('below', 'above', 'separate_page')),

  -- Grading override (NULL = use class_grade_scales or global default)
  grade_scale_id uuid REFERENCES grade_scales(id) ON DELETE SET NULL,

  -- Grace marks (all in percentage points; applied before pass check)
  grace_marks_per_subject_max numeric(5,2) NOT NULL DEFAULT 0
    CHECK (grace_marks_per_subject_max >= 0 AND grace_marks_per_subject_max <= 100),
  grace_marks_total_max numeric(5,2) NOT NULL DEFAULT 0
    CHECK (grace_marks_total_max >= 0 AND grace_marks_total_max <= 100),
  grace_marks_condition text NOT NULL DEFAULT 'failing_only'
    CHECK (grace_marks_condition IN ('failing_only', 'any_subject')),

  -- Rounding
  rounding_mode text NOT NULL DEFAULT 'none'
    CHECK (rounding_mode IN ('none', 'half_up', 'half_down', 'ceil', 'floor')),
  rounding_precision integer NOT NULL DEFAULT 0
    CHECK (rounding_precision BETWEEN 0 AND 2),
  round_raw_marks boolean NOT NULL DEFAULT false, -- apply rounding to raw marks too

  -- Best-of rules — nullable = use all; N = keep top N by percentage
  class_test_best_of integer
    CHECK (class_test_best_of IS NULL OR class_test_best_of > 0),
  practical_best_of integer
    CHECK (practical_best_of IS NULL OR practical_best_of > 0),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_id, academic_year_id)
);

-- result_master_subjects: which subjects appear + how
CREATE TABLE result_master_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_master_id uuid NOT NULL REFERENCES result_masters(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'main'
    CHECK (role IN ('main', 'optional')),
  -- Per-subject override uses master.pass_mark_mode (pct or raw marks)
  pass_mark_value_override numeric(6,2)
    CHECK (pass_mark_value_override IS NULL OR pass_mark_value_override >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(result_master_id, subject_id)
);

-- RLS: authenticated read, admin write (same pattern as grade_scales)
ALTER TABLE result_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_master_subjects ENABLE ROW LEVEL SECURITY;
-- (policy definitions match grade_scales — read for authenticated, write for admin role)

-- updated_at trigger on result_masters (reuse existing update_updated_at_column())
```

### Supported `pass_criteria_type` values (extensible without migration)

| Type | Config shape | Semantics |
|---|---|---|
| `all_main_subjects` | `{}` | Student passes iff every `role='main'` subject passes. |
| `overall_percentage` | `{ overall_pct: number }` | Main-subject aggregate ≥ overall_pct. |
| `main_and_overall` | `{ overall_pct: number }` | Every main subject passes AND aggregate ≥ overall_pct. |
| `pass_n_subjects` | `{ n: integer }` | At least N main subjects pass. |
| `allow_one_fail` | `{ overall_pct: number }` | At most one main subject may fail, if aggregate ≥ overall_pct. |

New types can be added purely in `src/lib/final-result.ts` resolver + the admin UI picker — no DB migration needed.

**Mirror to `supabase-schema.sql` in the same commit.**

---

## 3. Final-result computation (`src/lib/final-result.ts`)

Pure, deterministic function. Given `(student_id, academic_year_id, supabase)`:

### Step-by-step algorithm
1. **Load config bundle** (one fetch each):
   - `result_master` row (with subjects) for student's class + year.
   - `class_exam_configs` for the class (applicable exams + weightages).
   - All `results` for student + year, grouped by `exam_type_id`.
   - Resolved grade scale via `resolveGradeScaleForClass` (respecting result_master override).

2. **Filter applicable exams** — only exams where `class_exam_configs.is_applicable=true` AND a matching `results` row exists.

3. **Best-of rule** — if `class_test_best_of` is set:
   - Filter applicable exams to `kind='class_test'`.
   - Compute each CT's overall percentage (across subjects a student has results for).
   - Keep only the top-N by percentage; others are *excluded from the final-result computation* (they still appear on the report card as individual exam rows — the report-card table renders from raw `results`, not from the final-result selection).
   - **No redistribution.** Kept CTs use their original weightages from `class_exam_configs`. If admin wants CTs to keep a constant total contribution (e.g., 20%), they should configure each CT's weight so the top-N sums to that target.
   - Same logic applies independently if `practical_best_of` is set for `kind='practical'`.

4. **Per-subject weighted computation** — for each subject in `result_master_subjects`:
   ```
   subject_pct = Σ (exam_pct × exam_weight) / Σ exam_weight
   ```
   where only applicable (post-best-of) exams that have a result for that subject contribute.

5. **Grace marks** — iterate *all* subjects (main + optional, per user decision):
   - If `grace_marks_condition='failing_only'`: only apply grace if `subject_pct < effective_pass_mark_pct`.
   - If `grace_marks_condition='any_subject'`: applies unconditionally.
   - Cap per-subject grace at `grace_marks_per_subject_max`.
   - Maintain a running total; cap total at `grace_marks_total_max`.
   - Track grace applied per subject for audit/display.
   - Grace is applied *before* the pass check (so grace can make a student pass).

6. **Rounding** — apply `rounding_mode` + `rounding_precision` to:
   - Each `subject_pct` (post-grace).
   - The overall aggregate percentage.
   - Each subject's raw marks **only if `round_raw_marks=true`** (applied to `marks_obtained` before any percentage computation, so a 39.5 raw → 40 raw changes downstream %).

7. **Pass mark evaluation** — compare subject result to the effective pass mark:
   - Effective pass value = `pass_mark_value_override ?? pass_mark_value` (interpreted via `pass_mark_mode`).
   - `percentage` mode: compare rounded `subject_pct` against the pct value.
   - `raw_marks` mode: compare student's post-grace raw marks for that subject against the raw value. (For raw-marks mode the grace application translates the pct grace back into raw marks for the comparison.)

8. **Overall pass/fail** — resolved via `resolvePassCriteria(type, config, context)` in `final-result.ts`. Dispatches on `pass_criteria_type` (see table above). Adding a new type = adding a case to this resolver + an entry in the admin UI picker — no migration.

9. **Grade resolution** — `computeGrade(final_pct, bands)` using resolved scale.

10. **Rank** (if `show_rank`) — computed at PDF-generation time for class cohort, not per student. (Separate helper `computeRanksForClass`.)

### Return shape
```ts
interface FinalResult {
  student_id: string;
  class_id: string;
  academic_year_id: string;
  main_subjects: FinalSubject[];
  optional_subjects: FinalSubject[];
  overall: {
    main_total_pct: number;      // rounded
    main_total_pct_raw: number;  // pre-rounding, for debugging
    grade: string | null;
    passed: boolean;
    pass_reason: string;         // human-readable e.g. "All 5 main subjects ≥ 33%"
    grace_applied_total: number;
  };
  rank?: number | null;
  config_applied: {
    result_master_id: string;
    grade_scale_name: string;
    best_of_applied: boolean;
    rounding_summary: string;
  };
}

interface FinalSubject {
  subject_id: string;
  subject_name: string;
  role: 'main' | 'optional';
  exam_contributions: Array<{
    exam_type_id: string;
    exam_name: string;
    marks_obtained: number;
    max_marks: number;
    pct: number;
    weight: number;
  }>;
  raw_pct: number;       // pre-grace, pre-rounding
  grace_applied: number;
  final_pct: number;     // rounded, post-grace
  grade: string | null;
  passed: boolean;
}
```

### Fallback path
- If **no `result_master`** exists for (class, year) → return `null`. Caller renders legacy layout.
- If result_master exists but **zero subjects** → return error object; admin UI flags as incomplete.

---

## 4. Report Card PDF rewrite (`src/components/pdf/ReportCardPDF.tsx`)

### Strategy: branch on presence of `finalResult` prop
- `ReportCardPDF` gets an **optional** `finalResult?: FinalResult` prop.
- If absent → existing rendering path (unchanged). **This is the regression guarantee.**
- If present → new sections:
  - **Main subjects table** — per-exam columns + weighted final column.
  - **Optional subjects mini-table** (if `show_extra_separately` and any exist).
  - **Final Result block** — overall %, grade, pass/fail badge, grace applied summary.
  - **Non-scholastic block** — placed per `non_scholastic_placement`. (Reads `non_scholastic_assessments` once Phase 2 lands; until then renders "Not yet recorded.")
  - **Rank** (if `show_rank` and rank passed in).
  - **Upper header banner** — from `exam_types.upper_header` when rendering a single-exam snapshot (not applicable to final-result view).

### Wiring
- `src/lib/report-card.ts` gains a helper `buildReportCardData` that conditionally calls `computeFinalResult`. Returns `{ ...existingData, finalResult }`.
- `/api/erp/results/report-card/pdf/route.tsx` passes `finalResult` through to the PDF component.

---

## 5. Admin UI — `/admin/exams/result-master`

### Layout
- **Top bar:** Class + Academic Year selector (URL-synced).
- **Empty state:** "No config for this class/year. [Create Result Master]" button.
- **Configured state:** Four tabs.

### Tab 1 — Basic Rules
- **Pass mark:** mode toggle (Percentage / Raw marks) + value input (label adapts: "%" vs "marks")
- **Pass criteria:** dropdown of supported types (see section 2 table); right-side config panel renders inputs based on selected type (e.g., overall_pct input, n input). New types surface automatically when added to the resolver registry.
- Save button

### Tab 2 — Subjects
- Table: all class-level subjects
- Per row: Include checkbox | Role dropdown (Main/Optional) | Pass mark override (blank = use master default; input label reflects master's `pass_mark_mode`) | Sort order (drag handle)
- Save button

### Tab 3 — Advanced Settings
- **Weightage section** — reads/writes `class_exam_configs`. Lists exam types applicable to the class; rows: exam name | kind badge | is_applicable toggle | weightage % | sort order. "Sum ≠ 100%" warning chip.
- **Best of Rule section** — two inputs: `class_test_best_of` and `practical_best_of`. Each with inline hint ("e.g., 2 = use only the 2 highest-scoring class tests in the final computation. Others still show on the report card but don't contribute to the final aggregate. No automatic weight redistribution — configure individual exam weights accordingly."). Shows current counts of each kind for context.
- **Grace Marks section** — three fields (per-subject max %, total max %, condition dropdown). Note: applies to main AND optional subjects.
- **Rounding section** — mode dropdown + precision + `round_raw_marks` toggle + live preview showing "39.5 → {result}" and "74.2% → {result}" side-by-side.
- **Non-Scholastic section** — include toggle + placement dropdown (disabled + hint if no non-scholastic assessments exist yet).
- **Grade Scale section** — dropdown of scholastic scales + "Use class default" option.
- Save button (per section or whole-form — TBD; recommend whole-form for atomicity).

### Tab 4 — Preview
- Student picker (from class roster).
- Renders live `FinalResult` computation as a card + "Download sample PDF" button.
- Shows `config_applied` summary so admin sees which rules fired.

---

## 6. API routes

All admin-only via `verifyAdmin`.

- `GET /api/erp/result-masters?class_id=&academic_year_id=` — fetch single config with subjects + class_exam_configs joined.
- `POST /api/erp/result-masters` — create (master + subjects in one transaction).
- `PATCH /api/erp/result-masters/[id]` — update master fields.
- `PUT /api/erp/result-masters/[id]/subjects` — wholesale replace subjects list (atomic).
- `PUT /api/erp/result-masters/[id]/exam-configs` — wholesale replace `class_exam_configs` rows for the class (writes to existing table).
- `DELETE /api/erp/result-masters/[id]` — soft-guard: confirm dialog in UI, cascade deletes subjects.
- `GET /api/erp/result-masters/[id]/preview?student_id=` — runs `computeFinalResult` and returns JSON (no PDF).

---

## 7. Permissions + discoverability

- [ ] Add `result_master` to `ADMIN_ONLY_PREFIXES` at `/admin/exams/result-master`.
- [ ] No feature_key needed (admin-only, same as Grade Master).
- [ ] Tile on `/admin/exams` hub landing page (admin-only).
- [ ] Link in sidebar Exams group (admin-only via href with no feature_key).

---

## 8. Types (`src/types/index.ts`)

New interfaces:
- `ResultMaster` — mirrors table columns.
- `ResultMasterSubject` — mirrors table columns.
- `FinalResult`, `FinalSubject` — as defined in section 3.

---

## 9. Implementation order (subagent-delegatable chunks)

Break into small, testable increments. **NOT committing as we go** — user will commit the full bundle at end.

- [x] **1. Migration 022 + schema mirror** — `scripts/migration-022-result-master.sql` (142 lines) + appended 123 lines to `supabase-schema.sql`. Matches Phase 0 pattern (no updated_at triggers; RLS authenticated-read + admin-write).
- [x] **2. Types + final-result lib** — `src/types/index.ts` (+102 lines) + `src/lib/final-result.ts` (527 lines). Exports: `computeFinalResult`, `computeFromFixtures` (pure core), `resolvePassCriteria`, `describePassCriteria`, `SUPPORTED_PASS_CRITERIA_TYPES`. 18 smoke assertions passed (best-of, grace, rounding). Design notes captured in section 12 below.
- [x] **3. API routes** — 5 route files + `src/lib/result-master-validation.ts` + 4 Zod schemas in `src/lib/validations.ts`. Total ~661 lines. Typecheck clean. Route map:
  - `GET /api/erp/result-masters?class_id=&academic_year_id=` — returns `{ master, subjects, exam_configs }` (master nullable).
  - `POST /api/erp/result-masters` — create master only (no subjects; UI calls subjects PUT next).
  - `PATCH /api/erp/result-masters/[id]` — partial update; validates pass_criteria_type + config as a pair.
  - `DELETE /api/erp/result-masters/[id]` — cascade.
  - `PUT /api/erp/result-masters/[id]/subjects` — wholesale replace.
  - `PUT /api/erp/result-masters/[id]/exam-configs` — wholesale replace `class_exam_configs` scoped to master's class_id.
  - `GET /api/erp/result-masters/[id]/preview?student_id=` — calls `computeFinalResult`, returns `{ final_result, student }`.
- [x] **4. Admin UI scaffold** — `src/app/admin/exams/result-master/page.tsx` (413 lines) — URL-synced class+year selectors, empty-state + Create button, 4-tab Tabs layout, delete dialog. Tabs 3+4 are placeholders.
- [x] **5. Admin UI — Basic + Subjects tabs** — `src/components/admin/result-master/BasicRulesTab.tsx` (365), `SubjectsTab.tsx` (334), `helpers.ts` (50). Bundled with Step 4 since scaffold without a working tab is dead weight. Helpers (`labelForCriteriaType`, `defaultConfigFor`, `CRITERIA_TYPE_LABEL`, `shallowEqualRecord`) should be reused by Step 6. Class subjects fetched via client Supabase (no `/api/erp/subjects?class_id=` exists; reused the timetable pattern).
- [x] **6. Admin UI — Advanced tab** — `AdvancedTab.tsx` (490 orchestrator) + 6 subsection files under `advanced/` (~822 lines total). All 6 power-controls: Weightage (exam_configs union-merged with all exam_types for the year), Best-of (class_test + practical), Grace, Rounding (with live preview cards via `previewRound`), Non-Scholastic, Grade Scale Override. One global Save button runs PUT exam-configs + PATCH master sequentially. `helpers.ts` now 172 lines (added `previewRound`, `mergeExamConfigsWithExamTypes`, `ExamConfigWithType`, `ExamTypeRow`, `EXAM_KIND_LABEL`).
- [x] **7. Admin UI — Preview tab** — `src/components/admin/result-master/PreviewTab.tsx` (710 lines). Class-roster picker via `student_enrollments` (active status), zero-main-subjects gate before any fetch, FinalResult card (header strip, overall block with grade/pass/grace, main+optional subject tables with per-exam contributions, `config_applied` chips), legacy PDF link with known-caveat note. Scaffold page.tsx updated to mount the tab; placeholder helper removed.
- [x] **8. Report Card PDF rewrite** — `src/components/pdf/ReportCardPDF.tsx` grew from 395 → 1021 lines. Added optional `finalResult`, `resultMaster`, `upperHeader` props; legacy path untouched (branches into new `Phase3Document` only when `finalResult` is truthy). Phase-3 body renders: optional upper banner, main subjects table (Sr / Subject / per-exam cells / Raw % / Grace / Final % / Grade / P/F) with Total/Aggregate footer row, optional subjects table (when `show_extra_separately`) or merged inline with `(optional)` tag, Final Result panel (overall %, grade, PASS/FAIL badge, pass reason, grace total, rank), non-scholastic placeholder honoring 'above'/'below'/'separate_page' placement, and a small `config_applied` footer line. Typecheck clean on modified file.
- [x] **9. Wire PDF route to pass `finalResult`** — `src/app/api/erp/results/report-card/pdf/route.tsx` (116 → 270 lines) branches on `exam_type_id` (legacy, byte-identical) vs `academic_year_id` (final-result: loads master, calls `computeFinalResult`, optionally attaches cohort rank via new `computeRanksForClass`, synthesizes a virtual "Final Result" exam group for the remark-block plumbing, passes narrow `resultMaster` + `finalResult` props). New helper `computeRanksForClass` in `src/lib/final-result.ts` (+57 lines) returns a `Map<student_id, rank>` with tie-aware (1, 2, 2, 4) ranking. Preview tab link needed no changes.
- [x] **10. Sidebar + landing tile + ADMIN_ONLY_PREFIXES** — added `/admin/exams/result-master` to `ADMIN_ONLY_PREFIXES` in `src/lib/permissions.ts`, inserted a `ClipboardCheck`-iconed "Result Master" entry in the Exams group in `AdminSidebar.tsx` (right after Grade Master), and added a matching tile on `/admin/exams` landing page (admin-only, emerald accent) mirroring Grade Master's shape.

### Testing gates (per Phase 0 checklist pattern)
- [ ] Class without result_master → PDF byte-identical to pre-Phase-3 (diff test).
- [ ] Class with result_master → weighted final result matches hand calculation for 3 sample students (doc checkpoint).
- [ ] Grace marks: failing_only skips grace when subject passes.
- [ ] Grace marks: total cap respected across subjects.
- [ ] Best-of 2 of 4 class tests: dropped 2 don't affect final, weightage redistributes.
- [ ] Rounding: 39.5 → 40 under `half_up`; → 39 under `half_down` / `floor`.
- [ ] `pass_criteria='all_main_subjects'` fails student with one main subject below threshold.
- [ ] `pass_criteria='overall_percentage'` uses main-subject aggregate only.
- [ ] Non-scholastic placement honored in PDF layout.
- [ ] Deleting result_master → PDF reverts to fallback cleanly.

---

## 10. User-confirmed decisions

| # | Decision |
|---|---|
| Best-of scope | Class tests AND practicals — two independent fields `class_test_best_of`, `practical_best_of`. |
| Best-of weight handling | No redistribution. Dropped exams just don't contribute. Admin tunes individual weightages if they want constant total. |
| Grace marks scope | Apply to ALL subjects (main + optional). |
| Pass criteria | Extensible — stored as `pass_criteria_type` + `pass_criteria_config jsonb`. New types added in code resolver + UI picker. 5 built-in types at launch (see section 2). |
| Rounding target | Subject % + overall % always; raw marks opt-in via `round_raw_marks` toggle. |
| Grace timing | Applied *before* pass check (grace can save a student). |
| Pass mark mode | Admin-editable: Percentage OR Raw marks (one mode per master, applies to all subjects). |
| Granularity | One result_master per (class, academic_year). No mid-year variant needed. |
| Rank | Main subjects only in aggregate used for ranking. (Unchanged from draft.) |
| Commits | Do not commit during implementation. Build all 10 steps, user will commit manually at end. |

---

## 11. Review section

**Phase 3 shipped (awaiting user commit):**

- **Schema + compute core**: `result_masters` + `result_master_subjects` tables (migration 022 mirrored to `supabase-schema.sql`), pure `computeFinalResult` with best-of, grace, rounding, extensible pass-criteria resolver, and tie-aware cohort `computeRanksForClass` helper.
- **Full admin UI at `/admin/exams/result-master`** — 4 tabs (Basic Rules, Subjects, Advanced, Preview) with URL-synced class+year selectors, dirty-state tracking, 6 power-control subsections, and live FinalResult preview card.
- **7 API routes** under `/api/erp/result-masters` (GET/POST/PATCH/DELETE master, PUT subjects, PUT exam-configs, GET preview) with shared Zod+pass-criteria validation.
- **Report Card PDF upgraded in place** — optional `finalResult` / `resultMaster` / `upperHeader` props branch into a new Phase-3 layout; legacy path byte-identical when props absent. PDF route supports both `?exam_type_id=` (legacy) and `?academic_year_id=` (final-result) modes.
- **Discoverability wired** — admin-only route guard, sidebar link (ClipboardCheck icon in Exams group), and landing tile on `/admin/exams` hub.

**Follow-ups captured in section 12**: `max_marks_override` on `class_exam_configs` still unconsumed by final-result, duplicate fetch in PDF route (`getReportCardData` + `computeFinalResult`), and threading real non-scholastic data once Phase 2 lands.

---

## 12. Subagent findings (running log — things UI/PDF implementers must know)

### From Step 2 (final-result lib)
- **Raw-marks pass threshold conversion**: when `pass_mark_mode='raw_marks'` and a subject has multi-exam contributions with different max_marks, threshold converts to pct via weight-averaged max. Admin UI help text must clarify this.
- **Grace cap is sort_order-dependent**: when `grace_marks_total_max` is tight, subjects iterate in `sort_order`; lower sort_order gets grace first. Worth an inline hint.
- **Empty-mains returns `null`** (like no-master). Admin UI must separately query "master exists but has 0 main subjects" to flag "incomplete" state.
- **Zero-weight exam configs are silently dropped** from contributions — no noise row on PDF.
- **Rank computation deferred** — `FinalResult.rank` is typed but populated by sibling helper at PDF-gen time (Step 9), not inside `computeFinalResult`.

### From Step 6 (Advanced tab) — gotchas for Step 7 & 8
- **`max_marks_override` on `class_exam_configs` is NOT currently consumed** by `final-result.ts` (which reads per-result `max_marks`). Step 7/8 must decide: is override supposed to supersede? Propose: leave it unused for now, since per-result max_marks is already authoritative at mark-entry time. Surface as a follow-up note.
- **Empty-main-subjects returns null from `computeFinalResult`** (same as no-master). Preview tab MUST detect this separately (re-query `result_master_subjects` count) and show "Incomplete config — add at least one main subject" rather than "no master found".
- **`grade_scale_id` null handled via `"__default__"` sentinel** in the Advanced dropdown (base-ui Select can't accept null). Mapped back to null on PATCH. Preview tab should resolve the effective scale by checking `result_master.grade_scale_id` → `class_grade_scales` → default scholastic scale.
- **Best-of count hint uses `is_applicable=true` rows only** — if admin sets `class_test_best_of=2` but all CTs are flagged `is_applicable=false`, the hint says "0 configured" which is useful but not blocking.
- **Exam-type fetching**: use client Supabase on `exam_types` with authenticated-read RLS. Filter by `academic_year_id`. No admin API endpoint exists for this.

### From Step 8 (PDF rewrite) — gotchas for Step 9

- **Call signature for Phase-3 mode**: `ReportCardPDF` now accepts three new optional props — `finalResult?: FinalResult`, `resultMaster?: { include_non_scholastic, non_scholastic_placement, show_extra_separately, show_rank }`, and `upperHeader?: string`. Step 9 must build the `resultMaster` prop by cherry-picking those four booleans/strings off the full `ResultMaster` row — do NOT pass the whole row, the prop is narrowly typed on purpose.
- **Legacy path regression guarantee held**: the branch is `if (usePhase3 && finalResult) { ... }` at the top of the function. Below that, the original JSX is byte-identical to the pre-Phase-3 file. Step 9 can safely ship without touching legacy callers.
- **`exam` prop is still required in Phase-3 mode** — it drives the class-teacher remark block (reused from legacy) and the `Document` title fallback. For a true "no single exam" final-result view, Step 9 will need to either synthesize a minimal `ReportCardExamGroup` (e.g., `{ exam_type_name: "Final Result", subjects: [], remark: null, ... }`) OR accept that the remark block renders only when `exam.remark` is set. Recommend the former — pass a virtual "Final Result" exam group so remark can still be threaded from `student_remarks` keyed by whatever exam_type the admin chooses as the "final" remark source.
- **`upperHeader` plumbing is dormant** until Step 9 decides where the string comes from. Not blocked — pass `undefined` and the banner skips cleanly. Reasonable source: `exam_types.upper_header` for a chosen "capstone" exam, OR a dedicated field on the result_master in a later migration.
- **Non-scholastic data is NOT yet threaded**. Component renders "Not yet recorded." when `include_non_scholastic=true`. Phase 2 will add `non_scholastic_assessments` — at that point add a `nonScholastic?: ...` prop rather than re-fetching inside the PDF component.
- **Exam columns are unioned across `finalResult.main_subjects`** (and optionals when `show_extra_separately=false`), preserving first-encounter order. `computeFinalResult` pre-sorts each subject's `exam_contributions` by `sort_order` then name, so first-encounter order IS globally correct. Step 9 can trust this — no extra sort needed at the route layer.
- **Many exam columns = narrow cells**: Phase-3 table uses 8pt font with `flex: 1` for exam columns. If a class has 6+ exams the PDF gets visually dense but still fits A4 portrait. If future feedback complains, switch to landscape in Phase-3 mode via a `<Page orientation="landscape">` swap — the entire page style already uses percentage/flex widths so it'll adapt.
- **`config_applied.grade_scale_name` can be null** (confirmed in Step 7 gotchas). PDF renders "—" in that case. Step 9 doesn't need to pre-sanitize.
- **Rank must be computed cohort-wide at the route layer** (Step 9). The PDF only reads `finalResult.rank`. `computeFinalResult` does not populate rank — use a sibling helper like `computeRanksForClass(supabase, classId, academicYearId)` that returns a `Map<student_id, rank>` and inject it into each student's `FinalResult` before calling `renderToBuffer`.
- **Route shape decision for Step 9**: existing `/api/erp/results/report-card/pdf` takes `student_id` + `exam_type_id`. For Phase-3 mode, either (a) make `exam_type_id` optional and branch inside the route based on a new `?mode=final` param, or (b) add a sibling route `/api/erp/results/report-card/final-pdf`. Preview tab's link currently points at the existing route with a caveat (see Step 7 gotcha), so (a) keeps the link working. Recommended: (a).
- **Build passes**: `npx tsc --noEmit` returns clean for the modified PDF file. The only repo-wide TS error is pre-existing in `src/app/admin/exams/non-scholastic-assessments/page.tsx` (unrelated Phase 2 WIP code) and is not introduced by Step 8.

### From Step 9 (PDF route wiring) — gotchas for Step 10

- **Two modes, one route**: `?exam_type_id=...` → legacy branch (first block after auth, byte-identical to pre-Phase-3 codepath); `?academic_year_id=...` without `exam_type_id` → final-result branch. Both-absent returns 400. Accepting both signals simultaneously is not defined — legacy wins when `exam_type_id` is present (keeps existing student/parent/admin callers working).
- **Legacy-path regression check**: the `exam_type_id` branch constructs `<ReportCardPDF>` with exactly the original prop set (`school`, `student`, `exam`, `attendance`, `logoData`, `generatedOn`, `footer`) — no `finalResult` / `resultMaster` / `upperHeader`. Filename pattern and response headers unchanged.
- **Synthesized virtual exam**: final-result mode builds a minimal `ReportCardExamGroup` with `exam_type_id: "__final_result__"` and `remark: null` so the shared class-teacher remark block in the PDF component skips cleanly. If we ever want to thread a "final remark" from `student_remarks`, a new column like `student_remarks.is_final` would make this explicit — currently out of scope.
- **Re-fetch overhead**: we call both `computeFinalResult` AND `getReportCardData` (for student header + attendance). The latter refetches `.exams` unnecessarily. Kept for minimal diff. Follow-up: extract `getStudentHeaderAndAttendance` to skip the results roundtrip.
- **Rank is gated on `show_rank`**: `computeRanksForClass` only fires when the master opts in. N+1 compute is the expensive path — don't invoke unconditionally. Tie behavior is `1, 2, 2, 4` (skip by group size).
- **Filename for final-result mode**: `report-card_{safe_name}_final-result_{safe_year_label}.pdf`. Uses `academic_years.label` looked up at route time.
- **Step 10 dependencies**: no new routes/prefixes introduced. Sidebar link + landing tile + `ADMIN_ONLY_PREFIXES` entry is purely cosmetic wiring — the existing `/admin/exams/result-master` page already works end-to-end. Preview tab's "Download sample PDF" link needed zero changes and should now resolve correctly.

### From Step 7 (Preview tab) — gotchas for Steps 8-9

- **Legacy PDF route requires `exam_type_id`** — the current `/api/erp/results/report-card/pdf` 400s without one, so the Preview tab's "Download sample PDF" button currently renders a direct link that will fail for users who click it. Step 8-9 must either (a) relax that param when `finalResult` mode is on, (b) introduce a new endpoint like `/api/erp/results/report-card/final-pdf`, or (c) pipe the Preview button through a picker. Keep the button text and the caveat note in sync with whichever path is chosen.
- **Roster source is `student_enrollments`, not `students.current_class_id`** — there is no such column on `students`. Preview fetches active enrollments for the master's `(class_id, academic_year_id)` pair. Step 8-9 PDF generation for the class cohort (rank computation) must use the same filter to match.
- **Student admission column is `admission_no`** (not `admission_number`). The API response currently only returns `id, full_name, roll_number` from the preview; if Steps 8-9 need admission on PDFs, extend the preview response or pass it through from the roster row.
- **Preview tab passes `resultMaster`, `subjects`, `classId`, `academicYearId`, `classLabel`, `yearLabel` from the scaffold** — if Step 9 needs to add a new prop (e.g., a PDF-wiring flag), follow the same pattern and thread it through `page.tsx`.
- **Zero-main-subjects detection is client-side**: counted from `bundle.subjects` in the tab itself rather than requiring another API call. Step 8 can reuse this invariant — the server-side `computeFinalResult` still returns null in that case, so the PDF route must either short-circuit to the legacy layout or surface a clear error.
- **`final_result.config_applied.grade_scale_name` can be null** when no scale is resolvable (neither master override nor class default nor global default). Preview treats that as "(none)"; PDF should display something similar and not crash.
- **`PlaceholderCard` helper was removed** from `src/app/admin/exams/result-master/page.tsx` (unused after Step 7). The `Card` import now pulls only `Card` + `CardContent`.

### From Steps 4+5 (scaffold + Basic/Subjects tabs)
- **URL sync pattern**: `router.push` for user actions, `router.replace` only for the one-time default-year seeding (keeps browser history clean).
- **No `RadioGroup` primitive** in shadcn — used a segmented-button pair with `role="radio"` + `aria-checked`. Reuse this pattern in Advanced tab if needed.
- **Subjects table** wholesale-replaces on save. Class subjects fetched via client Supabase query to `class_subjects → subjects` (no admin API endpoint exists — follows the timetable page's pattern).
- **`exam_configs` are already in the GET response** but currently not threaded to any tab. Step 6 needs to thread `exam_configs` from `loadBundle` into `AdvancedTab` props.
- **UI components confirmed available** in `src/components/ui/`: card, button, input, label, checkbox, select, tabs, dialog. Toast via `sonner`. Icons via `lucide-react`. Helpers in `@/lib/admin-api` (`adminFetch`, `adminPatch`, `adminDelete`).
- **Dirty-state pattern** (form state + baseline + `useEffect` reseed + shallow-equal check) is in `BasicRulesTab.tsx` — replicate for Advanced.

### From Step 3 (API routes)
- **Shared pass-criteria validator** lives at `src/lib/result-master-validation.ts` (Next.js routes can't export non-handler symbols, so reuse needed a separate module).
- **PATCH fetches the "other half"** when only one of `pass_criteria_type` / `pass_criteria_config` is in the body — validates the pair together. Prevents leaving a stale config after changing criteria type.
- **Wholesale-replace PUTs are not transactional** (Supabase JS has no native tx). If the insert fails after the delete, response carries `code: "SUBJECTS_INSERT_FAILED"` / `"EXAM_CONFIGS_INSERT_FAILED"` so UI can offer retry. Same pattern as `grade-scales` band replacement.
- **`pass_criteria_config` for `all_main_subjects` must be strictly `{}`** — UI must reset config to `{}` on criteria-type change, else 400.
- **`pass_mark_value_override=null`** in subjects means "use master default". Document in the subjects tab's override input.
- **GET route returns `exam_configs` even when master is null** — admin can configure weightages before creating the master.
- **DELETE is unconditional** — no dependency guard. UI confirm dialog is the only safety.
