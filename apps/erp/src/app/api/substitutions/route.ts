import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";

const upsertSchema = z.object({
  absence_id: z.string().uuid(),
  timetable_period_id: z.string().uuid(),
  substitute_teacher_id: z.string().uuid(),
  note: z.string().max(500).nullable().optional(),
});

// GET /api/substitutions?date=YYYY-MM-DD
//   Daily list for the staffroom-noticeboard sheet. Joins absence + period +
//   substitute info in one shot.
//
// GET /api/substitutions?absence_id=<uuid>
//   All substitutions for a single absence (used by the substitutions UI to
//   refresh after assignment).
export async function GET(request: NextRequest) {
  const ctx = await verifyAdminOrEditorWithUser("teacher_substitutions");
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = ctx;

  const { searchParams } = request.nextUrl;
  const date = searchParams.get("date");
  const absenceId = searchParams.get("absence_id");

  let query = admin.from("substitutions").select(
    `
      id, absence_id, timetable_period_id, substitute_teacher_id, note,
      created_at, updated_at,
      teacher_absences!inner(
        id, absence_date, half_day, reason,
        teacher:teachers!teacher_absences_teacher_id_fkey(id, full_name, employee_id)
      ),
      timetable_periods(
        id, day_of_week, period_number, start_time, end_time, room,
        classes(id, name, section),
        subjects(id, name, code)
      ),
      substitute:teachers!substitutions_substitute_teacher_id_fkey(id, full_name, employee_id)
    `
  );

  if (date) query = query.eq("teacher_absences.absence_date", date);
  if (absenceId) query = query.eq("absence_id", absenceId);

  const { data, error } = await query;
  if (error) {
    console.error("[substitutions.GET] list:", error);
    return NextResponse.json({ error: "Failed to load substitutions" }, { status: 500 });
  }

  // Sort by start_time client-side since PostgREST can't order by joined cols.
  const sorted = (data ?? []).slice().sort((a, b) => {
    const ta = (a.timetable_periods as { start_time?: string } | null)?.start_time ?? "";
    const tb = (b.timetable_periods as { start_time?: string } | null)?.start_time ?? "";
    return ta.localeCompare(tb);
  });
  return NextResponse.json({ data: sorted });
}

// POST upserts on (absence_id, timetable_period_id). Re-assigning a different
// substitute to the same period replaces the previous row.
export async function POST(request: NextRequest) {
  const ctx = await verifyAdminOrEditorWithUser("teacher_substitutions");
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = ctx;

  const body = await request.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Defensive: confirm the timetable_period actually belongs to the absent
  // teacher's day. A POST with a mismatched (absence_id, timetable_period_id)
  // shouldn't be possible from the UI, but an attacker could craft one — and
  // a mismatched row would silently break the daily sheet.
  const [{ data: absence }, { data: period }] = await Promise.all([
    admin
      .from("teacher_absences")
      .select("teacher_id, absence_date, half_day")
      .eq("id", parsed.data.absence_id)
      .single(),
    admin
      .from("timetable_periods")
      .select("teacher_id, day_of_week")
      .eq("id", parsed.data.timetable_period_id)
      .single(),
  ]);
  if (!absence) {
    return NextResponse.json({ error: "Absence not found" }, { status: 404 });
  }
  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  if (period.teacher_id !== absence.teacher_id) {
    return NextResponse.json(
      { error: "That period does not belong to the absent teacher." },
      { status: 400 }
    );
  }

  // upsert on UNIQUE(absence_id, timetable_period_id).
  const { data, error } = await admin
    .from("substitutions")
    .upsert(
      {
        absence_id: parsed.data.absence_id,
        timetable_period_id: parsed.data.timetable_period_id,
        substitute_teacher_id: parsed.data.substitute_teacher_id,
        note: parsed.data.note ?? null,
        assigned_by: user.id,
      },
      { onConflict: "absence_id,timetable_period_id" }
    )
    .select(
      "id, absence_id, timetable_period_id, substitute_teacher_id, note, created_at, updated_at, substitute:teachers!substitutions_substitute_teacher_id_fkey(id, full_name)"
    )
    .single();
  if (error) {
    console.error("[substitutions.POST] upsert:", error);
    return NextResponse.json({ error: "Failed to assign substitution" }, { status: 500 });
  }
  return NextResponse.json({ data });
}
