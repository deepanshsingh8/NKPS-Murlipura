// Pure, deterministic final-result computation for Phase 3 Report Cards.
// Loads `result_master` rules + exam configs + raw `results` and produces
// a resolved FinalResult. Returns null for legacy-fallback (no master row,
// or master with zero subjects).

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeGrade, resolveGradeScaleForClass } from "@/lib/grading";
import type { GradeBand, GradeScale } from "@/lib/grading";
import { applySupplementarySubstitution } from "@/lib/supplementary";
import type {
  ExamKind,
  FinalResult,
  FinalSubject,
  FinalSubjectExamContribution,
  ResultMaster,
  ResultMasterGraceCondition,
  ResultMasterPassCriteriaType,
  ResultMasterPassMarkMode,
  ResultMasterRoundingMode,
  ResultMasterSubjectRole,
} from "@nkps/shared/types";

export const SUPPORTED_PASS_CRITERIA_TYPES = [
  "all_main_subjects",
  "overall_percentage",
  "main_and_overall",
  "pass_n_subjects",
  "allow_one_fail",
] as const satisfies readonly ResultMasterPassCriteriaType[];

interface RMSubjectRow {
  id: string;
  subject_id: string;
  role: ResultMasterSubjectRole;
  pass_mark_value_override: number | null;
  sort_order: number;
  subject_name: string;
}

interface ExamConfigRow {
  exam_type_id: string;
  weightage: number | null;
  // Per-class override for the exam's `max_marks`. When set, the result
  // engine rescales every student's row for this exam: their `marks_obtained`
  // is treated as the numerator over `max_marks_override` instead of the raw
  // `results.max_marks`. Null = no override (use the raw value).
  max_marks_override: number | null;
  sort_order: number;
  exam_name: string;
  kind: ExamKind;
}

interface ResultRow {
  exam_type_id: string;
  subject_id: string;
  marks_obtained: number;
  max_marks: number;
}

export interface ComputeFixtures {
  master: ResultMaster;
  subjects: RMSubjectRow[];
  exam_configs: ExamConfigRow[];
  results: ResultRow[];
  scale: GradeScale | null;
  student_id: string;
  class_id: string;
  academic_year_id: string;
}

function roundNumber(
  value: number,
  mode: ResultMasterRoundingMode,
  precision: number
): number {
  if (mode === "none" || !Number.isFinite(value)) return value;
  const factor = Math.pow(10, Math.max(0, precision));
  const scaled = value * factor;
  const floorScaled = Math.floor(scaled);
  const frac = scaled - floorScaled;
  switch (mode) {
    case "half_up":
      return (frac >= 0.5 ? floorScaled + 1 : floorScaled) / factor;
    case "half_down":
      return (frac > 0.5 ? floorScaled + 1 : floorScaled) / factor;
    case "ceil":
      return Math.ceil(scaled) / factor;
    case "floor":
      return Math.floor(scaled) / factor;
  }
}

export interface PassCriteriaContext {
  main_subjects: FinalSubject[];
  optional_subjects: FinalSubject[];
  main_aggregate_pct: number;
}

export function resolvePassCriteria(
  type: string,
  config: Record<string, unknown>,
  ctx: PassCriteriaContext
): { passed: boolean; pass_reason: string } {
  const mainCount = ctx.main_subjects.length;
  const passedCount = ctx.main_subjects.filter((s) => s.passed).length;
  const failedCount = mainCount - passedCount;
  const threshold = Number(config.overall_pct ?? 0);
  const agg = ctx.main_aggregate_pct;

  switch (type) {
    case "all_main_subjects": {
      const p = mainCount > 0 && passedCount === mainCount;
      return {
        passed: p,
        pass_reason: p
          ? `All ${mainCount} main subject${mainCount === 1 ? "" : "s"} passed`
          : `${failedCount} main subject${failedCount === 1 ? "" : "s"} below threshold`,
      };
    }
    case "overall_percentage":
      return {
        passed: agg >= threshold,
        pass_reason: `Main aggregate ${agg}% ${agg >= threshold ? "≥" : "<"} ${threshold}%`,
      };
    case "main_and_overall": {
      const allPassed = mainCount > 0 && passedCount === mainCount;
      const overallOk = agg >= threshold;
      return {
        passed: allPassed && overallOk,
        pass_reason:
          allPassed && overallOk
            ? `All main subjects passed and aggregate ≥ ${threshold}%`
            : !allPassed
              ? `${failedCount} main subject${failedCount === 1 ? "" : "s"} below threshold`
              : `Aggregate ${agg}% < ${threshold}%`,
      };
    }
    case "pass_n_subjects": {
      const n = Number(config.n ?? 0);
      return {
        passed: passedCount >= n,
        pass_reason: `${passedCount} of ${mainCount} main subjects passed (need ${n})`,
      };
    }
    case "allow_one_fail": {
      const overallOk = agg >= threshold;
      const p = failedCount <= 1 && overallOk;
      return {
        passed: p,
        pass_reason: p
          ? `At most one main subject failed and aggregate ≥ ${threshold}%`
          : failedCount > 1
            ? `${failedCount} main subjects failed (max 1 allowed)`
            : `Aggregate ${agg}% < ${threshold}%`,
      };
    }
    default:
      throw new Error(
        `Unknown pass_criteria_type "${type}". Register it in resolvePassCriteria().`
      );
  }
}

