import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { assignSubjectsToClasses } from "@/lib/class-subject-assign";

/**
 * Save a whole class's subject list in one request.
 *
 * The Assign dialog used to add one subject per round trip, so setting up a
 * class with eleven subjects meant eleven saves. This takes the diff — what to
 * add, what to remove — and applies it once.
 *
 * ── On removals ─────────────────────────────────────────────────────────────
 * Deleting a `class_subjects` row cascades `student_subjects`, which is fine;
 * that link is rebuilt from the class's subject list. What it does NOT touch is
 * `results` and `class_tests`, which are keyed on (student, class, subject)
 * directly. So removing a subject that students already have marks for leaves
 * those marks in place but detached from the class's subject list — report
 * cards then carry a subject the class officially does not study.
 *
 * That is worth stopping the first time and allowing on the second. Removals
 * with marks behind them are refused individually and named in the response;
 * everything else in the same save still goes through. `force: true` repeats
 * the request and accepts the consequence.
 */

interface AddItem {
  subject_id: string;
  teacher_id?: string | null;
}

interface RemovalBlock {
  class_subject_id: string;
  subject_id: string;
  reason: string;
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("subjects");
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    class_id?: unknown;
    add?: unknown;
    remove?: unknown;
    force?: unknown;
    dry_run?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const classId = typeof body.class_id === "string" ? body.class_id : "";
  if (!classId) {
    return NextResponse.json({ error: "class_id is required" }, { status: 400 });
  }

  const add: AddItem[] = Array.isArray(body.add)
    ? (body.add as AddItem[]).filter(
        (a) => a && typeof a.subject_id === "string" && a.subject_id
      )
    : [];
  const removeIds: string[] = Array.isArray(body.remove)
    ? (body.remove as unknown[]).filter(
        (id): id is string => typeof id === "string" && !!id
      )
    : [];
  const force = body.force === true;
  const dryRun = body.dry_run === true;

  if (add.length === 0 && removeIds.length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  // Subject names, for messages the admin can act on.
  const nameById = new Map<string, string>();
  const { data: subjectRows } = await admin
    .from("subjects")
    .select("id, name");
  for (const s of subjectRows ?? []) nameById.set(s.id, s.name as string);

  // ── Removals ──────────────────────────────────────────────────────────────
  let removed = 0;
  const removalBlocked: RemovalBlock[] = [];

  if (removeIds.length > 0) {
    // Only rows that really belong to this class — a client must not be able
    // to delete another class's assignment by passing its id.
    const { data: targets, error: targetErr } = await admin
      .from("class_subjects")
      .select("id, subject_id")
      .eq("class_id", classId)
      .in("id", removeIds);
    if (targetErr) {
      console.error("[class-assignments] load removals:", targetErr);
      return NextResponse.json(
        { error: "Could not read the current assignments" },
        { status: 500 }
      );
    }

    const deletable: string[] = [];
    for (const t of targets ?? []) {
      if (force) {
        deletable.push(t.id as string);
        continue;
      }

      const subjectId = t.subject_id as string;
      const [{ count: resultCount }, { count: testCount }] = await Promise.all([
        admin
          .from("results")
          .select("id", { count: "exact", head: true })
          .eq("class_id", classId)
          .eq("subject_id", subjectId),
        admin
          .from("class_tests")
          .select("id", { count: "exact", head: true })
          .eq("class_id", classId)
          .eq("subject_id", subjectId),
      ]);

      const marks = (resultCount ?? 0) + (testCount ?? 0);
      if (marks > 0) {
        removalBlocked.push({
          class_subject_id: t.id as string,
          subject_id: subjectId,
          reason: `${nameById.get(subjectId) ?? "This subject"} has ${marks} mark${marks === 1 ? "" : "s"} recorded for this class. Removing it leaves those marks attached to a subject the class no longer studies.`,
        });
      } else {
        deletable.push(t.id as string);
      }
    }

    if (!dryRun && deletable.length > 0) {
      const { error: delErr } = await admin
        .from("class_subjects")
        .delete()
        .in("id", deletable);
      if (delErr) {
        console.error("[class-assignments] delete:", delErr);
        return NextResponse.json(
          { error: "Failed to remove subjects from the class" },
          { status: 500 }
        );
      }
      removed = deletable.length;
    } else if (dryRun) {
      removed = deletable.length;
    }
  }

  // ── Additions ─────────────────────────────────────────────────────────────
  const outcome = await assignSubjectsToClasses(
    admin,
    add.map((a) => ({
      class_id: classId,
      subject_id: a.subject_id,
      teacher_id: a.teacher_id ?? null,
      label: nameById.get(a.subject_id) ?? a.subject_id,
    })),
    { dryRun }
  );

  // A save where nothing at all landed and something went wrong must not read
  // as success to a caller that only checks res.ok.
  const nothingHappened =
    outcome.created === 0 &&
    removed === 0 &&
    (outcome.errors.length > 0 || removalBlocked.length > 0);

  return NextResponse.json(
    {
      success: !nothingHappened,
      created: outcome.created,
      skipped: outcome.skipped,
      removed,
      would_create: dryRun ? outcome.plan.length : undefined,
      errors: outcome.errors,
      removal_blocked: removalBlocked,
    },
    { status: nothingHappened ? 409 : 200 }
  );
}
