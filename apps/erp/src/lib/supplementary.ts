// Supplementary exam eligibility + substitution helpers (Phase 8).
//
// A student is eligible for supplementary in a subject when, for the
// chosen parent exam:
//   1. Their raw marks fall below the per-subject pass threshold
//      (failing in the main attempt).
//   2. Their raw marks are >= `min_for_supplementary` from result_master
//      (close enough to pass that a retest is warranted).
// Per-student count is capped at `max_supplementary_subjects` (default 2).
// When more subjects qualify than the cap allows, we keep the ones with
// the *smallest* gap-to-pass — those are the most likely to pass on retest.
//
// Substitution lifts a passed `supplementary_attempts` row into the
// per-subject result feed. The pass-action knob on result_master decides
// whether the substituted mark is the actual retest score
// ('use_retest_marks') or the threshold itself ('cap_at_pass_mark', most
// common — discourages students banking points for the supplementary).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SupplementaryEligibleEntry {
  student_id: string;
  full_name: string;
  admission_no: string;
  roll_number: number | null;
  subject_id: string;
  subject_name: string;
  marks_obtained: number;
  max_marks: number;
  pass_threshold_marks: number;
  gap_to_pass: number;
  has_attempt: boolean;
  attempt_passed: boolean | null;
  attempt_marks: number | null;
}

export interface SupplementaryEligibleResult {
  meta: {
    class_id: string;
    parent_exam_type_id: string;
    has_result_master: boolean;
    pass_mark_mode: "percentage" | "raw_marks";
    pass_mark_value: number;
    min_for_supplementary: number | null;
    max_supplementary_subjects: number;
    supplementary_pass_action: "cap_at_pass_mark" | "use_retest_marks";
  };
  entries: SupplementaryEligibleEntry[];
}

