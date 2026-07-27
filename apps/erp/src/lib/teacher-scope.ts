// Helpers that enforce a teacher's blast radius — i.e., the set of
// (class_id, subject_id) pairs they're allowed to operate on. ERP routes that
// accept a class_id / subject_id from the request must call one of these
// before any insert/update; otherwise a teacher with valid auth can mutate
// data for any class.
//
// All helpers take the *service-role* admin client because the underlying
// teacher_id mapping lives in `profiles.teacher_id`, which RLS otherwise
// hides from a teacher's own session. The admin client is safe here as long
// as the caller has already passed an auth check (we trust user.id, not
// arbitrary input).

import type { SupabaseClient } from "@supabase/supabase-js";

type AdminClient = SupabaseClient;

/**
 * Resolve `profiles.teacher_id` for a given user. Admins/editors don't have
 * a teacher_id — callers should detect role first.
 */
export async function getTeacherIdForUser(
  admin: AdminClient,
  userId: string
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("teacher_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  if (data.role !== "teacher") return null;
  return (data.teacher_id as string | null) ?? null;
}

/**
 * Check that a teacher actually teaches a given (class_id, subject_id) pair.
 * Used by results / class-test marks / non-scholastic entry routes.
 */
export async function teacherTeachesClassSubject(
  admin: AdminClient,
  teacherId: string,
  classId: string,
  subjectId: string
): Promise<boolean> {
  const { data } = await admin
    .from("class_subjects")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .maybeSingle();
  return !!data;
}

/**
 * Check that a teacher has any role for the given class — either as the
 * class teacher, or as the teacher of any subject in it. Used for
 * class-level operations like attendance and class-wide non-scholastic
 * grading where there isn't a single subject.
 */
export async function teacherCanAccessClass(
  admin: AdminClient,
  teacherId: string,
  classId: string
): Promise<boolean> {
  const { data: classRow } = await admin
    .from("classes")
    .select("id, class_teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (!classRow) return false;
  if (classRow.class_teacher_id === teacherId) return true;

  const { data: csRow } = await admin
    .from("class_subjects")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("class_id", classId)
    .limit(1)
    .maybeSingle();
  return !!csRow;
}

/**
 * The set of class_ids a teacher may operate on — class teacher OR subject
 * teacher (the same union RLS uses via get_my_class_ids). `class_subjects` is
 * the canonical authority for subject assignment (migration 069).
 */
export async function getTeacherClassIds(
  admin: AdminClient,
  teacherId: string
): Promise<string[]> {
  const [{ data: ctRows }, { data: csRows }] = await Promise.all([
    admin.from("classes").select("id").eq("class_teacher_id", teacherId),
    admin.from("class_subjects").select("class_id").eq("teacher_id", teacherId),
  ]);
  const ids = new Set<string>();
  for (const r of ctRows ?? []) ids.add(r.id as string);
  for (const r of csRows ?? []) ids.add(r.class_id as string);
  return [...ids];
}

/**
 * The set of student_ids a teacher may operate on — students actively enrolled
 * in any class in their scope. Used to authorize per-student writes (PTM notes)
 * that don't carry a class_id. Returns an empty set if the teacher has no scope.
 */
export async function getTeacherStudentIds(
  admin: AdminClient,
  teacherId: string
): Promise<Set<string>> {
  const classIds = await getTeacherClassIds(admin, teacherId);
  if (classIds.length === 0) return new Set();
  const { data } = await admin
    .from("student_enrollments")
    .select("student_id")
    .in("class_id", classIds)
    .eq("status", "active");
  return new Set((data ?? []).map((e) => e.student_id as string));
}