export function describePassCriteria(
  type: string,
  config: Record<string, unknown>
): string {
  switch (type) {
    case "all_main_subjects":
      return "All main subjects must pass";
    case "overall_percentage":
      return `Main aggregate ≥ ${config.overall_pct ?? "?"}%`;
    case "main_and_overall":
      return `All main subjects pass AND aggregate ≥ ${config.overall_pct ?? "?"}%`;
    case "pass_n_subjects":
      return `Pass at least ${config.n ?? "?"} main subjects`;
    case "allow_one_fail":
      return `Allow one main fail if aggregate ≥ ${config.overall_pct ?? "?"}%`;
    default:
      return type;
  }
}

export function computeFromFixtures(fx: ComputeFixtures): FinalResult {
  const { master, subjects, exam_configs, results, scale } = fx;
  const bands: GradeBand[] = scale?.bands ?? [];
  const { rounding_mode: rMode, rounding_precision: rPrec } = master;
  const round = (v: number) => roundNumber(v, rMode, rPrec);

  // Raw-marks rounding (opt-in). Keep pre-round lookup for audit.
  const preRound = new Map<string, number>();
  for (const r of results) preRound.set(`${r.exam_type_id}::${r.subject_id}`, r.marks_obtained);
  const effResults: ResultRow[] = master.round_raw_marks
    ? results.map((r) => ({ ...r, marks_obtained: round(r.marks_obtained) }))
    : results;

  // Best-of filter: keep top-N by per-exam overall pct. Ties → sort_order, then name.
  const kept = new Map<string, ExamConfigRow>();
  for (const ec of exam_configs) kept.set(ec.exam_type_id, ec);
  const subjectIdSet = new Set(subjects.map((s) => s.subject_id));
  const applyBestOf = (kind: ExamKind, bestOf: number | null) => {
    if (!bestOf || bestOf <= 0) return;
    const ofKind = exam_configs.filter((e) => e.kind === kind);
    if (ofKind.length <= bestOf) return;
    const scored = ofKind.map((ec) => {
      const rel = effResults.filter(
        (r) => r.exam_type_id === ec.exam_type_id && subjectIdSet.has(r.subject_id)
      );
      const avg =
        rel.length > 0
          ? rel.reduce(
              (a, r) => a + (r.max_marks > 0 ? (r.marks_obtained / r.max_marks) * 100 : 0),
              0
            ) / rel.length
          : 0;
      return { ec, avg };
    });
    scored.sort((a, b) =>
      b.avg !== a.avg
        ? b.avg - a.avg
        : a.ec.sort_order !== b.ec.sort_order
          ? a.ec.sort_order - b.ec.sort_order
          : a.ec.exam_name.localeCompare(b.ec.exam_name)
    );
    const keepIds = new Set(scored.slice(0, bestOf).map((s) => s.ec.exam_type_id));
    for (const ec of ofKind) if (!keepIds.has(ec.exam_type_id)) kept.delete(ec.exam_type_id);
  };
  applyBestOf("class_test", master.class_test_best_of);
  applyBestOf("practical", master.practical_best_of);
  const bestOfApplied =
    (master.class_test_best_of ?? 0) > 0 || (master.practical_best_of ?? 0) > 0;

  // Per-subject weighted pct.
  const perSubject: FinalSubject[] = subjects
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((rms) => {
      const contributions: FinalSubjectExamContribution[] = [];
      for (const ec of kept.values()) {
        const row = effResults.find(
          (r) => r.exam_type_id === ec.exam_type_id && r.subject_id === rms.subject_id
        );
        if (!row) continue;
        const weight = ec.weightage ?? 0;
        if (weight <= 0) continue;
        const pct = row.max_marks > 0 ? (row.marks_obtained / row.max_marks) * 100 : 0;
        contributions.push({
          exam_type_id: ec.exam_type_id,
          exam_name: ec.exam_name,
          marks_obtained: row.marks_obtained,
          marks_obtained_pre_round:
            preRound.get(`${ec.exam_type_id}::${rms.subject_id}`) ?? row.marks_obtained,
          max_marks: row.max_marks,
          pct,
          weight,
        });
      }
      const totalWeight = contributions.reduce((a, c) => a + c.weight, 0);
      const rawPct =
        totalWeight > 0
          ? contributions.reduce((a, c) => a + c.pct * c.weight, 0) / totalWeight
          : 0;
      return {
        subject_id: rms.subject_id,
        subject_name: rms.subject_name,
        role: rms.role,
        exam_contributions: contributions,
        raw_pct: rawPct,
        grace_applied: 0,
        final_pct: rawPct,
        effective_pass_mark_pct: 0,
        grade: null,
        passed: false,
      };
    });

  // Effective pass threshold per subject. For raw_marks mode, convert the
  // raw threshold using the weight-averaged max across contributing exams —
  // Σ(max × weight) / Σ(weight) — so "33 raw marks" scales consistently
  // when multiple exams with different maxes mix.
  const overrideBySubject = new Map(
    subjects.map((s) => [s.subject_id, s.pass_mark_value_override] as const)
  );
  for (const fs of perSubject) {
    const raw = overrideBySubject.get(fs.subject_id) ?? master.pass_mark_value;
    if (master.pass_mark_mode === "percentage") {
      fs.effective_pass_mark_pct = raw;
    } else {
      const tw = fs.exam_contributions.reduce((a, c) => a + c.weight, 0);
      const effMax =
        tw > 0
          ? fs.exam_contributions.reduce((a, c) => a + c.max_marks * c.weight, 0) / tw
          : 0;
      fs.effective_pass_mark_pct = effMax > 0 ? (raw / effMax) * 100 : 0;
    }
  }

  // Grace pass (before pass check; running total capped at total_max).
  let graceTotal = 0;
  const { grace_marks_per_subject_max: perCap, grace_marks_total_max: totalCap } = master;
  const cond: ResultMasterGraceCondition = master.grace_marks_condition;
  if (perCap > 0) {
    for (const fs of perSubject) {
      if (graceTotal >= totalCap) break;
      const remaining = Math.max(0, totalCap - graceTotal);
      const shortfall = fs.effective_pass_mark_pct - fs.raw_pct;
      let grant = 0;
      if (cond === "failing_only") {
        if (shortfall > 0) grant = Math.min(shortfall, perCap, remaining);
      } else {
        grant = Math.min(perCap, remaining);
      }
      if (grant > 0) {
        fs.grace_applied = grant;
        graceTotal += grant;
      }
    }
  }

  // Round + pass check + grade per subject.
  for (const fs of perSubject) {
    fs.final_pct = round(fs.raw_pct + fs.grace_applied);
    fs.passed = fs.final_pct >= fs.effective_pass_mark_pct;
    fs.grade = bands.length > 0 ? computeGrade(fs.final_pct, bands) : null;
  }

  // Main aggregate + overall.
  const mains = perSubject.filter((s) => s.role === "main");
  const optionals = perSubject.filter((s) => s.role === "optional");
  const mainRaw =
    mains.length > 0 ? mains.reduce((a, s) => a + s.final_pct, 0) / mains.length : 0;
  const mainTotal = round(mainRaw);
  const { passed, pass_reason } = resolvePassCriteria(
    master.pass_criteria_type,
    master.pass_criteria_config,
    { main_subjects: mains, optional_subjects: optionals, main_aggregate_pct: mainTotal }
  );

  const roundingSummary =
    rMode === "none"
      ? "No rounding"
      : `${rMode} @ ${rPrec}dp${master.round_raw_marks ? " (incl. raw marks)" : ""}`;

  // CBSE division — derive from the rounded `main_total_pct`. Failing
  // students never get a division; passing students at <33 also get null
  // (they shouldn't have passed under CBSE rules but we don't fight the
  // pass_criteria here — the report card just won't print a division).
  const division = computeCbseDivision(passed, mainTotal, master);

  return {
    student_id: fx.student_id,
    class_id: fx.class_id,
    academic_year_id: fx.academic_year_id,
    main_subjects: mains,
    optional_subjects: optionals,
    overall: {
      main_total_pct: mainTotal,
      main_total_pct_raw: mainRaw,
      grade: bands.length > 0 ? computeGrade(mainTotal, bands) : null,
      passed,
      pass_reason,
      grace_applied_total: graceTotal,
      division,
    },
    config_applied: {
      result_master_id: master.id,
      grade_scale_name: scale?.name ?? null,
      best_of_applied: bestOfApplied,
      rounding_summary: roundingSummary,
    },
  };
}

