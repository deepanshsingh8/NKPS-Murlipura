import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { attendanceBulkSchema } from "@nkps/shared/lib/validations";
import {
  getTeacherIdForUser,
  teacherCanAccessClass,
} from "@/lib/teacher-scope";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user is a teacher or admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (profile.role !== "admin" && profile.role !== "teacher") {
      const { data: perm } = await supabase
        .from("editor_permissions")
        .select("feature_key")
        .eq("editor_id", user.id)
        .eq("feature_key", "attendance")
        .maybeSingle();
      if (!perm) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const body = await request.json();
    const result = attendanceBulkSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { class_id, date, entries } = result.data;

    // Reject non-school days. School week is Mon–Sat by convention here;
    // Sunday + scheduled holidays in calendar_events are blocked. The override
    // flag (`force=true` in the body) lets admins record makeup classes on
    // those days while keeping the normal path safe for teachers.
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    const reqDate = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(reqDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid date" },
        { status: 400 }
      );
    }
    if (reqDate.getTime() > today.getTime()) {
      return NextResponse.json(
        { error: "Cannot mark attendance for a future date" },
        { status: 400 }
      );
    }
    const force = body?.force === true && profile.role === "admin";
    if (!force) {
      // 0 = Sunday in JS Date.getUTCDay()
      if (reqDate.getUTCDay() === 0) {
        return NextResponse.json(
          {
            error:
              "That date is a Sunday — attendance is not collected on Sundays. Set force=true (admin only) to override.",
          },
          { status: 400 }
        );
      }

      // Holiday lookup: a calendar_events row of type 'holiday' that brackets
      // this date (start_date ≤ date ≤ end_date OR start_date == date when
      // end_date is null). School-wide holidays apply to every class; class-
      // scoped holidays only apply to the matching class_id.
      const { data: holidays } = await supabase
        .from("calendar_events")
        .select("id, title, start_date, end_date, is_school_wide, class_id")
        .eq("event_type", "holiday")
        .lte("start_date", date)
        .or(`end_date.gte.${date},end_date.is.null`);
      const blocking = (holidays ?? []).find((h) => {
        // start_date already ≤ date by query; end_date.is.null means single-day
        // and start_date must equal date.
        const endOk =
          h.end_date == null
            ? h.start_date === date
            : h.end_date >= date;
        if (!endOk) return false;
        if (h.is_school_wide) return true;
        return h.class_id === class_id;
      });
      if (blocking) {
        return NextResponse.json(
          {
            error: `That date is a holiday (${blocking.title}). Set force=true (admin only) to override.`,
          },
          { status: 400 }
        );
      }
    }

    // Teacher ownership: a teacher can only mark attendance for classes
    // they teach (subject teacher) or are class teacher of. Admins skip.
    if (profile.role === "teacher") {
      const teacherId = await getTeacherIdForUser(supabase, user.id);
      if (
        !teacherId ||
        !(await teacherCanAccessClass(supabase, teacherId, class_id))
      ) {
        return NextResponse.json(
          { error: "You don't have access to this class" },
          { status: 403 }
        );
      }
    }

    // Build records for upsert
    const records = entries.map((entry) => ({
      student_id: entry.student_id,
      class_id,
      date,
      status: entry.status,
      marked_by: user.id,
    }));

    const { error } = await supabase
      .from("attendance")
      .upsert(records, { onConflict: "student_id,class_id,date" });

    if (error) {
      console.error("Attendance upsert error:", error);
      return NextResponse.json(
        { error: "Failed to save attendance" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, count: records.length });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
