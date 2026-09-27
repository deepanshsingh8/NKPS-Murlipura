import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import {
  describeElectiveClasses,
  optionAppliesTo,
} from "@nkps/shared/lib/electives";

/**
 * Set or clear a student's pick for a given elective slot (5 or 6).
 *
 * POST { student_id, slot, subject_id }
 *   - Validates that subject_id is a registered option for that slot AND that
 *     the option is offered to the student's own class — XI and XII keep
 *     separate lists, and filtering the dropdown is not enforcement.
 *   - Upserts into student_elective_picks (one row per student + slot) AND
 *     mirrors the pick into student_subjects.
 *
 * DELETE ?student_id=…&slot=…
 *   - Removes the pick for that slot, and the student_subjects row it created.
 *
 * Two tables, one truth:
 *  - `student_elective_picks` is the INTENT record. It carries `slot`, which
 *    student_subjects cannot express, and UNIQUE(student_id, slot) is the rule
 *    that stops two subjects landing in the same slot.
 *  - `student_subjects` is the MATERIALIZED answer to "what does this student
 *    study". It is what every reporting surface reads, and the ONLY thing they
 *    read: lib/student-roster.ts (student export), lib/report-query.ts (Custom
 *    Report Builder, including its subject_id filter) and
 *    api/students/[id]/export. A pick that is not mirrored there is invisible
 *    to every export and report, and filtering a report BY that elective
 *    silently excludes every student who picked it.
 *
 * So both writes happen here, on every path, and a pick that cannot be
 * mirrored is rejected rather than half-written (see resolveMirror below).
 */

type PickAdmin = NonNullable<Awaited<ReturnType<typeof verifyAdminOrEditor>>>;

type EmbedShape<T> = T | T[] | null;

/** Embedded resources come back as object OR single-element array. */
const pickOne = <T,>(x: EmbedShape<T>): T | null =>
  !x ? null : Array.isArray(x) ? x[0] ?? null : x;

/**
 * The class the student is enrolled in for the CURRENT academic year.
 *
 * Both handlers need it: `student_subjects` links a student to a
 * `class_subjects` row, so a pick can only be materialized against the class
 * the student is actually sitting in. Scoping every mirror write to that class
 * is also what keeps the year-less `student_subjects` table from getting
 * worse — a promoted student's XI rows are left alone rather than rewritten,
 * and the readers already scope by the enrolled class.
 */
async function resolveEnrolledClass(admin: PickAdmin, studentId: string) {
  const { data: enrolment } = await admin
    .from("student_enrollments")
    .select("id, classes!inner(id, name), academic_years!inner(is_current)")
    .eq("student_id", studentId)
    .eq("status", "active")
    .eq("academic_years.is_current", true)
    // limit(1): a student with two active rows would otherwise make
    // maybeSingle() throw rather than answer the question we asked.
    .limit(1)
    .maybeSingle();

  return pickOne(
    (enrolment as unknown as {
      classes: EmbedShape<{ id: string; name: string }>;
    } | null)?.classes ?? null
  );
}

/**
 * The `class_subjects` row that ties a class to a subject — the join key
 * `student_subjects` is built on.
 *
 * Returns null when the subject is not attached to the class. That is a real
 * possibility (an elective option is registered per slot, independently of
 * whether anyone mapped it onto XI/XII in Academics → Subjects), and callers
 * MUST NOT proceed past it: writing the pick without the mirror is exactly the
 * silent-partial-write that makes electives vanish from every report.
 */
