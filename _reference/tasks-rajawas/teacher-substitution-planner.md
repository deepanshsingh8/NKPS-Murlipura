# Teacher Substitution Planner

Planning feature: when a teacher is marked absent on a given date, the admin gets a ranked list of available teachers (no class at that period) to substitute each of the absent teacher's periods that day.

The schema work is small because `timetable_periods` already exists with `(class_id, subject_id, teacher_id, day_of_week, period_number, start_time, end_time)`. The new work is an absences table, a substitutions table, a suggestion algorithm, and the admin UI.

---

## What already exists (do not rebuild)

- `timetable_periods` (supabase-schema.sql:522) — class × day × period → teacher/subject/times/room. Source of truth for "is teacher X free at period P on day D?" Has index `idx_timetable_teacher_id`.
- `teachers` (supabase-schema.sql:209) — `id, full_name, email, phone, specialization, is_active, ...`.
- `class_subjects` (supabase-schema.sql:330) — `(class_id, subject_id, teacher_id)`. Used to infer "which subjects does teacher X teach?" without needing a new qualifications table.
- `classes`, `subjects`, `academic_years` — all in place.
- `/admin/timetable` page already exists (class-centric view presumably). We'll extend the group, not replace.
- `verifyAdminOrEditor(featureKey)` (src/lib/verify-admin.ts) for API auth.
- Editor permissions system via `src/lib/permissions.ts` + `editor_permissions` table.

---

## What's missing

