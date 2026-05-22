import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * §5 Elective 5 / Elective 6 management.
 *
 * GET  /api/electives                 → returns slot options + class XI/XII students with current selections
 * POST /api/electives/options         → admin: add a (slot, subject_id) row
 *  DEL /api/electives/options?id=…    → admin: remove a slot option
 * POST /api/electives/students        → admin: set a student's elective slot (creates/updates student_subjects)
 *  DEL /api/electives/students?id=…   → admin: clear an elective slot for a student
 *
 * Editor capability: gated by the `students` feature key (slot-option edits
 * fall under `subjects` — checked individually).
 */

export async function GET() {
  const admin = await verifyAdminOrEditor("students");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // 1) Slot options with subject details
  const { data: optionsData } = await admin
    .from("elective_slot_options")
    .select("id, slot, subject_id, label, sort_order, is_active, applies_to_classes, subjects(id, name, code, nickname, category, is_elective, is_active)")
    .eq("is_active", true)
    .order("slot")
    .order("sort_order");

  // 2) Current academic year + XI/XII enrollments with stream
  const { data: yearRow } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();

  const yearId = yearRow?.id ?? null;

  const { data: studentsRaw } = await admin
    .from("student_enrollments")
    .select(`
      id,
      student_id,
      class_id,
      stream_id,
      classes!inner(id, name, section),
      streams(id, name),
      students!inner(id, admission_no, full_name)
    `)
    .eq("academic_year_id", yearId ?? "00000000-0000-0000-0000-000000000000")
    .eq("status", "active")
    .in("classes.name", ["XI", "XII"]);

  // Sort client-side: class name (XI before XII), then section, then student name.
  // Supabase JS doesn't support .order() across foreign tables in a single chain.
  // Embedded resources can come back as object OR single-element array depending on the
  // FK relationship — handle both.
  type EmbedShape<T> = T | T[] | null;
  const pickOne = <T,>(x: EmbedShape<T>): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  const students = ([...(studentsRaw ?? [])] as unknown as Array<{
    student_id: string;
    classes: EmbedShape<{ name: string; section: string }>;
    students: EmbedShape<{ full_name: string }>;
  }>).sort((a, b) => {
    const ca = pickOne(a.classes); const cb = pickOne(b.classes);
    if ((ca?.name ?? "") !== (cb?.name ?? "")) return (ca?.name ?? "").localeCompare(cb?.name ?? "");
    if ((ca?.section ?? "") !== (cb?.section ?? "")) return (ca?.section ?? "").localeCompare(cb?.section ?? "");
    const sa = pickOne(a.students); const sb = pickOne(b.students);
    return (sa?.full_name ?? "").localeCompare(sb?.full_name ?? "");
  });

  // 3) Existing elective picks per student
  const studentIds = students.map((s) => s.student_id);
  let picks: Array<{ student_id: string; elective_slot: number; subject_id: string; subject_name: string }> = [];
  if (studentIds.length) {
    const { data: pickRows } = await admin
      .from("student_elective_picks")
      .select("student_id, slot, subject_id, subjects(id, name)")
      .in("student_id", studentIds);
    picks = (pickRows ?? []).map((r) => {
      const row = r as unknown as {
        student_id: string;
        slot: number;
        subject_id: string;
        subjects: { id: string; name: string } | { id: string; name: string }[] | null;
      };
      const subjRaw: { id: string; name: string } | null = !row.subjects
        ? null
        : Array.isArray(row.subjects)
          ? row.subjects[0] ?? null
          : row.subjects;
      return {
        student_id: row.student_id,
        elective_slot: row.slot,
        subject_id: row.subject_id,
        subject_name: subjRaw?.name ?? "Unknown",
      };
    });
  }

  return NextResponse.json({
    options: optionsData ?? [],
    students: students ?? [],
    picks,
  });
}
