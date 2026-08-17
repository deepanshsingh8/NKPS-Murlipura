-- Migration 084: restore student-data reads for the 'staff' role.
--
-- Migration 047 turned "editor" from a role into a capability: every profile
-- with role='editor' was backfilled to role='staff', and the CHECK constraint
-- was narrowed to (admin, staff, teacher, student, parent). So no row can hold
-- role='editor' any more.
--
-- 047 rewrote two policies that named the dead role ('profiles' and
-- 'student_remarks') but missed the rest. Policies still written as
--
--     USING (public.get_user_role() IN ('admin', 'editor'))
--
-- therefore match admins and nobody else. The visible symptom: a staff member
-- granted a feature (e.g. 'transport') passes the middleware page gate, the
-- page renders, and then every browser-side read of student data comes back
-- empty — RLS filters rows silently rather than erroring, so the UI shows its
-- "nothing found" empty state instead of a permission message.
--
-- Reported against /transport/assignments ("No enrollments found for the
-- active academic year"), but it hits every admin-area page that reads
-- students or enrollments through the browser client: attendance, exams,
-- results, fees, class tests, transport. Pages that read through an API route
-- were unaffected — those use the service-role client, which bypasses RLS.
--
-- Fix: grant the 'staff' role SELECT via ADDITIVE policies. RLS policies are
-- OR'd, so this restores the intent of the pre-047 'editor' grant without
-- having to know which historical policy names a given deployment carries
-- (the names differ between supabase-schema.sql and migration-erp-redesign).
--
-- Per-feature gating is unchanged and still happens in the application layer
-- (verifyAdminOrEditor / the middleware page gate). Consistent with 047's
-- stated design: "RLS stays role-coarse so policy bodies stay fast."
--
-- Deliberately NOT included: 'parents' and 'student_parents' carry the same
-- dead 'editor' reference, but no admin-area page reads them through the
-- browser client (only /parent/* pages, which match on their own policies,
-- and API routes, which bypass RLS). Left alone to avoid widening access to
-- guardian contact data for no working feature. Revisit if a staff-facing
-- screen ever needs them.
--
-- 'teachers' is not affected: teachers_select_authenticated already covers it.

begin;

-- ----- students -----
drop policy if exists "students_select_staff" on students;
create policy "students_select_staff"
  on students for select
  using (public.get_user_role() = 'staff');

-- ----- student_enrollments -----
-- Needed on top of students: the transport screen embeds students(...) under
-- an enrollments query, and PostgREST applies RLS to both the parent rows and
-- the embedded resource.
drop policy if exists "student_enrollments_select_staff" on student_enrollments;
create policy "student_enrollments_select_staff"
  on student_enrollments for select
  using (public.get_user_role() = 'staff');

commit;
