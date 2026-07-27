import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * §10 Excel commit. Receives the rows the admin confirmed (resolved IDs from
 * the preview step) and inserts them as timetable_periods. Refuses partial
 * commits — if any row would fail validation we return 400 and write nothing.
 */

interface CommitRow {
  class_id: string;
  subject_id: string;
  teacher_id: string | null;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
}

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("timetable");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const rows: CommitRow[] = Array.isArray(body?.rows) ? body.rows : [];
  const replace: boolean = body?.replace === true;

  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to commit" }, { status: 400 });
  }

  // Validate every row before any DB write
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.class_id || !r.subject_id) {
      return NextResponse.json({ error: `Row ${i + 1}: class_id and subject_id are required` }, { status: 400 });
    }
    if (!Number.isInteger(r.day_of_week) || r.day_of_week < 1 || r.day_of_week > 6) {
      return NextResponse.json({ error: `Row ${i + 1}: day_of_week must be 1..6` }, { status: 400 });
    }
    if (!Number.isInteger(r.period_number) || r.period_number < 0) {
      return NextResponse.json({ error: `Row ${i + 1}: period_number invalid` }, { status: 400 });
    }
    if (!r.start_time || !r.end_time || r.end_time <= r.start_time) {
      return NextResponse.json({ error: `Row ${i + 1}: invalid time range` }, { status: 400 });
    }
  }

  // Optional pre-wipe. "Replace" means replace this class's whole schedule for
  // the days being imported — so we clear every period for each (class_id, day)
  // in the batch, not only the period_numbers we're about to write. Otherwise a
  // re-import with a changed layout (e.g. fewer/renumbered periods) leaves stale
  // rows behind and merges into a corrupted timetable.
  if (replace) {
    const classDays = new Set<string>();
    for (const r of rows) classDays.add(`${r.class_id}:${r.day_of_week}`);
    for (const key of classDays) {
      const [classId, dayStr] = key.split(":");
      const { error: delErr } = await admin
        .from("timetable_periods")
        .delete()
        .eq("class_id", classId)
        .eq("day_of_week", Number(dayStr));
      if (delErr) {
        return NextResponse.json({ error: `Pre-wipe failed: ${delErr.message}` }, { status: 400 });
      }
    }
  }

  // Insert all rows
  const insertRows = rows.map((r) => ({
    class_id: r.class_id,
    subject_id: r.subject_id,
    teacher_id: r.teacher_id,
    day_of_week: r.day_of_week,
    period_number: r.period_number,
    start_time: r.start_time,
    end_time: r.end_time,
    room: r.room,
    is_break: false,
  }));

  const { error: insErr } = await admin
    .from("timetable_periods")
    .upsert(insertRows, { onConflict: "class_id,day_of_week,period_number" });
  if (insErr) {
    // The DB enforces "a teacher can't be in two overlapping periods" via the
    // timetable_teacher_no_overlap EXCLUDE constraint. Surface that as a clear
    // message instead of a raw constraint error.
    if (
      insErr.code === "23P01" ||
      /timetable_teacher_no_overlap|exclusion/i.test(insErr.message ?? "")
    ) {
      return NextResponse.json(
        {
          error:
            "A teacher would be double-booked: two periods overlap in time. Fix the clashing rows (or use Replace) and re-import.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, inserted: insertRows.length });
}