// CBSE division: First ≥60, Second ≥45, Third ≥33. Returns null when the
// student didn't pass overall, when the result_master has divisions disabled,
// or when the (rounded) percentage is below the Third Division threshold.
function computeCbseDivision(
  passed: boolean,
  mainTotalPct: number,
  master: ResultMaster
): "first" | "second" | "third" | null {
  if (!master.show_division) return null;
  if (!passed) return null;
  // Future-proof: today only `cbse` is recognized; the constraint already
  // blocks unknown values. If we add 'state-board' etc. later, branch here.
  if (mainTotalPct >= 60) return "first";
  if (mainTotalPct >= 45) return "second";
  if (mainTotalPct >= 33) return "third";
  return null;
}

// Numeric-as-string coercion for DB rows.
function n(v: unknown, fb = 0): number {
  return v === null || v === undefined ? fb : Number(v);
}
function nOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function coerceMaster(row: Record<string, unknown>): ResultMaster {
  return {
    id: row.id as string,
    class_id: row.class_id as string,
    academic_year_id: row.academic_year_id as string,
    pass_mark_mode: row.pass_mark_mode as ResultMasterPassMarkMode,
    pass_mark_value: n(row.pass_mark_value),
    pass_criteria_type: row.pass_criteria_type as string,
    pass_criteria_config: (row.pass_criteria_config ?? {}) as Record<string, unknown>,
    show_rank: Boolean(row.show_rank),
    show_extra_separately: Boolean(row.show_extra_separately),
    include_non_scholastic: Boolean(row.include_non_scholastic),
    non_scholastic_placement: row.non_scholastic_placement as ResultMaster["non_scholastic_placement"],
    grade_scale_id: (row.grade_scale_id as string | null) ?? null,
    grace_marks_per_subject_max: n(row.grace_marks_per_subject_max),
    grace_marks_total_max: n(row.grace_marks_total_max),
    grace_marks_condition: row.grace_marks_condition as ResultMasterGraceCondition,
    rounding_mode: row.rounding_mode as ResultMasterRoundingMode,
    rounding_precision: n(row.rounding_precision),
    round_raw_marks: Boolean(row.round_raw_marks),
    class_test_best_of: nOrNull(row.class_test_best_of),
    practical_best_of: nOrNull(row.practical_best_of),
    min_for_supplementary: nOrNull(row.min_for_supplementary),
    max_supplementary_subjects: n(row.max_supplementary_subjects, 2),
    supplementary_pass_action:
      (row.supplementary_pass_action as ResultMaster["supplementary_pass_action"]) ??
      "cap_at_pass_mark",
    // Phase 9 — division labels. Older deployments may not have these columns
    // yet; default to enabled + CBSE so the UI behaves identically until the
    // migration runs. The CHECK constraint in migration 037 locks
    // division_scheme to 'cbse' today; adding another scheme requires
    // extending both the CHECK and the divisionLabel resolver below.
    show_division: row.show_division === undefined ? true : Boolean(row.show_division),
    division_scheme:
      (row.division_scheme as ResultMaster["division_scheme"]) ?? "cbse",
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

async function loadScaleById(
  supabase: SupabaseClient,
  scaleId: string
): Promise<GradeScale | null> {
  const { data: scale } = await supabase
    .from("grade_scales")
    .select("id, name, scope, is_default")
    .eq("id", scaleId)
    .maybeSingle();
  if (!scale) return null;
  const { data: bands } = await supabase
    .from("grade_bands")
    .select("label, min_pct, max_pct, remark, sort_order")
    .eq("grade_scale_id", scaleId)
    .order("sort_order", { ascending: true });
  return {
    id: scale.id as string,
    name: scale.name as string,
    scope: scale.scope as "scholastic" | "non_scholastic",
    is_default: scale.is_default as boolean,
    bands: (bands ?? []).map((b) => ({
      label: b.label as string,
      min_pct: Number(b.min_pct),
      max_pct: Number(b.max_pct),
      remark: (b.remark as string | null) ?? null,
      sort_order: b.sort_order as number,
    })),
  };
}

export async function computeFinalResult(
  supabase: SupabaseClient,
  params: {
    student_id: string;
    academic_year_id: string;
    /**
     * Privacy gate (audit H2). When false, only `is_published=true` results
     * and `is_published=true` class_test_results are pulled — the live
     * compute path is what students/parents see when no finalized snapshot
     * exists, and they must NOT see marks a teacher just typed.
     *
     * Defaults to `true` to preserve admin/teacher behavior (live preview,
     * rank compute, finalize-time snapshot building all need the full set).
     * Privacy-sensitive callers (the public report-card PDF route, the
     * student/parent final-result endpoint) MUST pass `false` when the
     * caller is a student or parent.
     */
    includeUnpublished?: boolean;
  }
): Promise<FinalResult | null> {
  const { student_id, academic_year_id } = params;
  const includeUnpublished = params.includeUnpublished ?? true;

  // Multi-active-enrollment safety: a student who transferred mid-year may
  // have two `status='active'` rows for the same year. Pick the most recent
  // (created_at desc) and surface a console warning so the admin knows the
  // year-final compute used a specific enrollment. We deliberately don't
  // throw here — `computeFinalResult` is called from many low-stakes places
  // (live preview, rank compute) where one-of-many is fine. The finalize
  // path wraps this with `buildYearFinalSnapshot`, which DOES throw on
  // multi-enrollment so the finalize loop can surface a per-student error.
  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("class_id, created_at")
    .eq("student_id", student_id)
    .eq("academic_year_id", academic_year_id)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (!enrollments || enrollments.length === 0) return null;
  if (enrollments.length > 1) {
    console.warn(
      `[computeFinalResult] student ${student_id} has ${enrollments.length} active enrollments for year ${academic_year_id}; using most recent`
    );
  }
  const classId = enrollments[0].class_id as string;

  const { data: masterRow } = await supabase
    .from("result_masters")
    .select("*")
    .eq("class_id", classId)
    .eq("academic_year_id", academic_year_id)
    .maybeSingle();
  if (!masterRow) return null;
  const master = coerceMaster(masterRow);

  const [subjectsRes, configsRes, scale] = await Promise.all([
    supabase
      .from("result_master_subjects")
      .select("id, subject_id, role, pass_mark_value_override, sort_order, subjects(name)")
      .eq("result_master_id", master.id),
    supabase
      .from("class_exam_configs")
      .select(
        "exam_type_id, weightage, max_marks_override, sort_order, is_applicable, exam_types(name, kind, academic_year_id)"
      )
      .eq("class_id", classId)
      .eq("is_applicable", true),
    master.grade_scale_id
      ? loadScaleById(supabase, master.grade_scale_id)
      : resolveGradeScaleForClass(supabase, classId, "scholastic"),
  ]);

  const subjects: RMSubjectRow[] = (subjectsRes.data ?? []).map((row) => {
    const sub = row.subjects as unknown as { name: string } | null;
    return {
      id: row.id as string,
      subject_id: row.subject_id as string,
      role: row.role as ResultMasterSubjectRole,
      pass_mark_value_override: nOrNull(row.pass_mark_value_override),
      sort_order: row.sort_order as number,
      subject_name: sub?.name ?? "",
    };
  });
  if (subjects.length === 0) return null;

  const examConfigs: ExamConfigRow[] = (configsRes.data ?? [])
    .map((row): ExamConfigRow | null => {
      const et = row.exam_types as unknown as {
        name: string;
        kind: ExamKind;
        academic_year_id: string;
      } | null;
      if (!et || et.academic_year_id !== academic_year_id) return null;
      return {
        exam_type_id: row.exam_type_id as string,
        weightage: nOrNull(row.weightage),
        max_marks_override: nOrNull(row.max_marks_override),
        sort_order: row.sort_order as number,
        exam_name: et.name,
        kind: et.kind,
      };
    })
    .filter((x): x is ExamConfigRow => x !== null);

  const examTypeIds = examConfigs.map((e) => e.exam_type_id);
  const subjectIds = subjects.map((s) => s.subject_id);
  let results: ResultRow[] = [];
  if (examTypeIds.length > 0 && subjectIds.length > 0) {
    let resQuery = supabase
      .from("results")
      .select("exam_type_id, subject_id, marks_obtained, max_marks")
      .eq("student_id", student_id)
      .in("exam_type_id", examTypeIds)
      .in("subject_id", subjectIds);
    if (!includeUnpublished) {
      // Privacy gate: students/parents only see published rows. The live-
      // compute path returns whatever is published right now — teachers'
      // unsaved or unpublished entries stay hidden.
      resQuery = resQuery.eq("is_published", true);
    }
    const { data: resRows } = await resQuery;
    // Apply per-class max_marks_override (if any). For an exam configured with
    // an override, every result row for that exam_type is treated as if its
    // max were the override — this is what the admin UI promises and what
    // makes "Class IX uses 50-mark English papers but Class X uses 100" work
    // without splitting the exam_type.
    const maxOverrideByExam = new Map<string, number>();
    for (const ec of examConfigs) {
      if (ec.max_marks_override !== null) {
        maxOverrideByExam.set(ec.exam_type_id, ec.max_marks_override);
      }
    }
    results = (resRows ?? []).map((r) => {
      const override = maxOverrideByExam.get(r.exam_type_id as string);
      const originalMax = Number(r.max_marks);
      const originalMarks = Number(r.marks_obtained);
      // Audit H9: when an override is set, rescale BOTH marks and max so
      // percentage is preserved. Previously only `max_marks` was replaced,
      // which meant a 60/100 row became 60/50 = 120% — phantom over-marks.
      // The override is conceptually "treat this exam as if it were out of
      // N for this class"; the student's percentage stays identical, the
      // raw_marks threshold (e.g. "needs 33 marks") now lives in the
      // override's marks-space.
      if (override !== undefined && originalMax > 0) {
        return {
          exam_type_id: r.exam_type_id as string,
          subject_id: r.subject_id as string,
          marks_obtained: (originalMarks / originalMax) * override,
          max_marks: override,
        };
      }
      return {
        exam_type_id: r.exam_type_id as string,
        subject_id: r.subject_id as string,
        marks_obtained: originalMarks,
        max_marks: originalMax,
      };
    });
  }

  // Class tests stored in the dedicated `class_tests` + `class_test_results`
  // tables (not in the `results` table) are folded into the engine here so
  // they participate in best-of selection, per-subject aggregates, and the
  // pass/fail decision exactly like exam_types-based contributions.
  //
  // The synthetic exam_type_id `ct:<uuid>` keeps the rest of the engine
  // unchanged — it just sees more rows. Only published, non-null-marks
  // class tests count.
  if (subjectIds.length > 0) {
    const { data: ctRows } = await supabase
      .from("class_tests")
      .select(
        "id, subject_id, name, max_marks, weightage, test_date"
      )
      .eq("class_id", classId)
      .in("subject_id", subjectIds)
      .eq("is_published", true);

    type CTRow = {
      id: string;
      subject_id: string;
      name: string;
      max_marks: number | string;
      weightage: number | string | null;
      test_date: string | null;
    };
    const tests = (ctRows ?? []) as CTRow[];

    if (tests.length > 0) {
      const testIds = tests.map((t) => t.id);
      const { data: ctResRows } = await supabase
        .from("class_test_results")
        .select("class_test_id, marks_obtained, max_marks")
        .eq("student_id", student_id)
        .in("class_test_id", testIds);

      const ctRes = new Map<
        string,
        { marks_obtained: number; max_marks: number }
      >();
      for (const r of ctResRows ?? []) {
        const m = r.marks_obtained;
        if (m === null || m === undefined) continue;
        ctRes.set(r.class_test_id as string, {
          marks_obtained: Number(m),
          max_marks: Number(r.max_marks),
        });
      }

      // Push class tests *after* the real exam configs so existing exams
      // keep their sort_order ranking when best-of compares them. Within
      // class tests, order by test_date ascending (older first), then by
      // synthetic id for determinism.
      tests.sort((a, b) => {
        if (a.test_date && b.test_date)
          return a.test_date.localeCompare(b.test_date);
        if (a.test_date) return -1;
        if (b.test_date) return 1;
        return a.id.localeCompare(b.id);
      });
      let synthSort = 1_000_000;
      for (const t of tests) {
        const synthId = `ct:${t.id}`;
        examConfigs.push({
          exam_type_id: synthId,
          weightage:
            t.weightage !== null && t.weightage !== undefined
              ? Number(t.weightage)
              : null,
          max_marks_override: null,
          sort_order: synthSort++,
          exam_name: t.name,
          kind: "class_test",
        });
        const matched = ctRes.get(t.id);
        if (matched) {
          results.push({
            exam_type_id: synthId,
            subject_id: t.subject_id,
            marks_obtained: matched.marks_obtained,
            max_marks: matched.max_marks,
          });
        }
      }
    }
  }

  // Phase 8: substitute passed supplementary attempts into the results
  // feed before per-subject pct compute. Only applies when at least one
  // attempt exists for this student in the relevant exam set.
  if (examTypeIds.length > 0 && subjectIds.length > 0) {
    const { data: suppRows } = await supabase
      .from("supplementary_attempts")
      .select(
        "student_id, parent_exam_type_id, subject_id, marks_obtained, passed"
      )
      .eq("student_id", student_id)
      .in("parent_exam_type_id", examTypeIds)
      .in("subject_id", subjectIds);
    const attempts = (suppRows ?? []).map((a) => ({
      student_id: a.student_id as string,
      parent_exam_type_id: a.parent_exam_type_id as string,
      subject_id: a.subject_id as string,
      passed: Boolean(a.passed),
      marks_obtained: Number(a.marks_obtained),
    }));
    if (attempts.length > 0) {
      const subjectOverride = new Map(
        subjects.map((s) => [s.subject_id, s.pass_mark_value_override])
      );
      const passThresholdLookup = (subjectId: string, maxMarks: number) => {
        const raw = subjectOverride.get(subjectId) ?? master.pass_mark_value;
        return master.pass_mark_mode === "percentage"
          ? (raw / 100) * maxMarks
          : raw;
      };
      results = applySupplementarySubstitution(
        results,
        attempts,
        master.supplementary_pass_action,
        passThresholdLookup
      ) as ResultRow[];
    }
  }

  return computeFromFixtures({
    master,
    subjects,
    exam_configs: examConfigs,
    results,
    scale,
    student_id,
    class_id: classId,
    academic_year_id,
  });
}

/**
 * Compute ranks for every active student in a (class, academic_year) cohort.
 *
 * Runs `computeFinalResult` in parallel per student and buckets results by
 * `overall.main_total_pct` descending. Ties share a rank and the next rank
 * skips by the tie-group size (1, 2, 2, 4 pattern).
 *
 * Students whose final result is null (no master, zero main subjects, or no
 * recorded marks) are skipped entirely — they simply don't appear in the
 * returned map.
 *
 * Cost: O(N) compute calls. Callers should gate invocation on
 * `result_master.show_rank` before paying for this.
 */
export async function computeRanksForClass(
  supabase: SupabaseClient,
  params: { class_id: string; academic_year_id: string }
): Promise<Map<string, number>> {
  const { class_id, academic_year_id } = params;

  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("student_id")
    .eq("class_id", class_id)
    .eq("academic_year_id", academic_year_id)
    .eq("status", "active");

  const studentIds = (enrollments ?? []).map((e) => e.student_id as string);
  if (studentIds.length === 0) return new Map();

  const results = await Promise.all(
    studentIds.map((sid) =>
      computeFinalResult(supabase, { student_id: sid, academic_year_id }).then(
        (fr) => ({ sid, fr })
      )
    )
  );

  const scored = results
    .filter((r): r is { sid: string; fr: FinalResult } => r.fr !== null)
    .map((r) => ({ sid: r.sid, pct: r.fr.overall.main_total_pct }))
    .sort((a, b) => b.pct - a.pct);

  const rankMap = new Map<string, number>();
  let lastPct: number | null = null;
  let lastRank = 0;
  for (let i = 0; i < scored.length; i++) {
    const { sid, pct } = scored[i];
    const rank = pct === lastPct ? lastRank : i + 1;
    rankMap.set(sid, rank);
    lastPct = pct;
    lastRank = rank;
  }
  return rankMap;
}
