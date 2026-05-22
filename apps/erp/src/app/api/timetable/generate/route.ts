import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * §2 Auto-generate timetable for one or more classes from a template.
 *
 * Body:
 *   {
 *     template_id: string,
 *     class_ids:   string[],         // classes to generate for
 *     days:        number[],         // 1..6, defaults to [1,2,3,4,5,6]
 *     replace:     boolean,          // true → wipe existing periods on those days first
 *     allow_subject_repeat?: boolean // false (default) = each subject ≤ once/day
 *   }
 *
 * Returns:
 *   { generated, skipped, conflicts: [{ class_id, day, period, subject_id, teacher_id, reason }] }
 *
 * Constraints enforced:
 *   - Lunch positions in the template are written as is_break=true (subject/teacher null)
 *   - No teacher scheduled into two sections in the same period (cross-class check)
 *   - No subject scheduled twice in the same day for one class (unless allow_subject_repeat)
 *   - Existing periods kept unless replace=true
 */

interface TemplatePeriod {
  position: number;
  kind: "teaching" | "lunch" | "break";
  start_time: string;
  end_time: string;
}

interface ClassSubjectRow {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string | null;
}

interface ExistingPeriod {
  class_id: string;
  day_of_week: number;
  period_number: number;
  teacher_id: string | null;
  subject_id: string | null;
}

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("timetable");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const templateId = String(body?.template_id ?? "");
  const classIds: string[] = Array.isArray(body?.class_ids) ? body.class_ids : [];
  const days: number[] = Array.isArray(body?.days) && body.days.length > 0 ? body.days : [1, 2, 3, 4, 5, 6];
  const replace: boolean = body?.replace === true;
  const allowSubjectRepeat: boolean = body?.allow_subject_repeat === true;

  if (!templateId || classIds.length === 0) {
    return NextResponse.json({ error: "template_id and class_ids are required" }, { status: 400 });
  }
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) {
    return NextResponse.json({ error: "days must be integers 1..6" }, { status: 400 });
  }

  // Load template + its periods
  const { data: tpl } = await admin
    .from("timetable_templates")
    .select("id")
    .eq("id", templateId)
    .maybeSingle();
  if (!tpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { data: tplPeriodsRaw } = await admin
    .from("timetable_template_periods")
    .select("position, kind, start_time, end_time")
    .eq("template_id", templateId)
    .order("position");
  const tplPeriods = (tplPeriodsRaw as TemplatePeriod[]) ?? [];
  if (tplPeriods.length === 0) {
    return NextResponse.json({ error: "Template has no periods" }, { status: 400 });
  }

  // Load class_subjects for the selected classes
  const { data: csRaw } = await admin
    .from("class_subjects")
    .select("id, class_id, subject_id, teacher_id")
    .in("class_id", classIds);
  const classSubjects = (csRaw as ClassSubjectRow[]) ?? [];

  // Group by class
  const csByClass = new Map<string, ClassSubjectRow[]>();
  for (const cs of classSubjects) {
    const arr = csByClass.get(cs.class_id) ?? [];
    arr.push(cs);
    csByClass.set(cs.class_id, arr);
  }

  // Optional wipe (only the days we're regenerating)
  if (replace) {
    const { error: delErr } = await admin
      .from("timetable_periods")
      .delete()
      .in("class_id", classIds)
      .in("day_of_week", days);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  // Load existing periods for cross-class teacher conflict check (after optional wipe).
  // We only need rows on the same day_of_week — limit by all classes (not just ours)
  // since teachers can clash with classes outside the selected set.
  const { data: existingRaw } = await admin
    .from("timetable_periods")
    .select("class_id, day_of_week, period_number, teacher_id, subject_id")
    .in("day_of_week", days);
  const existing = (existingRaw as ExistingPeriod[]) ?? [];

  // teacherBusy[day][period] = Set<teacher_id>
  const teacherBusy = new Map<string, Set<string>>();
  for (const ex of existing) {
    if (!ex.teacher_id) continue;
    const key = `${ex.day_of_week}:${ex.period_number}`;
    if (!teacherBusy.has(key)) teacherBusy.set(key, new Set());
    teacherBusy.get(key)!.add(ex.teacher_id);
  }

  let generated = 0;
  let skipped = 0;
  const conflicts: Array<{ class_id: string; day: number; period: number; reason: string }> = [];
  const rowsToInsert: Array<{
    class_id: string;
    subject_id: string | null;
    teacher_id: string | null;
    day_of_week: number;
    period_number: number;
    start_time: string;
    end_time: string;
    is_break: boolean;
  }> = [];

  for (const classId of classIds) {
    const csForClass = csByClass.get(classId) ?? [];
    // Round-robin pointer per class so subjects don't all fall in the same slot
    let cursor = 0;

    for (const day of days) {
      // Track per-day per-class subject use to enforce "no subject twice/day"
      const usedSubjectsToday = new Set<string>();

      for (const tp of tplPeriods) {
        // Lunch / break → write a non-teaching row
        if (tp.kind === "lunch" || tp.kind === "break") {
          rowsToInsert.push({
            class_id: classId,
            subject_id: null,
            teacher_id: null,
            day_of_week: day,
            period_number: tp.position,
            start_time: tp.start_time,
            end_time: tp.end_time,
            is_break: true,
          });
          continue;
        }

        // Teaching slot — try class_subjects in round-robin order
        const tried = new Set<string>();
        let scheduled = false;
        for (let attempt = 0; attempt < csForClass.length && !scheduled; attempt++) {
          const cs = csForClass[(cursor + attempt) % csForClass.length];
          if (tried.has(cs.id)) continue;
          tried.add(cs.id);

          // Subject-repeat check
          if (!allowSubjectRepeat && usedSubjectsToday.has(cs.subject_id)) continue;

          // Teacher-conflict check (cross-class)
          if (cs.teacher_id) {
            const busyKey = `${day}:${tp.position}`;
            if (teacherBusy.get(busyKey)?.has(cs.teacher_id)) continue;
          }

          rowsToInsert.push({
            class_id: classId,
            subject_id: cs.subject_id,
            teacher_id: cs.teacher_id,
            day_of_week: day,
            period_number: tp.position,
            start_time: tp.start_time,
            end_time: tp.end_time,
            is_break: false,
          });
          if (cs.teacher_id) {
            const busyKey = `${day}:${tp.position}`;
            if (!teacherBusy.has(busyKey)) teacherBusy.set(busyKey, new Set());
            teacherBusy.get(busyKey)!.add(cs.teacher_id);
          }
          usedSubjectsToday.add(cs.subject_id);
          cursor = (cursor + attempt + 1) % Math.max(1, csForClass.length);
          scheduled = true;
          generated++;
        }

        if (!scheduled) {
          skipped++;
          conflicts.push({
            class_id: classId,
            day,
            period: tp.position,
            reason:
              csForClass.length === 0
                ? "No subjects assigned to this class"
                : "All candidate subjects skipped (teacher clash or duplicate-per-day rule)",
          });
        }
      }
    }
  }

  // Insert in chunks to stay under typical PostgREST payload limits
  const CHUNK = 500;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK);
    const { error: insertErr } = await admin
      .from("timetable_periods")
      .upsert(chunk, { onConflict: "class_id,day_of_week,period_number", ignoreDuplicates: !replace });
    if (insertErr) {
      return NextResponse.json(
        { error: insertErr.message, generated, skipped, conflicts, partial: true },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ generated, skipped, conflicts });
}
