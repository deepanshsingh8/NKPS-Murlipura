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
    if (!Number.isInteger(r.period_number) || r.period_number < 1) {
      return NextResponse.json({ error: `Row ${i + 1}: period_number invalid` }, { status: 400 });
    }
    if (!r.start_time || !r.end_time || r.end_time <= r.start_time) {
      return NextResponse.json({ error: `Row ${i + 1}: invalid time range` }, { status: 400 });
    }
  }

  // Optional pre-wipe of (class_id, day, period) tuples we're about to write.
  if (replace) {
    // Group by (class_id, day) for efficient deletes
    const tuples = new Map<string, Set<number>>();
    for (const r of rows) {
      const key = `${r.class_id}:${r.day_of_week}`;
      if (!tuples.has(key)) tuples.set(key, new Set());
      tuples.get(key)!.add(r.period_number);
    }
    for (const [key, periods] of tuples) {
      const [classId, dayStr] = key.split(":");
      const { error: delErr } = await admin
        .from("timetable_periods")
        .delete()
        .eq("class_id", classId)
        .eq("day_of_week", Number(dayStr))
        .in("period_number", [...periods]);
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
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, inserted: insertRows.length });
}
