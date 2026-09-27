-- Migration 119 — parallel teaching groups in one timetable period.
--
-- ── What the school asked for ───────────────────────────────────────────────
-- "In games period there are two or more teachers in the field along with
-- students of different classes as well as of different interests… three
-- different groups are made — basketball students from class 6 to 7, and
-- similar two more groups as badminton and cricket. Is it possible to fix
-- multiple teachers names in one column of games of different classes."
--
-- And the same shape again in XI/XII: "optional subjects 5 and 6 are taken by
-- two different teachers in a particular period — I.P. and P.Ed., Music and
-- Painting, Biology and Mathematics."
--
-- One cell, several parallel (subject, teacher, group) tracks.
--
-- ── Why a row per group, not a child table ──────────────────────────────────
-- The obvious design is a child table hanging off the period. It was designed,
-- audited against every consumer, and rejected: a co-teacher living in a child
-- table is invisible to every `.eq("teacher_id", …)` query in the ERP, and
-- there are twelve. Until each is rewritten the failures are silent —
-- api/teacher-absences returns "no affected periods" for an absent co-teacher
-- so no substitute is ever arranged; substitution-availability green-lights a
-- substitute who is genuinely double-booked; the substitution sheet maps one
-- teacher per period and drops the second.
--
-- Making each group its own row means teacher_id is already per-group, and all
-- of that keeps working as written.
--
-- ── The shared-activity escape ──────────────────────────────────────────────
-- Migration 071 added an exclusion constraint: a teacher cannot occupy two
-- time-overlapping periods on the same weekday. That is exactly right for
-- ordinary teaching and exactly wrong for games — the basketball coach IS on
-- the field for VI-A, VI-B, VII-A and VII-B at once, which is four overlapping
-- rows. `is_shared` marks a cell as a combined activity and exempts it. It is a
-- deliberate per-cell admin choice, ordinary cells keep the hard guarantee, and
-- the companion view below keeps what the constraint no longer blocks visible.
--
-- SAFE TO RE-RUN.

BEGIN;

-- Every object below is public-qualified, and the path is pinned as well: a
-- session whose search_path puts another schema first would otherwise add the
-- columns to a different table of the same name, and the migration would
-- report success while the app still saw nothing. (Diagnosed the hard way.)
SET LOCAL search_path = public;

-- ─── 1. The columns ─────────────────────────────────────────────────────────

ALTER TABLE public.timetable_periods
  ADD COLUMN IF NOT EXISTS group_no    smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS group_label text,
  ADD COLUMN IF NOT EXISTS is_shared   boolean  NOT NULL DEFAULT false;

COMMENT ON COLUMN public.timetable_periods.group_no IS
  'Which parallel track within the cell. 0 is the primary group — every row '
  'that existed before migration 119 is one — and 1,2,… are the extra groups '
  'that make a Games or optional-subject period.';
COMMENT ON COLUMN public.timetable_periods.group_label IS
  'What this group actually is, when the subject does not say it: '
  '"Basketball", "Badminton", "Cricket".';
COMMENT ON COLUMN public.timetable_periods.is_shared IS
  'A combined activity running across several classes at once. Exempts the row '
  'from the teacher double-booking constraint, because a games coach genuinely '
  'is with four classes simultaneously.';

-- ─── 2. One row per cell becomes one row per (cell, group) ──────────────────
-- The old constraint was declared inline as UNIQUE(...), so Postgres auto-named
-- it. Find it by its COLUMNS rather than trusting a spelling.

DO $$
DECLARE c text;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.timetable_periods'::regclass
    AND con.contype = 'u'
    AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
         FROM unnest(con.conkey) k
         JOIN pg_attribute att
           ON att.attrelid = con.conrelid AND att.attnum = k)
        = ARRAY['class_id','day_of_week','period_number'];
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.timetable_periods DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.timetable_periods
  DROP CONSTRAINT IF EXISTS timetable_periods_cell_group_key;
ALTER TABLE public.timetable_periods
  ADD CONSTRAINT timetable_periods_cell_group_key
  UNIQUE (class_id, day_of_week, period_number, group_no);

-- …but still exactly one PRIMARY group per cell, so the old invariant survives
-- for every reader that assumes a cell has one main row.
CREATE UNIQUE INDEX IF NOT EXISTS timetable_periods_primary_group_uniq
  ON public.timetable_periods(class_id, day_of_week, period_number)
  WHERE group_no = 0;

-- ─── 3. Let a shared activity span classes ──────────────────────────────────
-- Migration 071's constraint, re-stated with the is_shared exemption. Rebuilt
-- rather than altered because a predicate cannot be changed in place.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.timetable_periods
  DROP CONSTRAINT IF EXISTS timetable_teacher_no_overlap;
