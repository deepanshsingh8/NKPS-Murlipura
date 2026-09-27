import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { computeFinalResult } from "@/lib/final-result";
import { computeAttendanceSummary } from "@nkps/shared/lib/attendance-summary";
import { getAiClient, AI_MODELS, AI_EFFORT, AI_MAX_TOKENS } from "./client";
import { recordMessage, recordToolCall } from "./audit";

/**
 * AI-drafted report-card remarks.
 *
 * ── Why this has no tools ───────────────────────────────────────────────────
 * Unlike Ask-your-school, there is nothing to discover at request time: the UI
 * already knows the class and the exam. So the server gathers the evidence
 * deterministically and makes exactly ONE structured-output call for the whole
 * class. Tools would add a loop that can fail, and 40 separate calls would cost
 * 40x for no benefit.
 *
 * ── Grounding, and why grounded_on exists ───────────────────────────────────
 * Each draft names the evidence keys it used. Rendered in the review UI as
 * "based on: Maths 41%, attendance 62%", it is the cheapest defence available
 * against a fabricated remark — a teacher can see at a glance whether the
 * sentence is about their student or about nobody.
 *
 * ── The teacher never loses control ─────────────────────────────────────────
 * Nothing here writes to student_remarks. The drafts populate form state in the
 * existing marks-entry grid; the teacher edits and presses Save, which goes
 * through the existing gated route with its draft-clobber guard intact.
 */

export interface RemarkEvidence {
  studentId: string;
  name: string;
  rollNumber: string | null;
  overall: {
    percent: number | null;
    grade: string | null;
    division: string | null;
    passed: boolean;
  } | null;
  subjects: {
    name: string;
    percent: number | null;
    grade: string | null;
    passed: boolean;
  }[];
  attendance: { percent: number | null; present: number; total: number };
  existingRemark: string | null;
}

export interface RemarkDraft {
  student_id: string;
  remark: string;
  grounded_on: string[];
}

export interface DraftClassRemarksResult {
  drafts: RemarkDraft[];
  skipped: { student_id: string; reason: string }[];
  /** Non-fatal notes for the teacher, e.g. "no marks recorded yet". */
  notes: string[];
}

export class RemarksError extends Error {
  constructor(
    message: string,
    readonly code: "no_students" | "no_evidence" | "model_error",
    readonly status: number
  ) {
    super(message);
  }
}

const MAX_WORDS_DEFAULT = 35;

/**
 * Gathers everything a remark can legitimately be based on.
 *
 * `includeUnpublished` is hard-coded true because this is the teacher drafting
 * before publication — that is the entire point. It is NOT threaded from an
 * argument: a privacy gate a caller can flip is not a gate, and this function
 * must never become reachable from a parent-facing surface by passing false.
 */
export async function gatherRemarkEvidence(
  admin: SupabaseClient,
  args: { classId: string; examTypeId: string; academicYearId: string }
): Promise<RemarkEvidence[]> {
  const { data: enrollments } = await admin
    .from("student_enrollments")
    .select("student_id, roll_number, students(id, full_name)")
    .eq("class_id", args.classId)
    .eq("academic_year_id", args.academicYearId)
    .eq("status", "active");

  if (!enrollments || enrollments.length === 0) return [];

  const studentIds = enrollments.map((e) => e.student_id as string);

  const { data: existing } = await admin
    .from("student_remarks")
    .select("student_id, remark")
    .eq("exam_type_id", args.examTypeId)
    .in("student_id", studentIds);
  const existingByStudent = new Map(
    (existing ?? []).map((r) => [r.student_id as string, r.remark as string])
  );

  const evidence: RemarkEvidence[] = [];

  for (const enrollment of enrollments) {
    const studentId = enrollment.student_id as string;
    const student = enrollment.students as unknown as
      | { full_name?: string }
      | null;

    const [result, attendance] = await Promise.all([
      computeFinalResult(admin, {
        student_id: studentId,
        academic_year_id: args.academicYearId,
        includeUnpublished: true,
      }).catch(() => null),
      computeAttendanceSummary(admin, studentId, {
        academicYearId: args.academicYearId,
      }).catch(() => null),
    ]);

    evidence.push({
      studentId,
      name: student?.full_name ?? "Unknown",
      rollNumber: (enrollment.roll_number as string | null) ?? null,
      overall: result
        ? {
            percent: result.overall.main_total_pct,
            grade: result.overall.grade,
            division: result.overall.division,
            passed: result.overall.passed,
          }
        : null,
      subjects: (result?.main_subjects ?? []).map((s) => ({
        name: s.subject_name,
        percent: s.final_pct,
        grade: s.grade,
        passed: s.passed,
      })),
      attendance: {
        percent: attendance?.percent ?? null,
        present: attendance?.presentDays ?? 0,
        total: attendance?.totalDays ?? 0,
      },
      existingRemark: existingByStudent.get(studentId) ?? null,
    });
  }

  return evidence;
}

