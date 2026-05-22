import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { HALF_DAY_CUTOFF_PERIOD } from "@nkps/shared/lib/constants";

const halfDayValues = ["full", "first_half", "second_half"] as const;

const createSchema = z.object({
  teacher_id: z.string().uuid(),
  absence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "absence_date must be YYYY-MM-DD"),
  half_day: z.enum(halfDayValues).optional(),
  reason: z.string().max(500).nullable().optional(),
});

// 0=Sunday … 6=Saturday in JS getDay(). Our timetable_periods.day_of_week is
// 1=Monday … 6=Saturday (CHECK constraint in supabase-schema.sql:527).
function dayOfWeekFromIsoDate(yyyymmdd: string): number {
  // Treat the date as local-noon so DST shifts can't roll us into the wrong day.
  const d = new Date(`${yyyymmdd}T12:00:00`);
  const js = d.getDay();
  // Sunday → no school in this timetable model; return 0 (algorithm filters).
  return js;
}

// GET /api/teacher-absences
//   ?date=YYYY-MM-DD              → all absences on that date with teacher info
//   ?teacher_id=<uuid>            → all absences for one teacher (history)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD → range
export async function GET(request: NextRequest) {
  const ctx = await verifyAdminOrEditorWithUser("teacher_substitutions");
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = ctx;

  const { searchParams } = request.nextUrl;
  const date = searchParams.get("date");
  const teacherId = searchParams.get("teacher_id");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = admin
    .from("teacher_absences")
    .select(
      "id, teacher_id, absence_date, half_day, reason, marked_by, created_at, updated_at, teachers(id, full_name, employee_id)"
    )
    .order("absence_date", { ascending: false });

  if (date) query = query.eq("absence_date", date);
  if (teacherId) query = query.eq("teacher_id", teacherId);
  if (from) query = query.gte("absence_date", from);
  if (to) query = query.lte("absence_date", to);

  const { data, error } = await query;
  if (error) {
    console.error("[teacher-absences.GET] list:", error);
    return NextResponse.json({ error: "Failed to load teacher absences" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

// POST /api/teacher-absences
// Creates the absence row AND returns the affected periods (the timetable
// rows on absence_date for that teacher, filtered by half_day). One round-
// trip lets the UI jump straight into the substitution picker.
export async function POST(request: NextRequest) {
  const ctx = await verifyAdminOrEditorWithUser("teacher_substitutions");
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = ctx;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { teacher_id, absence_date, half_day, reason } = parsed.data;
  const finalHalfDay = half_day ?? "full";

  const { data: absence, error: insertErr } = await admin
    .from("teacher_absences")
    .insert({
      teacher_id,
      absence_date,
      half_day: finalHalfDay,
      reason: reason ?? null,
      marked_by: user.id,
    })
    .select(
      "id, teacher_id, absence_date, half_day, reason, marked_by, created_at, updated_at, teachers(id, full_name, employee_id)"
    )
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json(
        { error: "This teacher is already marked absent on that date." },
        { status: 409 }
      );
    }
    console.error("[teacher-absences.POST] insert:", insertErr);
    return NextResponse.json({ error: "Failed to create teacher absence" }, { status: 500 });
  }

  // Affected periods: this teacher's timetable_periods on the matching
  // weekday, filtered by half_day. Filter out is_break rows — substitutes
  // aren't needed for breaks.
  const dayOfWeek = dayOfWeekFromIsoDate(absence_date);
  let periodsQuery = admin
    .from("timetable_periods")
    .select(
      "id, day_of_week, period_number, start_time, end_time, room, is_break, classes(id, name, section), subjects(id, name, code)"
    )
    .eq("teacher_id", teacher_id)
    .eq("day_of_week", dayOfWeek)
    .eq("is_break", false)
    .order("start_time", { ascending: true });

  if (finalHalfDay === "first_half") {
    periodsQuery = periodsQuery.lte("period_number", HALF_DAY_CUTOFF_PERIOD);
  } else if (finalHalfDay === "second_half") {
    periodsQuery = periodsQuery.gt("period_number", HALF_DAY_CUTOFF_PERIOD);
  }

  const { data: periods, error: periodsErr } = await periodsQuery;
  if (periodsErr) {
    console.error("[teacher-absences.POST] affected periods:", periodsErr);
    return NextResponse.json(
      { error: "Absence saved, but failed to load affected periods" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data: { absence, affected_periods: periods ?? [] },
  });
}