export async function buildSupplementaryEligible(
  supabase: SupabaseClient,
  classId: string,
  parentExamTypeId: string
): Promise<SupplementaryEligibleResult | null> {
  const [{ data: cls }, { data: exam }] = await Promise.all([
    supabase
      .from("classes")
      .select("id, academic_year_id")
      .eq("id", classId)
      .maybeSingle(),
    supabase
      .from("exam_types")
      .select("id, max_marks")
      .eq("id", parentExamTypeId)
      .maybeSingle(),
  ]);
  if (!cls || !exam) return null;

  const { data: master } = await supabase
    .from("result_masters")
    .select(
      "id, pass_mark_mode, pass_mark_value, min_for_supplementary, max_supplementary_subjects, supplementary_pass_action"
    )
    .eq("class_id", cls.id)
    .eq("academic_year_id", cls.academic_year_id)
    .maybeSingle();

  const passMarkMode =
    (master?.pass_mark_mode as "percentage" | "raw_marks") ?? "percentage";
  const passMarkValue = Number(master?.pass_mark_value ?? 33);
  const minForSupp =
    master?.min_for_supplementary === null ||
    master?.min_for_supplementary === undefined
      ? null
      : Number(master.min_for_supplementary);
  const maxSuppSubjects = Number(master?.max_supplementary_subjects ?? 2);
  const passAction = (master?.supplementary_pass_action ??
    "cap_at_pass_mark") as "cap_at_pass_mark" | "use_retest_marks";

  // Subject set + per-subject overrides
  let subjects: Array<{
    subject_id: string;
    subject_name: string;
    pass_mark_value_override: number | null;
  }> = [];
  if (master?.id) {
    const { data: rms } = await supabase
      .from("result_master_subjects")
      .select("subject_id, pass_mark_value_override, subjects(name)")
      .eq("result_master_id", master.id);
    subjects = (rms ?? []).map((row) => {
      const sub = row.subjects as unknown as { name: string } | null;
      return {
        subject_id: row.subject_id as string,
        subject_name: sub?.name ?? "",
        pass_mark_value_override:
          row.pass_mark_value_override === null ||
          row.pass_mark_value_override === undefined
            ? null
            : Number(row.pass_mark_value_override),
      };
    });
  } else {
    const { data: cs } = await supabase
      .from("class_subjects")
      .select("subjects(id, name)")
      .eq("class_id", classId);
    subjects = (cs ?? [])
      .map((row) => {
        const sub = row.subjects as unknown as {
          id: string;
          name: string;
        } | null;
        if (!sub) return null;
        return {
          subject_id: sub.id,
          subject_name: sub.name,
          pass_mark_value_override: null,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }
  const subjectIds = subjects.map((s) => s.subject_id);
  const subjectMeta = new Map(subjects.map((s) => [s.subject_id, s]));

  // Active enrollments
  const { data: enrolls } = await supabase
    .from("student_enrollments")
    .select("student_id, roll_number, students(id, full_name, admission_no)")
    .eq("class_id", classId)
    .eq("status", "active");
  const studentMeta = new Map<
    string,
    { full_name: string; admission_no: string; roll_number: number | null }
  >();
  for (const e of enrolls ?? []) {
    const s = e.students as unknown as {
      id: string;
      full_name: string;
      admission_no: string;
    } | null;
    if (!s) continue;
    studentMeta.set(s.id, {
      full_name: s.full_name,
      admission_no: s.admission_no,
      roll_number: (e.roll_number as number | null) ?? null,
    });
  }

  if (studentMeta.size === 0 || subjectIds.length === 0) {
    return {
      meta: {
        class_id: classId,
        parent_exam_type_id: parentExamTypeId,
        has_result_master: Boolean(master?.id),
        pass_mark_mode: passMarkMode,
        pass_mark_value: passMarkValue,
        min_for_supplementary: minForSupp,
        max_supplementary_subjects: maxSuppSubjects,
        supplementary_pass_action: passAction,
      },
      entries: [],
    };
  }

  // Original results for this exam
  const { data: results } = await supabase
    .from("results")
    .select("student_id, subject_id, marks_obtained, max_marks")
    .eq("class_id", classId)
    .eq("exam_type_id", parentExamTypeId)
    .in("student_id", [...studentMeta.keys()])
    .in("subject_id", subjectIds);

  // Pre-existing supplementary attempts
  const { data: attempts } = await supabase
    .from("supplementary_attempts")
    .select("student_id, subject_id, marks_obtained, passed")
    .eq("parent_exam_type_id", parentExamTypeId)
    .eq("class_id", classId);
  const attemptKey = (sid: string, subId: string) => `${sid}|${subId}`;
  const attemptMap = new Map<
    string,
    { marks: number; passed: boolean }
  >();
  for (const a of attempts ?? []) {
    attemptMap.set(
      attemptKey(a.student_id as string, a.subject_id as string),
      {
        marks: Number(a.marks_obtained),
        passed: Boolean(a.passed),
      }
    );
  }

  // Build candidate entries (every failing+eligible row), then per-student
  // cap to N keeping the smallest gap_to_pass.
  type Candidate = SupplementaryEligibleEntry & { _gap: number };
  const byStudent = new Map<string, Candidate[]>();
  for (const r of results ?? []) {
    const sid = r.student_id as string;
    const subId = r.subject_id as string;
    const sm = studentMeta.get(sid);
    const submeta = subjectMeta.get(subId);
    if (!sm || !submeta) continue;

    const obtained = Number(r.marks_obtained);
    const max = Number(r.max_marks);
    const subjectPassValue =
      submeta.pass_mark_value_override ?? passMarkValue;

    const passThresholdMarks =
      passMarkMode === "percentage"
        ? (subjectPassValue / 100) * max
        : subjectPassValue;

    const minSuppMarks =
      minForSupp === null
        ? 0
        : passMarkMode === "percentage"
          ? (minForSupp / 100) * max
          : minForSupp;

    const failing = obtained < passThresholdMarks;
    const eligible = failing && obtained >= minSuppMarks;

    const attempt = attemptMap.get(attemptKey(sid, subId));
    // Keep already-existing attempts even if eligibility changes (admin
    // may want to view historical attempts that were valid at entry time).
    if (!eligible && !attempt) continue;

    const cand: Candidate = {
      student_id: sid,
      full_name: sm.full_name,
      admission_no: sm.admission_no,
      roll_number: sm.roll_number,
      subject_id: subId,
      subject_name: submeta.subject_name,
      marks_obtained: obtained,
      max_marks: max,
      pass_threshold_marks: passThresholdMarks,
      gap_to_pass: Math.max(0, passThresholdMarks - obtained),
      has_attempt: Boolean(attempt),
      attempt_passed: attempt ? attempt.passed : null,
      attempt_marks: attempt ? attempt.marks : null,
      _gap: passThresholdMarks - obtained,
    };
    const list = byStudent.get(sid) ?? [];
    list.push(cand);
    byStudent.set(sid, list);
  }

  const entries: SupplementaryEligibleEntry[] = [];
  for (const [, cands] of byStudent) {
    cands.sort((a, b) => a._gap - b._gap);
    // Keep all attempts (admin oversight) plus eligible candidates up to the
    // cap. If a student has more eligible candidates than the cap allows,
    // ones outside the cap are dropped only if they don't already have an
    // attempt row.
    const kept: Candidate[] = [];
    let eligibleCount = 0;
    for (const c of cands) {
      if (c.has_attempt) {
        kept.push(c);
        continue;
      }
      if (eligibleCount < maxSuppSubjects) {
        kept.push(c);
        eligibleCount++;
      }
    }
    for (const c of kept) {
      const { _gap: _drop, ...rest } = c;
      void _drop;
      entries.push(rest);
    }
  }

  // Stable ordering: roll, then subject name.
  entries.sort((a, b) => {
    const ra = a.roll_number ?? Number.POSITIVE_INFINITY;
    const rb = b.roll_number ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.subject_name.localeCompare(b.subject_name);
  });

  return {
    meta: {
      class_id: classId,
      parent_exam_type_id: parentExamTypeId,
      has_result_master: Boolean(master?.id),
      pass_mark_mode: passMarkMode,
      pass_mark_value: passMarkValue,
      min_for_supplementary: minForSupp,
      max_supplementary_subjects: maxSuppSubjects,
      supplementary_pass_action: passAction,
    },
    entries,
  };
}

/**
 * Apply passed supplementary attempts to the raw `results` array consumed by
 * `computeFromFixtures`. Returns a new array with substitutions applied —
 * does not mutate the input.
 *
 * Substitution rules:
 *   - Only attempts with `passed = true` modify results (failures stay as
 *     the original mark — supplementary failure doesn't help).
 *   - When `pass_action = 'cap_at_pass_mark'`: substitute = pass_threshold
 *     for that (subject × parent exam), in the same units the underlying
 *     row already uses (raw marks).
 *   - When `pass_action = 'use_retest_marks'`: substitute =
 *     attempt.marks_obtained.
 *
 * Caller is responsible for fetching attempts + master + per-subject pass
 * thresholds; this function is pure.
 */
export interface SupplementaryAttemptForSubstitution {
  student_id: string;
  parent_exam_type_id: string;
  subject_id: string;
  passed: boolean;
  marks_obtained: number;
}

export function applySupplementarySubstitution(
  results: ReadonlyArray<{
    exam_type_id: string;
    subject_id: string;
    marks_obtained: number;
    max_marks: number;
  }>,
  attempts: ReadonlyArray<SupplementaryAttemptForSubstitution>,
  passAction: "cap_at_pass_mark" | "use_retest_marks",
  passThresholdLookup: (
    subject_id: string,
    max_marks: number
  ) => number
): typeof results {
  if (attempts.length === 0) return results;
  const lookup = new Map<string, SupplementaryAttemptForSubstitution>();
  for (const a of attempts) {
    if (!a.passed) continue;
    lookup.set(`${a.parent_exam_type_id}|${a.subject_id}`, a);
  }
  if (lookup.size === 0) return results;

  return results.map((r) => {
    const a = lookup.get(`${r.exam_type_id}|${r.subject_id}`);
    if (!a) return r;
    // Audit H8: clamp the substituted mark to the parent exam's max so a
    // supplementary paper sat at /100 can't poison a /80 row into > 100%.
    // The DB CHECK on supplementary_attempts.marks_obtained constrains the
    // attempt against ITS OWN max, not the parent's, so the clamp must
    // happen here at substitution time.
    const sub =
      passAction === "cap_at_pass_mark"
        ? passThresholdLookup(r.subject_id, r.max_marks)
        : Math.min(a.marks_obtained, r.max_marks);
    return { ...r, marks_obtained: sub };
  });
}
