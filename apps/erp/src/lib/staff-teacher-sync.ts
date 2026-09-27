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
 *
 * `is_active` mirrors too, and that is load-bearing rather than cosmetic: it
 * used to be staff-only, so deactivating someone on People → Staff hid them
 * from the staff page while leaving their teacher row active in every teacher
 * dropdown in the ERP. (migration 116)
 */

const FIELDS_FROM_STAFF: Array<[staff: string, teacher: string]> = [
  ["name", "full_name"],
  ["email", "email"],
  ["phone", "phone"],
  ["date_of_birth", "date_of_birth"],
  ["address", "address"],
  ["qualifications", "qualifications"],
  ["photo_url", "photo_url"],
  ["is_active", "is_active"],
];

const FIELDS_FROM_TEACHER: Array<[teacher: string, staff: string]> = [
  ["full_name", "name"],
  ["email", "email"],
  ["phone", "phone"],
  ["date_of_birth", "date_of_birth"],
  ["address", "address"],
  ["qualifications", "qualifications"],
  ["photo_url", "photo_url"],
  ["is_active", "is_active"],
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
      "id, name, email, phone, date_of_birth, address, qualifications, photo_url, is_active"
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
    .select("id, is_active, date_of_leaving")
    .eq("staff_member_id", staffId);
  if (!teachers || teachers.length === 0) return;

  const patch: Record<string, unknown> = {};
  for (const [staffField, teacherField] of FIELDS_FROM_STAFF) {
    patch[teacherField] = (staff as Record<string, unknown>)[staffField];
  }
  patch.updated_at = new Date().toISOString();

  for (const t of teachers) {
    // Stamp the leaving date on the transition into inactive, and only then:
    // re-mirroring an already-retired teacher must not keep moving the date,
    // and reactivating must not silently erase when they previously left.
    const perTeacher = { ...patch };
    if (staff.is_active === false && t.is_active !== false && !t.date_of_leaving) {
      perTeacher.date_of_leaving = new Date().toISOString().slice(0, 10);
    }
    const { error: updateErr } = await admin
      .from("teachers")
      .update(perTeacher)
      .eq("id", t.id);
    if (updateErr) {
      console.error("[staff-teacher-sync] mirror staff→teacher:", updateErr);
    }
  }
}

/**
 * Retire the teacher(s) linked to a staff member that is about to be deleted.
 *
 * Must run BEFORE the staff_members row goes, while the link still exists —
 * `teachers.staff_member_id` is ON DELETE SET NULL, so after the delete there
 * is nothing left to find the teacher by. Skipping this is exactly how the
 * ghost teachers arose: staff deleted, teacher row left active and unreachable
 * from any ERP screen, still populating every teacher dropdown. (migration 116)
 *
 * Retiring rather than deleting is deliberate. `timetable_periods.teacher_id`
 * and `class_subjects.teacher_id` have no ON DELETE rule, so a delete would
 * fail with 23503 for any teacher who has ever been timetabled — and if it did
 * succeed it would erase who taught what.
 *
 * Errors are logged, never thrown: a sync lapse must not block the staff
 * deletion the admin asked for.
 */
export async function retireTeacherForStaff(
  admin: SupabaseClient,
  staffIds: string | string[],
  reason = "Staff record deleted"
): Promise<void> {
  const ids = Array.isArray(staffIds) ? staffIds : [staffIds];
  if (ids.length === 0) return;

  const { data: teachers, error } = await admin
    .from("teachers")
    .select("id, is_active, date_of_leaving")
    .in("staff_member_id", ids);
  if (error) {
    console.error("[staff-teacher-sync] load teachers to retire:", error);
    return;
  }
  if (!teachers || teachers.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  for (const t of teachers) {
    const { error: updateErr } = await admin
      .from("teachers")
      .update({
        is_active: false,
        date_of_leaving: t.date_of_leaving ?? today,
        leaving_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", t.id);
    if (updateErr) {
      console.error("[staff-teacher-sync] retire teacher:", updateErr);
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
      "id, full_name, email, phone, date_of_birth, address, qualifications, photo_url, is_active, staff_member_id"
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
      "id, name, email, phone, date_of_birth, address, qualifications, photo_url, is_active"
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
      // Carry the staff row's active state rather than defaulting to true —
      // promoting an already-deactivated staff member must not resurrect them
      // into every teacher dropdown. (migration 116)
      is_active: staff.is_active ?? true,
      staff_member_id: staff.id,
    })
    .select("id")
    .single();
  if (insertErr || !teacherRow) {
    // A concurrent provisioning action (auto-create-on-add + "Convert to
    // teacher") can win the race between our select above and this insert.
    // The partial unique index on teachers(staff_member_id) (migration 083)
    // then rejects our insert with 23505 — recover by re-selecting the row the
    // other action created so the operation stays idempotent. (Audit #31.)
    if (insertErr?.code === "23505") {
      const { data: raced } = await admin
        .from("teachers")
        .select("id")
        .eq("staff_member_id", staffId)
        .maybeSingle();
      if (raced) return { teacher_id: raced.id as string, created: false };
    }
    console.error("[staff-teacher-sync] create teacher:", insertErr);
    return { error: "Failed to create teacher record" };
  }
  return { teacher_id: teacherRow.id as string, created: true };
}
