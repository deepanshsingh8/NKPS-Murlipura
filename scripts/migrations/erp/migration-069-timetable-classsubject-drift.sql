-- Migration 069: Surface teacher-assignment drift between timetable & class_subjects
--
-- Decision (Phase 3): `class_subjects` is the CANONICAL authority for "which
-- teacher teaches which subject in which class" — it's what teacher-scope.ts
-- and the RLS get_my_class_ids() helper read. `timetable_periods` is the
-- schedule and can drift (a period assigned to a different teacher than the
-- subject's class_subjects.teacher_id), which would let the timetable show one
-- teacher while scope/authorization uses another.
--
-- This view makes that drift observable so it can be reconciled. It does NOT
-- auto-rewrite timetable rows — period-level cover/substitution is sometimes
-- legitimate; the admin decides. Read-only, safe to apply on a live DB.

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
    AND tp.teacher_id IS DISTINCT FROM cs.teacher_id;

COMMENT ON VIEW public.timetable_assignment_drift IS
  'Timetable periods whose teacher differs from the canonical class_subjects '
  'assignment for the same (class, subject). class_subjects is authoritative '
  '(migration 069); rows here are drift to reconcile (or legitimate cover).';
