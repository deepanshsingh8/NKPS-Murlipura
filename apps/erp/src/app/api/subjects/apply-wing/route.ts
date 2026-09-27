import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import {
  assignSubjectsToClasses,
  type ClassSubjectPair,
} from "@/lib/class-subject-assign";

/**
 * Push a wing's subject set onto every class and section in its band.
 *
 * "I created one profile of middle wing. Selected classes 6 to 8. I have
 * selected 11 subjects… Now if this middle wing option can be associated with
 * subject allotment automatically to class 6 to 8, class wise as well as
 * section wise, the operations will become easy for us."
 *
 * Nine classes × eleven subjects is ninety-nine assignments the admin was
 * making by hand. This does it in one action, twice: once as a dry run so they
 * can see exactly which classes and how many rows, then for real.
 *
 * Existing rows are never touched — not their teacher, not anything. That is a
 * property of `assignSubjectsToClasses`, verified against a real Postgres:
 * `ON CONFLICT DO NOTHING` leaves an already-staffed row alone even when the
 * incoming row carries a null teacher. It is what makes re-running this over a
 * band someone has already staffed safe rather than destructive.
 */
export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("subjects");
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { stream_id?: unknown; academic_year_id?: unknown; dry_run?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const wingId = typeof body.stream_id === "string" ? body.stream_id : "";
  if (!wingId) {
    return NextResponse.json({ error: "stream_id is required" }, { status: 400 });
  }
  const dryRun = body.dry_run === true;

  // ── The wing ──────────────────────────────────────────────────────────────
  const { data: wing, error: wingErr } = await admin
    .from("streams")
    .select("id, name, kind, class_names")
    .eq("id", wingId)
    .maybeSingle();
  if (wingErr) {
    console.error("[apply-wing] load wing:", wingErr);
    return NextResponse.json({ error: "Could not load the wing" }, { status: 500 });
  }
  if (!wing) {
    return NextResponse.json({ error: "Wing not found" }, { status: 404 });
  }
  if (wing.kind !== "wing") {
    // An academic stream reaches its classes through classes.stream_id, which
    // is a different mechanism entirely. Applying one here would be a no-op at
    // best and a surprise at worst.
    return NextResponse.json(
      { error: `"${wing.name}" is a stream, not a wing. Only wings carry a class band.` },
      { status: 400 }
    );
  }

  const bandNames: string[] = Array.isArray(wing.class_names) ? wing.class_names : [];
  if (bandNames.length === 0) {
    return NextResponse.json(
      { error: `"${wing.name}" has no classes selected. Edit the wing and pick the classes it covers.` },
      { status: 400 }
    );
  }

  // ── Its subjects ──────────────────────────────────────────────────────────
  const { data: wingSubjects, error: subjErr } = await admin
    .from("stream_subjects")
    .select("subject_id, subjects(name)")
    .eq("stream_id", wingId);
  if (subjErr) {
    console.error("[apply-wing] load subjects:", subjErr);
    return NextResponse.json(
      { error: "Could not load the wing's subjects" },
      { status: 500 }
    );
  }
  if (!wingSubjects || wingSubjects.length === 0) {
    return NextResponse.json(
      { error: `"${wing.name}" has no subjects yet. Use Manage on the wing to pick them first.` },
      { status: 400 }
    );
  }

  // ── The year, and the classes in the band ─────────────────────────────────
  let yearId =
    typeof body.academic_year_id === "string" ? body.academic_year_id : "";
  if (!yearId) {
    const { data: currentYear } = await admin
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    yearId = (currentYear?.id as string | undefined) ?? "";
  }
  if (!yearId) {
    return NextResponse.json(
      { error: "No current academic year is set" },
      { status: 400 }
    );
  }

  const { data: classes, error: classErr } = await admin
    .from("classes")
    .select("id, name, section")
    .eq("academic_year_id", yearId)
    .in("name", bandNames)
    .order("sort_order");
  if (classErr) {
    console.error("[apply-wing] load classes:", classErr);
    return NextResponse.json({ error: "Could not load the classes" }, { status: 500 });
  }
  if (!classes || classes.length === 0) {
    return NextResponse.json(
      {
        error: `No classes named ${bandNames.join(", ")} exist in this academic year.`,
      },
      { status: 400 }
    );
  }

  // ── Every class × every subject ───────────────────────────────────────────
  const subjectNameById = new Map<string, string>();
  for (const ws of wingSubjects) {
    const sub = ws.subjects as { name?: string } | { name?: string }[] | null;
    const one = Array.isArray(sub) ? sub[0] : sub;
    subjectNameById.set(ws.subject_id as string, one?.name ?? "subject");
  }

  const pairs: ClassSubjectPair[] = [];
  for (const c of classes) {
    for (const ws of wingSubjects) {
      pairs.push({
        class_id: c.id as string,
        subject_id: ws.subject_id as string,
        // Left null on purpose: this action decides *what* each class studies,
        // not who teaches it. The class dialog fills teachers in, and the
        // migration-117 trigger learns the mapping from those.
        teacher_id: null,
        label: `${c.name}-${c.section} / ${subjectNameById.get(ws.subject_id as string)}`,
      });
    }
  }

  const outcome = await assignSubjectsToClasses(admin, pairs, { dryRun });

  return NextResponse.json({
    success: outcome.errors.length === 0,
    wing: wing.name,
    dry_run: dryRun,
    classes: classes.map((c) => `${c.name}-${c.section}`),
    subject_count: wingSubjects.length,
    would_create: dryRun ? outcome.plan.length : undefined,
    created: outcome.created,
    skipped: outcome.skipped,
    errors: outcome.errors,
  });
}
