import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const scheduleSchema = z.object({
  exam_type_id: z.string().uuid(),
  class_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "exam_date must be YYYY-MM-DD"),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  room: z.string().nullable().optional(),
  invigilator_teacher_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = request.nextUrl;
  const examTypeId = searchParams.get("exam_type_id");
  const classId = searchParams.get("class_id");

  let query = admin
    .from("exam_schedules")
    .select(
      "id, exam_type_id, class_id, subject_id, exam_date, start_time, end_time, room, invigilator_teacher_id, sort_order, notes, subjects(id, name, code), exam_types(id, name)"
    )
    .order("exam_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false });

  if (examTypeId) query = query.eq("exam_type_id", examTypeId);
  if (classId) query = query.eq("class_id", classId);

  const { data, error } = await query;
  if (error) {
    console.error("[exam-schedules.GET] list:", error);
    return NextResponse.json({ error: "Failed to load exam schedules" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { data, error } = await admin
    .from("exam_schedules")
    .insert({
      ...parsed.data,
      start_time: parsed.data.start_time ?? null,
      end_time: parsed.data.end_time ?? null,
      room: parsed.data.room ?? null,
      invigilator_teacher_id: parsed.data.invigilator_teacher_id ?? null,
      notes: parsed.data.notes ?? null,
      sort_order: parsed.data.sort_order ?? 0,
    })
    .select("*")
    .single();
  if (error) {
    // Surface the unique-constraint violation (same subject already scheduled
    // for that class/exam) as a friendlier message than the default Postgres one.
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "That subject is already scheduled for this class and exam. Edit the existing row instead of creating a new one.",
        },
        { status: 409 }
      );
    }
    console.error("[exam-schedules.POST] insert:", error);
    return NextResponse.json({ error: "Failed to create exam schedule" }, { status: 500 });
  }
  return NextResponse.json({ data });
}
