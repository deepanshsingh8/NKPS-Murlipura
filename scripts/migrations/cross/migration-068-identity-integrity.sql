-- Migration 068: Identity & cross-role linking integrity (cross: base profiles + ERP domain)
--
-- Root cause of the "linking parent to ward did not work" incident: a profile
-- could exist as role='parent' with parent_id = NULL (and the same for teacher),
-- linking was done by 5 independent code paths, there was no 1:1 guarantee
-- between an auth account and a domain record, and nothing surfaced the broken
-- state. This migration installs the integrity FLOOR that the linking service
-- (Phase 1) and the admin reconciliation surface (Phase 2) build on.
--
-- It is a `cross` migration because it constrains `profiles` (base) using its
-- FKs into teachers/students/parents and student_parents (ERP). It is only
-- meaningful on a full ERP deployment.
--
-- SAFE TO APPLY ON A LIVE DB:
--   * The role↔link trigger fires only on INSERT and on UPDATEs that actually
--     change role or a link column, so it never rejects unrelated edits to
--     existing orphan rows and never fails on apply.
--   * The UNIQUE link indexes are guarded by a pre-check that raises a clear,
--     itemised error (pointing at profile_link_health) if duplicate claims
--     exist, instead of failing with an opaque index-build error. Resolve the
--     duplicates, then re-run — the whole file is idempotent.
--
-- Composes with migration 061: that guard blocks NON-privileged callers from
-- touching role/link columns at all; this migration constrains WHAT the
-- privileged (admin / service-role) linking paths are allowed to commit.