async function findClassSubject(
  admin: PickAdmin,
  classId: string,
  subjectId: string
): Promise<string | null> {
  const { data } = await admin
    .from("class_subjects")
    .select("id")
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("students");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const studentId = String(body?.student_id ?? "");
  const slot = Number(body?.slot);
  const subjectId = String(body?.subject_id ?? "");

  if (!studentId || !subjectId) {
    return NextResponse.json({ error: "student_id and subject_id required" }, { status: 400 });
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
    return NextResponse.json({ error: "slot must be 1–9" }, { status: 400 });
  }

  // Verify the option is valid for the slot
  const { data: opt } = await admin
    .from("elective_slot_options")
    .select("id, applies_to_classes")
    .eq("slot", slot)
    .eq("subject_id", subjectId)
    .eq("is_active", true)
    .maybeSingle();
  if (!opt) {
    return NextResponse.json({ error: "Subject is not an option for this elective slot" }, { status: 400 });
  }

  // …and that it is offered to this student's class. The picker already
  // filters by class, but a stale page or a direct call would otherwise slip a
  // XII-only subject onto a XI student.
  const cls = await resolveEnrolledClass(admin, studentId);
  if (!cls) {
    return NextResponse.json(
      { error: "Student has no active enrolment in the current academic year" },
      { status: 400 }
    );
  }
  if (!optionAppliesTo(opt.applies_to_classes, cls.name)) {
    return NextResponse.json(
      {
        error: `This option is offered to ${describeElectiveClasses(opt.applies_to_classes)}, so it cannot be assigned to a class ${cls.name} student.`,
      },
      { status: 400 }
    );
  }

  // Everything the mirror needs is resolved BEFORE anything is written, so a
  // subject that is not taught in the class fails with no rows touched.
  const classSubjectId = await findClassSubject(admin, cls.id, subjectId);
  if (!classSubjectId) {
    return NextResponse.json(
      {
        error: `This subject is not assigned to class ${cls.name}, so the pick could not be recorded — it would be invisible to every report and export. Add the subject to class ${cls.name} under Academics → Subjects first.`,
      },
      { status: 400 }
    );
  }

  // What this pick supersedes. Read before the upsert overwrites it: the old
  // subject's student_subjects row has to go, or the student ends up studying
  // both sides of a one-of choice.
  const { data: previous } = await admin
    .from("student_elective_picks")
    .select("subject_id")
    .eq("student_id", studentId)
    .eq("slot", slot)
    .maybeSingle();
  const previousSubjectId = (previous?.subject_id as string | undefined) ?? null;

  const { error: upsertErr } = await admin
    .from("student_elective_picks")
    .upsert(
      { student_id: studentId, slot, subject_id: subjectId, updated_at: new Date().toISOString() },
      { onConflict: "student_id,slot" }
    );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 400 });
  }

  // Retire the superseded subject's mirror row. Scoped to this class, so a
  // student who legitimately studied the same subject in an earlier class
  // keeps that (already class-scoped) row.
  if (previousSubjectId && previousSubjectId !== subjectId) {
    const previousClassSubjectId = await findClassSubject(
      admin,
      cls.id,
      previousSubjectId
    );
    if (previousClassSubjectId) {
      const { error: delErr } = await admin
        .from("student_subjects")
        .delete()
        .eq("student_id", studentId)
        .eq("class_subject_id", previousClassSubjectId);
      if (delErr) {
        return NextResponse.json(
          {
            error: `Pick saved, but the previous subject could not be removed from the student's subject list (${delErr.message}). Save the pick again.`,
          },
          { status: 500 }
        );
      }
    }
  }

  // Always run, even when the same subject was re-saved: the mirror row may be
  // missing (a pick written before this route mirrored them), and this upsert
  // is the cheapest way to heal that. ignoreDuplicates because the link may
  // equally already exist — from a bulk subject import, or a plain re-save.
  // Re-running this route is therefore idempotent, which is what makes "save
  // it again" a valid recovery from the errors above.
  const { error: mirrorErr } = await admin
    .from("student_subjects")
    .upsert(
      { student_id: studentId, class_subject_id: classSubjectId },
      { onConflict: "student_id,class_subject_id", ignoreDuplicates: true }
    );
  if (mirrorErr) {
    return NextResponse.json(
      {
        error: `Pick saved, but it could not be added to the student's subject list (${mirrorErr.message}), so it will not appear in reports or exports. Save the pick again.`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const admin = await verifyAdminOrEditor("students");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const studentId = url.searchParams.get("student_id");
  const slot = Number(url.searchParams.get("slot"));
  if (!studentId || !Number.isInteger(slot)) {
    return NextResponse.json({ error: "student_id and slot required" }, { status: 400 });
  }

  // Which subject is being cleared — needed to find the mirror row, and read
  // first because deleting the pick would lose it.
  const { data: existing } = await admin
    .from("student_elective_picks")
    .select("subject_id")
    .eq("student_id", studentId)
    .eq("slot", slot)
    .maybeSingle();
  const existingSubjectId = (existing?.subject_id as string | undefined) ?? null;

  if (existingSubjectId) {
    // Same enrolment requirement as POST. Without the class we cannot tell
    // which class_subjects row this pick materialized into, and dropping the
    // pick alone would strand a subject in the student's list with nothing
    // left pointing at it — worse than refusing.
    const cls = await resolveEnrolledClass(admin, studentId);
    if (!cls) {
      return NextResponse.json(
        {
          error:
            "Student has no active enrolment in the current academic year, so this elective cannot be removed from their subject list.",
        },
        { status: 400 }
      );
    }

    const classSubjectId = await findClassSubject(admin, cls.id, existingSubjectId);
    if (classSubjectId) {
      // Mirror first: if this fails we abort with the pick still in place, so
      // the two tables stay in agreement and the retry is a plain re-DELETE.
      const { error: mirrorErr } = await admin
        .from("student_subjects")
        .delete()
        .eq("student_id", studentId)
        .eq("class_subject_id", classSubjectId);
      if (mirrorErr) {
        return NextResponse.json(
          {
            error: `Could not remove the subject from the student's subject list (${mirrorErr.message}). Nothing was changed — try again.`,
          },
          { status: 500 }
        );
      }
    }
  }

  const { error } = await admin
    .from("student_elective_picks")
    .delete()
    .eq("student_id", studentId)
    .eq("slot", slot);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
