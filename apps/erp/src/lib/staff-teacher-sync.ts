import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Field mapping between `staff_members` (the public website's staff listing)
 * and `teachers` (the ERP's teacher entity).
 *
 * `staff_members.name` ⇄ `teachers.full_name`
 * `staff_members.subject`         is staff-only (drives the "what they teach"
 *                                 display on the public site; teachers don't
 *                                 carry a single-string subject).
 * `staff_members.category`        is staff-only (taxonomy for the staff page).
 *
 * The rest of the contact / personal fields mirror 1:1.
 */

const FIELDS_FROM_STAFF: Array<[staff: string, teacher: string]> = [
  ["name", "full_name"],
  ["email", "email"],
  ["phone", "phone"],
  ["date_of_birth", "date_of_birth"],
  ["address", "address"],
  ["qualifications", "qualifications"],
  ["photo_url", "photo_url"],
];

const FIELDS_FROM_TEACHER: Array<[teacher: string, staff: string]> = [
  ["full_name", "name"],
  ["email", "email"],
  ["phone", "phone"],
  ["date_of_birth", "date_of_birth"],
  ["address", "address"],
  ["qualifications", "qualifications"],
  ["photo_url", "photo_url"],
];

/**
 * After a staff_members write, push the mirrored fields into the linked
 * teachers row (if any). Failures are logged and never block the original
 * write — the staff side is the user-facing source of truth, and a sync
 * lapse only causes the ERP teacher record to be slightly stale.
 */
export async function mirrorStaffToTeacher(
  admin: SupabaseClient,
  staffId: string
): Promise<void> {
  const { data: staff, error } = await admin
    .from("staff_members")
    .select(
      "id, name, email, phone, date_of_birth, address, qualifications, photo_url"
    )
    .eq("id", staffId)
    .maybeSingle();
  if (error || !staff) {
    if (error) console.error("[staff-teacher-sync] load staff:", error);
    return;
  }

  // Find any teacher linked to this staff_member. If there are multiple
  // (shouldn't happen per design but the FK doesn't enforce uniqueness),
  // mirror to all of them.
  const { data: teachers } = await admin
    .from("teachers")
    .select("id")
    .eq("staff_member_id", staffId);
  if (!teachers || teachers.length === 0) return;

  const patch: Record<string, unknown> = {};
  for (const [staffField, teacherField] of FIELDS_FROM_STAFF) {
    patch[teacherField] = (staff as Record<string, unknown>)[staffField];
  }
  patch.updated_at = new Date().toISOString();

  for (const t of teachers) {
    const { error: updateErr } = await admin
      .from("teachers")
      .update(patch)
      .eq("id", t.id);
    if (updateErr) {
      console.error("[staff-teacher-sync] mirror staff→teacher:", updateErr);
    }
  }
}

/**
 * Reverse direction — after a teachers write, mirror to the linked staff_members
 * row. Same error semantics as mirrorStaffToTeacher.
 */
export async function mirrorTeacherToStaff(
  admin: SupabaseClient,
  teacherId: string
): Promise<void> {
  const { data: teacher, error } = await admin
    .from("teachers")
    .select(
      "id, full_name, email, phone, date_of_birth, address, qualifications, photo_url, staff_member_id"
    )
    .eq("id", teacherId)
    .maybeSingle();
  if (error || !teacher || !teacher.staff_member_id) {
    if (error) console.error("[staff-teacher-sync] load teacher:", error);
    return;
  }

  const patch: Record<string, unknown> = {};
  for (const [teacherField, staffField] of FIELDS_FROM_TEACHER) {
    patch[staffField] = (teacher as Record<string, unknown>)[teacherField];
  }
  patch.updated_at = new Date().toISOString();

  const { error: updateErr } = await admin
    .from("staff_members")
    .update(patch)
    .eq("id", teacher.staff_member_id);
  if (updateErr) {
    console.error("[staff-teacher-sync] mirror teacher→staff:", updateErr);
  }
}

/**
 * Promote a staff_members row to also exist as a teacher (linked via the
 * `staff_member_id` FK). Returns the teacher row id (existing or newly
 * created). Idempotent: if a linked teacher already exists, no-ops and
 * returns that teacher's id.
 */
export async function promoteStaffToTeacher(
  admin: SupabaseClient,
  staffId: string
): Promise<{ teacher_id: string; created: boolean } | { error: string }> {
  const { data: staff } = await admin
    .from("staff_members")
    .select(
      "id, name, email, phone, date_of_birth, address, qualifications, photo_url"
    )
    .eq("id", staffId)
    .maybeSingle();
  if (!staff) return { error: "Staff member not found" };

  const { data: existing } = await admin
    .from("teachers")
    .select("id")
    .eq("staff_member_id", staffId)
    .maybeSingle();
  if (existing) return { teacher_id: existing.id as string, created: false };

  // Auto-generate an employee_id. We pair the 36-base timestamp with 4 hex
  // chars from crypto.randomBytes so the suffix can't collide within the
  // same millisecond — the schema makes employee_id UNIQUE and the previous
  // ts-only form would 23505 a parallel admin action. (Audit L10.)
  const { randomBytes } = await import("crypto");
  const employeeId = `TCH-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;

  const { data: teacherRow, error: insertErr } = await admin
    .from("teachers")
    .insert({
      employee_id: employeeId,
      full_name: staff.name,
      email: staff.email,
      phone: staff.phone,
      date_of_birth: staff.date_of_birth,
      address: staff.address,
      qualifications: staff.qualifications,
      photo_url: staff.photo_url,
      staff_member_id: staff.id,
    })
    .select("id")
    .single();
  if (insertErr || !teacherRow) {
    console.error("[staff-teacher-sync] create teacher:", insertErr);
    return { error: "Failed to create teacher record" };
  }
  return { teacher_id: teacherRow.id as string, created: true };
}