ALTER TABLE public.timetable_periods
  ADD CONSTRAINT timetable_teacher_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    day_of_week WITH =,
    tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) WITH &&
  ) WHERE (
    teacher_id IS NOT NULL
    AND is_break IS NOT TRUE
    AND start_time < end_time
    AND is_shared IS NOT TRUE
  );

-- ─── 4. Keep the exempted clashes visible ───────────────────────────────────
-- What the constraint no longer blocks is not thereby fine — it is just
-- deliberate. This view is how an admin checks that every remaining overlap is
-- one they meant.

CREATE OR REPLACE VIEW public.timetable_teacher_clashes AS
  SELECT a.teacher_id,
         t.full_name        AS teacher_name,
         a.day_of_week,
         a.id               AS period_a,
         ca.name || '-' || ca.section AS class_a,
         a.start_time       AS a_start,
         a.end_time         AS a_end,
         a.is_shared        AS a_shared,
         b.id               AS period_b,
         cb.name || '-' || cb.section AS class_b,
         b.start_time       AS b_start,
         b.end_time         AS b_end,
         b.is_shared        AS b_shared
  FROM public.timetable_periods a
  JOIN public.timetable_periods b
    ON a.teacher_id = b.teacher_id
   AND a.day_of_week = b.day_of_week
   AND a.id < b.id
  LEFT JOIN public.teachers t  ON t.id  = a.teacher_id
  LEFT JOIN public.classes  ca ON ca.id = a.class_id
  LEFT JOIN public.classes  cb ON cb.id = b.class_id
  WHERE a.teacher_id IS NOT NULL
    AND a.is_break IS NOT TRUE AND b.is_break IS NOT TRUE
    AND a.start_time < b.end_time
    AND a.end_time > b.start_time;

-- A view runs with its OWNER's rights, so it is not held back by the RLS on
-- timetable_periods and teachers. Both diagnostics below are keyed on a
-- teacher and would enumerate staff UUIDs, so say who may read them rather
-- than inheriting whatever the schema's default grants happen to be — the
-- leak migration 098 was written to close. Neither is read by app code; they
-- are for an admin querying the database.
REVOKE ALL ON public.timetable_teacher_clashes FROM PUBLIC, anon;
GRANT SELECT ON public.timetable_teacher_clashes TO authenticated;

COMMENT ON VIEW public.timetable_teacher_clashes IS
  'Teachers occupying two time-overlapping periods on one weekday. The DB '
  'constraint blocks these unless a row is marked is_shared, so in a healthy '
  'timetable every row here is an intentional combined activity. A row where '
  'neither side is shared is a bug.';

-- ─── 5. Stop the drift view crying wolf ─────────────────────────────────────
-- class_subjects holds ONE canonical teacher per (class, subject), so Games
-- VI-A taught by three coaches would leave two of them permanently reported as
-- drift. Only the primary group is comparable against the canonical assignment.

CREATE OR REPLACE VIEW public.timetable_assignment_drift AS
  SELECT tp.id              AS timetable_period_id,
         tp.class_id,
         c.name             AS class_name,
         c.section          AS class_section,
         tp.subject_id,
         s.name             AS subject_name,
         tp.day_of_week,
         tp.period_number,
         tp.teacher_id      AS timetable_teacher_id,
         tt.full_name       AS timetable_teacher_name,
         cs.teacher_id      AS canonical_teacher_id,
         ct.full_name       AS canonical_teacher_name
  FROM public.timetable_periods tp
  JOIN public.class_subjects cs
    ON cs.class_id = tp.class_id AND cs.subject_id = tp.subject_id
  LEFT JOIN public.classes  c  ON c.id  = tp.class_id
  LEFT JOIN public.subjects s  ON s.id  = tp.subject_id
  LEFT JOIN public.teachers tt ON tt.id = tp.teacher_id
  LEFT JOIN public.teachers ct ON ct.id = cs.teacher_id
  WHERE tp.is_break IS NOT TRUE
    -- migration 119: groups 1..n are parallel tracks with their own teachers.
    -- They differ from the canonical assignment by design, not by drift.
    AND tp.group_no = 0
    AND tp.teacher_id IS DISTINCT FROM cs.teacher_id;

REVOKE ALL ON public.timetable_assignment_drift FROM PUBLIC, anon;
GRANT SELECT ON public.timetable_assignment_drift TO authenticated;

COMMENT ON VIEW public.timetable_assignment_drift IS
  'Timetable periods whose teacher differs from the canonical class_subjects '
  'assignment for the same (class, subject). class_subjects is authoritative '
  '(migration 069); rows here are drift to reconcile (or legitimate cover). '
  'Only primary groups are compared — parallel groups (migration 119) have '
  'their own teachers by design.';

COMMIT;