1. No teacher-centric timetable view (admin can't answer "what's this teacher's week?").
2. No way to record teacher absence on a date.
3. No way to assign/track substitute teachers per affected period.
4. No suggestion algorithm.

---

## Data model (migration-030-teacher-substitutions.sql)

> Migration 028 (`supplementary`) and 029 (`roll-number-auto`) already exist; next free number is 030.


### `teacher_absences`

```sql
CREATE TABLE teacher_absences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  absence_date date NOT NULL,
  half_day text CHECK (half_day IN ('full', 'first_half', 'second_half')) DEFAULT 'full',
  reason text,
  marked_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(teacher_id, absence_date)
);

CREATE INDEX idx_teacher_absences_date ON teacher_absences(absence_date);
CREATE INDEX idx_teacher_absences_teacher ON teacher_absences(teacher_id);
```

Why `half_day`: common real-world case — teacher leaves after lunch for a medical appointment. First/second half maps to a period-number cutoff derived from `timetable_periods.period_number` for that class that day (or from a school-wide lunch period config — simpler: treat first 4 periods as "first_half", rest as "second_half" and make that configurable later).

### `substitutions`

```sql
CREATE TABLE substitutions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  absence_id uuid REFERENCES teacher_absences(id) ON DELETE CASCADE NOT NULL,
  timetable_period_id uuid REFERENCES timetable_periods(id) ON DELETE CASCADE NOT NULL,
  substitute_teacher_id uuid REFERENCES teachers(id),
  status text CHECK (status IN ('pending', 'assigned', 'cancelled')) DEFAULT 'pending',
  note text,
  assigned_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(absence_id, timetable_period_id)
);

CREATE INDEX idx_substitutions_absence ON substitutions(absence_id);
CREATE INDEX idx_substitutions_sub_teacher ON substitutions(substitute_teacher_id);
```

Why link to `timetable_period_id` (not `(class_id, period_number, day_of_week)`): one-hop join, and `ON DELETE CASCADE` cleans up if a period is ever removed. Cost: if the school edits the weekly timetable, historical substitutions lose context — accepted, because the admin cares about *today's* decision, and we can snapshot `class_id/period_number` into `substitutions` later if reporting demands it.

### RLS

Mirror the pattern used for `timetable_periods` (supabase-schema.sql:1418). Admins + editors with `teacher_substitutions` permission can SELECT/INSERT/UPDATE/DELETE.

### Append to supabase-schema.sql

Per memory rule: every new migration also appended to `supabase-schema.sql` in the same turn.

---

## Suggestion algorithm

Input: `absence_id` → resolves to `teacher_id`, `absence_date`, `half_day`.

**Step 1 — find affected periods.** From `timetable_periods` where `teacher_id = absent_teacher.id` and `day_of_week = EXTRACT(ISODOW FROM absence_date)`. Filter by half-day if applicable.

**Step 2 — for each affected period, find free teachers using time-overlap.** This is critical: classes run on staggered schedules (verified against the live DB on 2026-04-25 via `scripts/_check-period-times.mjs` — period 3 already shows two distinct end_times: 10:00 and 10:15). So `period_number` is *not* a reliable shared time key across classes. A teacher T is free during the affected slot `[S, E]` on day `D` if:

- `T.is_active = true`
- `T.id != absent_teacher.id`
- No row in `timetable_periods` where `teacher_id = T.id AND day_of_week = D AND time-range overlaps [S, E]`. The standard half-open overlap check: `existing.start_time < E AND existing.end_time > S`.
- No other `substitutions` row already assigning T to a different overlapping period on the same date (prevents double-booking a substitute when multiple teachers are absent simultaneously).

SQL shape (conceptual — actual query in API route):

```sql
SELECT t.id, t.full_name
FROM teachers t
WHERE t.is_active = true
  AND t.id != :absent_teacher_id
  AND NOT EXISTS (
    SELECT 1 FROM timetable_periods tp
    WHERE tp.teacher_id = t.id
      AND tp.day_of_week = :day_of_week
      AND tp.start_time < :end_time
      AND tp.end_time   > :start_time
  )
  AND NOT EXISTS (
    SELECT 1 FROM substitutions s
    JOIN timetable_periods tp2 ON tp2.id = s.timetable_period_id
    JOIN teacher_absences a ON a.id = s.absence_id
    WHERE s.substitute_teacher_id = t.id
      AND a.absence_date = :absence_date
      AND tp2.day_of_week = :day_of_week
      AND tp2.start_time < :end_time
      AND tp2.end_time   > :start_time
      AND s.status = 'assigned'
  );
```

This handles uniform schedules correctly too (overlap reduces to equality when periods are aligned), so there's no downside to using it universally.

**Step 3 — rank candidates.** Compute a score per free teacher:

| Signal | Weight | How |
|---|---|---|
| Teaches the same subject somewhere | +100 | `class_subjects.teacher_id = T.id AND subject_id = :target_subject_id` |
| Teaches the same class in any period | +30 | `timetable_periods.teacher_id = T.id AND class_id = :target_class_id` |
| Substitution load this week (fairness) | −10 × count | count `substitutions` where `substitute_teacher_id = T.id` and absence_date in current ISO week |
| Specialization text contains the subject name | +20 | `teachers.specialization ILIKE '%<subject>%'` — soft signal |

Return top N (e.g., 10) per period, with the score broken down so the admin sees *why* a teacher is suggested ("teaches Physics to 10-B" / "3 subs this week").

**Why ranking, not filtering:** a science teacher covering a history period is imperfect but better than no one. The admin makes the final call. The score surfaces the best option; it doesn't hide alternatives.

**Edge cases to handle explicitly:**
- The absent teacher has no periods that day → return empty list, UI shows "No classes scheduled."
- Every free teacher is already maxed on subs → show them anyway, let admin decide.
- The period is marked `is_break = true` → skip entirely.
- Multiple teachers absent the same day → Step 2's second `NOT EXISTS` clause handles mutual exclusion.

---

## API routes

All under `/src/app/api/erp/`. Auth: `verifyAdminOrEditor("teacher_substitutions")` on every handler.

### `/api/erp/teacher-timetable/route.ts`
- `GET ?teacher_id=<uuid>` → returns that teacher's weekly timetable (join `timetable_periods` + `classes` + `subjects`), grouped by `day_of_week`. Used by the teacher-centric view and as context on the absence page.

### `/api/erp/teacher-absences/route.ts`
- `GET ?date=YYYY-MM-DD` → all absences on that date with teacher info. `?teacher_id=&from=&to=` for history.
- `POST` — body: `{ teacher_id, absence_date, half_day?, reason? }`. Zod-validated. Returns the created absence + the affected periods (pre-computed so the UI can jump straight to the substitution picker).

### `/api/erp/teacher-absences/[id]/route.ts`
- `PATCH` — update reason/half_day.
- `DELETE` — cancels absence + cascades substitutions.

### `/api/erp/substitutions/suggest/route.ts`
- `GET ?absence_id=<uuid>` → returns `{ periods: [{ period, candidates: [{ teacher, score, reasons[] }] }] }`. This is the core suggestion endpoint.
- Pure read, but gated behind `verifyAdminOrEditor` since it reveals schedule data.

### `/api/erp/substitutions/route.ts`
- `POST` — body: `{ absence_id, timetable_period_id, substitute_teacher_id, note? }`. Creates/updates the substitution with `status='assigned'`. Upsert on `(absence_id, timetable_period_id)`.
- `GET ?date=YYYY-MM-DD` → all substitutions that day, for the daily printable sheet.

### `/api/erp/substitutions/[id]/route.ts`
- `PATCH` — change substitute or status.
- `DELETE` — unassign.

---

## Admin UI

### Sidebar (AdminSidebar.tsx:149)

Extend the existing standalone `Timetable` link into a group:

```
Timetable (group, icon: Clock)
├── Class Timetable       → /admin/timetable            (existing, keeps feature_key "timetable")
├── Teacher Timetable     → /admin/timetable/teachers   (new)
└── Substitutions         → /admin/timetable/substitutions (new)
```

Per the `sidebar_grouping` memory: never add new top-level entries; group under the existing parent.

### Pages

**`/admin/timetable/teachers`** — picker for a teacher + weekly grid. Each cell shows class/subject or "free". Secondary CTA on each day header: "Mark absent on <date>".

**`/admin/timetable/substitutions`** — date picker (defaults to today). Shows:
- Left column: absent teachers today (with "+ Mark teacher absent" button).
- Right column: for the selected absence, a list of their periods that day. Each period row shows class+subject, current substitute (if any), and a "Suggest substitute" action that opens a modal with the ranked candidates. Clicking a candidate assigns them.
- Bottom: "Print daily substitution sheet" button → server-rendered PDF listing every substitution for the day, grouped by period, for the staffroom noticeboard.

### Components to add
- `src/components/admin/timetable/TeacherWeekGrid.tsx`
- `src/components/admin/timetable/MarkAbsentDialog.tsx`
- `src/components/admin/timetable/SubstitutePickerDialog.tsx`
- `src/components/pdf/DailySubstitutionSheetPDF.tsx` (follows the existing PDF component pattern, e.g. `PtmFormatPDF.tsx`)

---

## Permissions

Add to `src/lib/permissions.ts`:

```ts
| "teacher_substitutions"
```

And to `FEATURE_CATALOG`:

```ts
{ key: "teacher_substitutions", label: "Substitutions", href: "/admin/timetable/substitutions", group: "erp" },
```

Reuse existing `"timetable"` key for the teacher-timetable view page (it's a read view of the same domain).

---

## Implementation order

- [x] 1. **Migration + schema mirror** — `migration-031-teacher-substitutions.sql` + append to `supabase-schema.sql`. Verify RLS. (Renumbered from 030 to avoid collision with an existing `migration-030-timetable-teacher-unique.sql`. Tables exist with all expected columns; CHECK + UNIQUE constraints verified empirically.)
- [x] 2. **Permissions wiring** — add `teacher_substitutions` key to `src/lib/permissions.ts` (do this early so middleware/sidebar auto-pick it up as we add pages).
- [x] 3. **API: teacher-timetable GET** — unblocks the teacher-centric view. Single-table read with joins.
- [x] 4. **UI: Teacher weekly grid page** (`/admin/timetable/teachers`). Ship read-only first.
- [x] 5. **API: teacher-absences GET/POST/PATCH/DELETE.**
- [x] 6. **UI: Mark-absent dialog** on the weekly grid, and absences list on the substitutions page.
- [x] 7. **API: substitutions/suggest** — the ranking algorithm with time-overlap check.
- [x] 8. **API: substitutions CRUD.**
- [x] 9. **UI: Substitute picker dialog** — wired to suggest endpoint.
- [x] 10. **UI: Substitutions page** (`/admin/timetable/substitutions`) — daily view, absent list, period rows, per-period sub assignment.
- [x] 11. **Sidebar group** — convert standalone `Timetable` link into a group with three children.
- [x] 12. **Daily substitution sheet PDF.**
- [x] 13. **Manual QA pass** — multi-absence day, half-day case, break periods, teacher with no classes, fairness tie-breaker. (Lint + `npm run build` pass; in-browser QA still owed by the user — see Review section for the punch list.)

---

## Open questions (decide before step 1)

- **Half-day cutoff.** Fixed (period ≤ 4 = first_half) or configurable per school day? Start fixed at `period_number ≤ 4` — make `half_day_cutoff_period` a constant in `src/lib/constants.ts` for now; promote to DB config if needed.
- **Notifications.** Should assigned substitutes get notified (in-app, email)? Out of scope for v1 — add to the `notifications` table later. Just show the printable daily sheet.
- **Teacher self-service.** Should teachers mark themselves absent? Out of scope for v1 — admin-only. Revisit when teacher logins are live.
- **Retroactive subs.** Can an admin record a substitution for a past date (e.g., end-of-day data entry)? Yes, no date restriction — many small schools do this.
- ~~**Period-number semantics across classes.**~~ **RESOLVED 2026-04-25.** Empirically staggered (P3 has two distinct end_times in the live DB). Algorithm uses time-range overlap (`start_time < E AND end_time > S`), not `period_number` matching. See Step 2 above.

---

## Out of scope (explicitly, for v1)

- Auto-assigning substitutes without admin confirmation.
- SMS/WhatsApp notifications.
- Substitute teacher acceptance/decline flow.
- Leave balance tracking (this is a planning tool, not an HR system).
- Generating the weekly timetable itself — assumed already maintained via `/admin/timetable`.

---

## Review (2026-04-25)

**Shipped:** all 13 implementation steps. `npm run build` passes (✓ Compiled successfully). The 8 new routes (2 pages + 6 API endpoints) are in the build manifest. Lint shows the same setState-in-effect warnings as the rest of the codebase — codebase-consistent, no new categories of violation.

**Files added/changed:**
- `scripts/migration-031-teacher-substitutions.sql` — `teacher_absences` + `substitutions` tables, indexes, triggers, RLS. Renumbered from 030 to avoid collision with the existing `migration-030-timetable-teacher-unique.sql`.
- `supabase-schema.sql` — appended the same DDL (per the schema-mirrors-migrations rule).
- `src/lib/permissions.ts` — added `teacher_substitutions` feature key + catalog entry.
- `src/lib/constants.ts` — added `HALF_DAY_CUTOFF_PERIOD = 4`.
- `src/app/api/erp/teacher-timetable/route.ts` — GET teacher's weekly schedule.
- `src/app/api/erp/teacher-absences/route.ts` + `[id]/route.ts` — GET/POST/PATCH/DELETE.
- `src/app/api/erp/substitutions/suggest/route.ts` — ranked candidate suggestions.
- `src/app/api/erp/substitutions/route.ts` + `[id]/route.ts` — upsert/list/delete substitution rows.
- `src/app/api/erp/substitutions/sheet/route.tsx` — daily PDF endpoint.
- `src/app/admin/timetable/teachers/page.tsx` — read-only teacher week view + day-header "Mark absent" CTA.
- `src/app/admin/timetable/substitutions/page.tsx` — daily view with absent list, per-period substitute assignment, print sheet.
- `src/components/admin/timetable/TeacherWeekGrid.tsx`
- `src/components/admin/timetable/MarkAbsentDialog.tsx`
- `src/components/admin/timetable/SubstitutePickerDialog.tsx`
- `src/components/pdf/DailySubstitutionSheetPDF.tsx`
- `src/components/admin/AdminSidebar.tsx` — converted standalone Timetable link into a group with three children.
- Helper scripts under `scripts/_*.mjs` for verifying schedules, table existence, and constraints.

**What I cannot test from the assistant side:** the actual UI flow in a browser (clicking through teacher → mark absent → assign substitute → download PDF). Type-check + build pass; the runtime behavior depends on the live DB and an authenticated browser session.

**Manual QA worth doing:**
- Pick a teacher with periods on multiple days; click "Mark absent" on a day header; confirm the date pre-fills to the next occurrence of that weekday.
- Mark someone absent on a day they teach; open the substitutions page; verify all their periods appear as rows. Click "Find substitute"; verify the candidate list ranks subject-matching teachers above subject-mismatched ones.
- Mark a half-day absence (first half) for a teacher whose schedule spans before and after period 4; verify only periods 1–4 appear in the substitution UI.
- Mark two different teachers absent on the same day, where their periods overlap in time; verify a substitute teacher assigned to one cannot also be suggested for the other's overlapping period.
- Click "Print sheet" on a day with at least one substitution; verify the PDF renders with assigned + unassigned sections.
- As an editor without `teacher_substitutions` permission, confirm `/admin/timetable/substitutions` is blocked and the sidebar entry is hidden.

**Known v1 imperfections (deliberate):**
- The "Mark absent" button on `/admin/timetable/teachers` only 401s for editors who have `timetable` permission but not `teacher_substitutions`. The page itself is gated by the broader `timetable` key. Acceptable since admins are typically the substitution operators; editors with `timetable` only can view teacher schedules but can't mark absent.
- No notifications to assigned substitutes (printable daily sheet is the v1 communication channel).
- No teacher self-service for marking themselves absent.
- Half-day cutoff is a hardcoded constant (`HALF_DAY_CUTOFF_PERIOD = 4`); promote to DB config if any school needs a different cutoff per day.