/**
 * Drafts one remark per student in a single model call.
 *
 * Students with no evidence at all are skipped rather than given a generic
 * sentence: a remark that could apply to any child is worse than a blank one,
 * because it looks like the teacher wrote it.
 */
export async function draftClassRemarks(
  admin: SupabaseClient,
  args: {
    classId: string;
    examTypeId: string;
    academicYearId: string;
    className: string;
    examName: string;
    tone: "warm" | "formal" | "neutral";
    maxWords?: number;
    conversationId: string | null;
  }
): Promise<DraftClassRemarksResult> {
  const evidence = await gatherRemarkEvidence(admin, args);

  if (evidence.length === 0) {
    throw new RemarksError(
      "No active students in this class for the current session.",
      "no_students",
      404
    );
  }

  const notes: string[] = [];
  const skipped: { student_id: string; reason: string }[] = [];
  const usable: RemarkEvidence[] = [];

  for (const student of evidence) {
    const hasMarks = student.overall !== null && student.subjects.length > 0;
    const hasAttendance = student.attendance.total > 0;
    if (!hasMarks && !hasAttendance) {
      skipped.push({
        student_id: student.studentId,
        reason: "no marks or attendance recorded yet",
      });
      continue;
    }
    usable.push(student);
  }

  if (usable.length === 0) {
    // The honest outcome when the exam department hasn't entered marks yet.
    // Returning empty drafts with an explanation beats inventing encouragement.
    throw new RemarksError(
      `No marks or attendance have been recorded for ${args.className} yet, so there is nothing to base a remark on. Enter the marks first, then draft.`,
      "no_evidence",
      409
    );
  }

  if (skipped.length > 0) {
    notes.push(
      `${skipped.length} student(s) skipped — no marks or attendance recorded for them yet.`
    );
  }

  const maxWords = args.maxWords ?? MAX_WORDS_DEFAULT;
  const started = Date.now();

  const client = getAiClient();
  let response;
  try {
    response = await client.messages.create({
      model: AI_MODELS.remarks,
      max_tokens: AI_MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: {
        effort: AI_EFFORT.remarks,
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              drafts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    student_id: { type: "string" },
                    remark: { type: "string" },
                    grounded_on: { type: "array", items: { type: "string" } },
                  },
                  required: ["student_id", "remark", "grounded_on"],
                  additionalProperties: false,
                },
              },
            },
            required: ["drafts"],
            additionalProperties: false,
          },
        },
      },
      system: [
        {
          type: "text",
          text: buildRemarksSystemPrompt(args.tone, maxWords),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Class ${args.className}, ${args.examName}.\n\n${JSON.stringify(
            usable.map(toModelShape)
          )}`,
        },
      ],
    });
  } catch (err) {
    console.error("[ai.remarks] model call failed:", err);
    throw new RemarksError(
      "Couldn't draft remarks just now. You can still write them by hand.",
      "model_error",
      502
    );
  }

  await recordMessage({
    admin,
    conversationId: args.conversationId,
    seq: 1,
    role: "assistant",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? undefined,
    stopReason: response.stop_reason,
    latencyMs: Date.now() - started,
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { drafts?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RemarksError(
      "The drafts came back in an unexpected shape. Nothing was changed.",
      "model_error",
      502
    );
  }

  // Only keep drafts for students we actually sent. A student_id the model
  // invented, or one outside this class, is dropped rather than trusted.
  const allowed = new Set(usable.map((s) => s.studentId));
  const drafts: RemarkDraft[] = [];
  for (const raw of Array.isArray(parsed.drafts) ? parsed.drafts : []) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const studentId = typeof d.student_id === "string" ? d.student_id : null;
    const remark = typeof d.remark === "string" ? d.remark.trim() : "";
    if (!studentId || !allowed.has(studentId) || !remark) continue;
    drafts.push({
      student_id: studentId,
      remark,
      grounded_on: Array.isArray(d.grounded_on)
        ? d.grounded_on.filter((g): g is string => typeof g === "string")
        : [],
    });
  }

  if (drafts.length < usable.length) {
    notes.push(
      `${usable.length - drafts.length} student(s) came back without a usable draft — write those by hand.`
    );
  }

  await recordToolCall({
    admin,
    conversationId: args.conversationId,
    messageSeq: 1,
    toolName: "draft_class_remarks",
    argsRaw: {
      class_id: args.classId,
      exam_type_id: args.examTypeId,
      tone: args.tone,
      max_words: maxWords,
    },
    rowCount: drafts.length,
    fieldKeys: ["remark"],
    durationMs: Date.now() - started,
  });

  return { drafts, skipped, notes };
}

/** Compact projection — the model does not need ids it cannot use, or nulls. */
function toModelShape(student: RemarkEvidence) {
  return {
    student_id: student.studentId,
    name: student.name,
    overall: student.overall ?? undefined,
    subjects: student.subjects.length > 0 ? student.subjects : undefined,
    attendance:
      student.attendance.total > 0
        ? {
            percent: student.attendance.percent,
            present: student.attendance.present,
            total: student.attendance.total,
          }
        : undefined,
    has_existing_remark: student.existingRemark ? true : undefined,
  };
}

function buildRemarksSystemPrompt(
  tone: "warm" | "formal" | "neutral",
  maxWords: number
): string {
  const toneLine = {
    warm: "Warm and encouraging, the way a class teacher who likes the child would write.",
    formal: "Formal and measured, suitable for an official record.",
    neutral: "Plain and factual, without warmth or severity.",
  }[tone];

  return `You are drafting report-card remarks for an Indian school. A class teacher will read every one, edit what they want, and decide what is saved. You are producing a first draft, not a final record.

You will be given one JSON array of students, each with their marks, subject-wise performance and attendance. Return one draft per student.

## Rules

- **Never state a fact that is not in that student's data.** No invented incidents, no "participates well in class", no comments on behaviour, friends, family or attitude. You only know marks and attendance.
- Address the child by first name, once.
- ${maxWords} words maximum. Shorter is better. A report card has a small box.
- ${toneLine}
- Name at least one specific subject where the data supports it.
- Where a subject is weak, say what to work on — never that the child is weak. "Needs more practice in Mathematics", not "is poor at Mathematics".
- If attendance is below about 75%, mention it plainly. Otherwise do not raise it.
- Do not mention grades, divisions or ranks the data does not contain.
- Never compare one student to another.
- Write in English.

## grounded_on

For each draft, list the evidence you actually used, as short human-readable strings — for example ["Mathematics 41%", "attendance 62%", "overall 78%"]. The teacher sees this next to the draft to check the remark is about this child. Do not list evidence you did not use.

Return only the JSON object.`;
}
