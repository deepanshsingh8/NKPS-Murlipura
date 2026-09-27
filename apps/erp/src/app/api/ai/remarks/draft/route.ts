import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffMember } from "@nkps/shared/lib/verify-admin";
import { getSchoolProfile } from "@nkps/shared/lib/school-profile";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import { isAiConfigured, AI_MODELS } from "@/lib/ai/client";
import { startConversation, finishConversation } from "@/lib/ai/audit";
import { draftClassRemarks, RemarksError } from "@/lib/ai/remarks";

export const runtime = "nodejs";
// One model call over a whole class, plus per-student result computation.
export const maxDuration = 60;

const bodySchema = z.object({
  class_id: z.string().uuid(),
  exam_type_id: z.string().uuid(),
  tone: z.enum(["warm", "formal", "neutral"]).optional(),
  max_words: z.number().int().min(10).max(60).optional(),
});

/**
 * POST /api/ai/remarks/draft
 *
 * Drafts report-card remarks for a whole class. Writes nothing — the drafts
 * populate the marks-entry grid, and the teacher saves through the existing
 * /api/results/remarks route with its draft-clobber guard intact.
 *
 * ── The authorization rule, and why it is the narrow one ────────────────────
 * The caller must be the class's `class_teacher_id`. NOT `get_my_class_ids()`,
 * which is `class_teacher_id UNION class_subjects.teacher_id` — that is the
 * "teaches a subject here" set, and it is strictly wider. A subject teacher can
 * enter marks for their own subject but has no business authoring the holistic
 * remark that goes on the report card, and the existing POST /api/results/remarks
 * enforces exactly this. Widening it here would let the AI path grant something
 * the deterministic path refuses.
 */
export async function POST(request: NextRequest) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "The assistant is not configured on this deployment.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const caller = await verifyStaffMember();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, user, role } = caller;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { class_id, exam_type_id } = parsed.data;

  const school = await getSchoolProfile(admin);
  if (!school.aiEnabled) {
    return NextResponse.json(
      { error: "The assistant is switched off for this school.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  // Resolve the class and enforce the class-teacher rule.
  const { data: klass } = await admin
    .from("classes")
    .select("id, name, section, class_teacher_id, academic_year_id")
    .eq("id", class_id)
    .maybeSingle();

  if (!klass) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("teacher_id")
    .eq("id", user.id)
    .single();

  const isAdmin = role === "admin";
  const teacherId = (profile?.teacher_id as string | null) ?? null;

  if (!isAdmin && (!teacherId || klass.class_teacher_id !== teacherId)) {
    return NextResponse.json(
      {
        error:
          "Only the assigned class teacher can draft remarks for this class.",
        code: "NOT_CLASS_TEACHER",
      },
      { status: 403 }
    );
  }

  // Per-user: one class draft is one model call over ~40 students, so this is
  // the expensive endpoint of the two.
  const limit = rateLimit({
    name: "ai:remarks",
    key: user.id,
    max: 10,
    windowSeconds: 600,
  });
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Too many drafts in a short time. Try again in ${limit.resetSeconds}s.`,
        code: "RATE_LIMITED",
      },
      { status: 429 }
    );
  }

  const { data: examType } = await admin
    .from("exam_types")
    .select("id, name")
    .eq("id", exam_type_id)
    .maybeSingle();

  if (!examType) {
    return NextResponse.json({ error: "Exam type not found" }, { status: 404 });
  }

  const className = klass.section
    ? `${klass.name as string}-${klass.section as string}`
    : (klass.name as string);

  const conversationId = await startConversation({
    admin,
    channel: "erp_web",
    feature: "remarks",
    actorId: user.id,
    actorRole: role,
    teacherId,
    // The narrow rule, recorded as such — see the note above on why this is
    // "class_teacher" and never "teaches".
    scope: { kind: "classes", classIds: [class_id], source: "class_teacher" },
    model: AI_MODELS.remarks,
    academicYearId: (klass.academic_year_id as string) ?? null,
  });

  try {
    const result = await draftClassRemarks(admin, {
      classId: class_id,
      examTypeId: exam_type_id,
      academicYearId: klass.academic_year_id as string,
      className,
      examName: examType.name as string,
      tone: parsed.data.tone ?? school.aiTone,
      maxWords: parsed.data.max_words,
      conversationId,
    });

    await finishConversation(admin, conversationId, "completed");
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RemarksError) {
      await finishConversation(admin, conversationId, "error", err.code);
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    console.error("[ai.remarks] draft failed:", err);
    await finishConversation(admin, conversationId, "error", "unexpected");
    return NextResponse.json(
      { error: "Couldn't draft remarks. You can still write them by hand." },
      { status: 500 }
    );
  }
}