-- ============================================================
-- 0.1 / 0.2 — Observability: link-health view
-- ============================================================
-- One row per anomaly. `category` partitions errors from informational signals:
--   ERROR (must fix): orphaned_profile, role_link_mismatch, duplicate_*_claim
--   INFO  (expected, surfaced for onboarding): unclaimed_student,
--         parent_without_children, student_without_guardian_account
CREATE OR REPLACE VIEW public.profile_link_health AS
  -- role demands a link but it is NULL (the incident class: parent/teacher)
  SELECT 'orphaned_profile'::text AS category,
         p.id::text               AS subject_id,
         COALESCE(p.full_name, p.email) AS subject_label,
         ('role=' || p.role || ' but ' || p.role || '_id is NULL') AS detail
  FROM public.profiles p
  WHERE (p.role = 'teacher' AND p.teacher_id IS NULL)
     OR (p.role = 'parent'  AND p.parent_id  IS NULL)

  UNION ALL
  -- a student account that has not yet claimed its student record (self-claim
  -- model — expected for fresh accounts, informational)
  SELECT 'unclaimed_student', p.id::text, COALESCE(p.full_name, p.email),
         'role=student but student_id is NULL (awaiting self-link)'
  FROM public.profiles p
  WHERE p.role = 'student' AND p.student_id IS NULL

  UNION ALL
  -- a non-null link that does not match the profile's role (admin may also hold
  -- a teacher_id when a head/principal teaches; everything else is a mismatch)
  SELECT 'role_link_mismatch', p.id::text, COALESCE(p.full_name, p.email),
         'non-null link inconsistent with role=' || p.role
  FROM public.profiles p
  WHERE (p.student_id IS NOT NULL AND p.role <> 'student')
     OR (p.parent_id  IS NOT NULL AND p.role <> 'parent')
     OR (p.teacher_id IS NOT NULL AND p.role NOT IN ('teacher', 'admin'))

  UNION ALL
  -- two or more accounts claiming the same teacher record
  SELECT 'duplicate_teacher_claim', p.teacher_id::text, t.full_name,
         count(*) || ' accounts linked to this teacher record'
  FROM public.profiles p JOIN public.teachers t ON t.id = p.teacher_id
  WHERE p.teacher_id IS NOT NULL
  GROUP BY p.teacher_id, t.full_name HAVING count(*) > 1

  UNION ALL
  -- two or more accounts claiming the same student record
  SELECT 'duplicate_student_claim', p.student_id::text, s.full_name,
         count(*) || ' accounts linked to this student record'
  FROM public.profiles p JOIN public.students s ON s.id = p.student_id
  WHERE p.student_id IS NOT NULL
  GROUP BY p.student_id, s.full_name HAVING count(*) > 1

  UNION ALL
  -- two or more accounts claiming the same parent record
  SELECT 'duplicate_parent_claim', p.parent_id::text, pa.full_name,
         count(*) || ' accounts linked to this parent record'
  FROM public.profiles p JOIN public.parents pa ON pa.id = p.parent_id
  WHERE p.parent_id IS NOT NULL
  GROUP BY p.parent_id, pa.full_name HAVING count(*) > 1

  UNION ALL
  -- an active parent record with no children linked (orphaned guardian record)
  SELECT 'parent_without_children', pa.id::text, pa.full_name,
         'active parent record has no student_parents links'
  FROM public.parents pa
  WHERE COALESCE(pa.is_active, true)
    AND NOT EXISTS (SELECT 1 FROM public.student_parents sp WHERE sp.parent_id = pa.id)

  UNION ALL
  -- an active, non-alumni student whose guardians have no portal account yet
  -- (onboarding signal — the parent can't see results/fees until they sign up)
  SELECT 'student_without_guardian_account', s.id::text, s.full_name,
         'active student has no linked parent with a portal account'
  FROM public.students s
  WHERE COALESCE(s.is_active, true) AND NOT COALESCE(s.is_alumni, false)
    AND NOT EXISTS (
      SELECT 1 FROM public.student_parents sp
      JOIN public.profiles p ON p.parent_id = sp.parent_id
      WHERE sp.student_id = s.id
    );

COMMENT ON VIEW public.profile_link_health IS
  'Cross-role linking anomalies. ERROR categories (orphaned_profile, '
  'role_link_mismatch, duplicate_*_claim) must be resolved; INFO categories '
  '(unclaimed_student, parent_without_children, student_without_guardian_account) '
  'are onboarding signals. Read via GET /api/admin/link-health.';

-- ============================================================
-- 0.3 — Enforce 1:1 between an auth account and a domain record
-- ============================================================
-- Pre-flight: refuse to build UNIQUE indexes if duplicate claims exist, with a
-- clear, actionable message instead of an opaque "could not create unique index".
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT teacher_id FROM public.profiles WHERE teacher_id IS NOT NULL
      GROUP BY teacher_id HAVING count(*) > 1
    UNION ALL
    SELECT student_id FROM public.profiles WHERE student_id IS NOT NULL
      GROUP BY student_id HAVING count(*) > 1
    UNION ALL
    SELECT parent_id  FROM public.profiles WHERE parent_id  IS NOT NULL
      GROUP BY parent_id  HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce 1:1 link uniqueness: % duplicate claim(s) exist. '
      'Run  SELECT * FROM public.profile_link_health WHERE category LIKE ''duplicate%%'';  '
      'resolve them (unlink the wrong account), then re-run this migration.',
      dup_count;
  END IF;
END $$;

-- Replace the plain partial indexes (migration 001 / erp-redesign) with UNIQUE
-- partial indexes. Same WHERE clause, so they still serve the lookup queries.
DROP INDEX IF EXISTS idx_profiles_teacher_id;
DROP INDEX IF EXISTS idx_profiles_student_id;
DROP INDEX IF EXISTS idx_profiles_parent_id;

CREATE UNIQUE INDEX idx_profiles_teacher_id
  ON public.profiles(teacher_id) WHERE teacher_id IS NOT NULL;
CREATE UNIQUE INDEX idx_profiles_student_id
  ON public.profiles(student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX idx_profiles_parent_id
  ON public.profiles(parent_id) WHERE parent_id IS NOT NULL;

-- ============================================================
-- 0.4 — Enforce role ↔ link consistency
-- ============================================================
-- Invariants (the linking service in Phase 1 sets role + link in ONE update,
-- so it always satisfies these):
--   role='teacher' ⇒ teacher_id IS NOT NULL
--   role='parent'  ⇒ parent_id  IS NOT NULL
--   role='student' ⇒ student_id MAY be NULL (self-claim model)
--   a non-null link must match the role (admins may also hold a teacher_id)
--   admin/staff carry no student_id/parent_id
--
-- NOT exempt for service-role: a buggy server path that sets role='parent'
-- without a parent_id SHOULD fail loudly — that is the whole point.
CREATE OR REPLACE FUNCTION public.enforce_profile_role_link()
RETURNS TRIGGER AS $$
BEGIN
  -- On UPDATE, skip when neither role nor any link column changed, so routine
  -- edits (phone, avatar) to a pre-existing anomalous row are never blocked —
  -- only attempts to commit/keep an inconsistent role+link combination are.
  IF TG_OP = 'UPDATE'
     AND NEW.role       IS NOT DISTINCT FROM OLD.role
     AND NEW.teacher_id IS NOT DISTINCT FROM OLD.teacher_id
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
     AND NEW.parent_id  IS NOT DISTINCT FROM OLD.parent_id THEN
    RETURN NEW;
  END IF;

  IF NEW.role = 'teacher' AND NEW.teacher_id IS NULL THEN
    RAISE EXCEPTION 'profile %: role=teacher requires teacher_id (use the linking service)', NEW.id;
  END IF;
  IF NEW.role = 'parent' AND NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'profile %: role=parent requires parent_id (use the linking service)', NEW.id;
  END IF;

  IF NEW.student_id IS NOT NULL AND NEW.role <> 'student' THEN
    RAISE EXCEPTION 'profile %: student_id set but role=% (must be student)', NEW.id, NEW.role;
  END IF;
  IF NEW.parent_id IS NOT NULL AND NEW.role <> 'parent' THEN
    RAISE EXCEPTION 'profile %: parent_id set but role=% (must be parent)', NEW.id, NEW.role;
  END IF;
  IF NEW.teacher_id IS NOT NULL AND NEW.role NOT IN ('teacher', 'admin') THEN
    RAISE EXCEPTION 'profile %: teacher_id set but role=% (must be teacher or admin)', NEW.id, NEW.role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_profile_role_link ON public.profiles;
CREATE TRIGGER enforce_profile_role_link
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_role_link();

-- ============================================================
-- 0.5 — Single source of truth for the parent↔ward relationship
-- ============================================================
-- student_parents.relationship is the authoritative per-link relationship
-- (a person can be 'father' to one child and 'guardian' to another).
-- parents.relationship is now deprecated: kept for backward compatibility but
-- no longer written by the linking service and not read by the app.
COMMENT ON COLUMN public.parents.relationship IS
  'DEPRECATED (migration 068). The authoritative relationship lives per-link in '
  'student_parents.relationship. This column is retained only for backward '
  'compatibility and must not be read by application code.';
