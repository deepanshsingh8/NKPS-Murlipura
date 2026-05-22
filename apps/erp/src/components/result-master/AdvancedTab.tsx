"use client";

import { useEffect, useMemo, useState } from "react";
import { adminFetch, adminPatch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type {
  ResultMaster,
  ResultMasterGraceCondition,
  ResultMasterNonScholasticPlacement,
  ResultMasterRoundingMode,
} from "@nkps/shared/types";
import type { GradeScale } from "@/lib/grading";
import {
  mergeExamConfigsWithExamTypes,
  shallowEqualRecord,
  type ExamConfigWithType,
} from "./helpers";
import {
  WeightageSection,
  type WeightageRow,
} from "./advanced/WeightageSection";
import { BestOfSection } from "./advanced/BestOfSection";
import { GraceSection } from "./advanced/GraceSection";
import { RoundingSection } from "./advanced/RoundingSection";
import { NonScholasticSection } from "./advanced/NonScholasticSection";
import { DisplaySection } from "./advanced/DisplaySection";
import { GradeScaleSection } from "./advanced/GradeScaleSection";

// -----------------------------------------------------------------------------
// Form state shapes — one per "section" so we can dirty-track independently.
// -----------------------------------------------------------------------------

interface MasterForm {
  class_test_best_of: number | "";
  practical_best_of: number | "";
  grace_marks_per_subject_max: number | "";
  grace_marks_total_max: number | "";
  grace_marks_condition: ResultMasterGraceCondition;
  rounding_mode: ResultMasterRoundingMode;
  rounding_precision: number;
  round_raw_marks: boolean;
  include_non_scholastic: boolean;
  non_scholastic_placement: ResultMasterNonScholasticPlacement;
  grade_scale_id: string | null;
  // Phase 9 — display toggles
  show_rank: boolean;
  show_extra_separately: boolean;
  show_division: boolean;
}

function masterFormFromMaster(m: ResultMaster): MasterForm {
  const numOrBlank = (v: unknown): number | "" => {
    if (v === null || v === undefined || v === "") return "";
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : "";
  };
  const numOrZero = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    class_test_best_of:
      m.class_test_best_of === null || m.class_test_best_of === undefined
        ? ""
        : numOrBlank(m.class_test_best_of),
    practical_best_of:
      m.practical_best_of === null || m.practical_best_of === undefined
        ? ""
        : numOrBlank(m.practical_best_of),
    grace_marks_per_subject_max: numOrZero(m.grace_marks_per_subject_max),
    grace_marks_total_max: numOrZero(m.grace_marks_total_max),
    grace_marks_condition: m.grace_marks_condition,
    rounding_mode: m.rounding_mode,
    rounding_precision: numOrZero(m.rounding_precision),
    round_raw_marks: m.round_raw_marks,
    include_non_scholastic: m.include_non_scholastic,
    non_scholastic_placement: m.non_scholastic_placement,
    grade_scale_id: m.grade_scale_id,
    show_rank: m.show_rank ?? false,
    show_extra_separately: m.show_extra_separately ?? true,
    show_division: m.show_division ?? true,
  };
}

// Supabase returns `numeric` columns as strings by default. Coerce to number so
// the <Input type="number"> bindings and weightage-sum math work correctly.
function toNumberOrBlank(v: unknown): number | "" {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : "";
}

function weightageRowsFromConfigs(
  configs: readonly ExamConfigWithType[]
): WeightageRow[] {
  return configs.map((c) => ({
    exam_type_id: c.exam_type_id,
    exam_name: c.exam_types?.name ?? "(unknown)",
    kind: c.exam_types?.kind ?? "term_exam",
    is_applicable: c.is_applicable,
    weightage: toNumberOrBlank(c.weightage),
    max_marks_override: toNumberOrBlank(c.max_marks_override),
    sort_order: Number(c.sort_order) || 0,
  }));
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function AdvancedTab({
  master,
  exam_configs,
  grade_scales,
  onSaved,
}: {
  master: ResultMaster;
  exam_configs: ExamConfigWithType[];
  grade_scales: GradeScale[];
  onSaved: () => Promise<void> | void;
}) {
  // --- Weightage state (exam_types loaded separately for union merge). ---
  const [loadingExamTypes, setLoadingExamTypes] = useState(true);
  const [mergedRows, setMergedRows] = useState<WeightageRow[]>(() =>
    weightageRowsFromConfigs(exam_configs)
  );
  const [weightageBaseline, setWeightageBaseline] = useState<WeightageRow[]>(
    () => weightageRowsFromConfigs(exam_configs)
  );
  const [examConfigsError, setExamConfigsError] = useState<string | null>(null);

  // --- Master-side form state + baseline. ---
  const [form, setForm] = useState<MasterForm>(() =>
    masterFormFromMaster(master)
  );
  const [baseline, setBaseline] = useState<MasterForm>(() =>
    masterFormFromMaster(master)
  );

  const [saving, setSaving] = useState(false);

  // Reseed master form when identity changes.
  useEffect(() => {
    const next = masterFormFromMaster(master);
    setForm(next);
    setBaseline(next);
  }, [master]);

  // Load exam types (for union merge) whenever academic_year changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingExamTypes(true);
      try {
        const { createClient } = await import("@nkps/shared/lib/supabase/client");
        const supabase = createClient();
        const { data, error } = await supabase
          .from("exam_types")
          .select(
            "id, name, kind, max_marks, sort_order, academic_year_id"
          )
          .eq("academic_year_id", master.academic_year_id)
          .order("sort_order", { ascending: true });
        if (cancelled) return;
        if (error) {
          toast.error(`Failed to load exam types: ${error.message}`);
          const rows = weightageRowsFromConfigs(exam_configs);
          setMergedRows(rows);
          setWeightageBaseline(rows);
        } else {
          const merged = mergeExamConfigsWithExamTypes(
            exam_configs,
            data ?? []
          );
          const rows = weightageRowsFromConfigs(merged);
          setMergedRows(rows);
          setWeightageBaseline(rows);
        }
      } finally {
        if (!cancelled) setLoadingExamTypes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [master.academic_year_id, exam_configs]);

  // ---------------------------------------------------------------------------
  // Dirty detection (per section).
  // ---------------------------------------------------------------------------

  const weightageDirty = useMemo(() => {
    if (mergedRows.length !== weightageBaseline.length) return true;
    const baselineById = new Map(
      weightageBaseline.map((r) => [r.exam_type_id, r])
    );
    for (const r of mergedRows) {
      const b = baselineById.get(r.exam_type_id);
      if (!b) return true;
      if (
        r.is_applicable !== b.is_applicable ||
        r.weightage !== b.weightage ||
        r.max_marks_override !== b.max_marks_override ||
        r.sort_order !== b.sort_order
      ) {
        return true;
      }
    }
    return false;
  }, [mergedRows, weightageBaseline]);

  const masterDirty = !shallowEqualRecord(
    form as unknown as Record<string, unknown>,
    baseline as unknown as Record<string, unknown>
  );

  const anyDirty = weightageDirty || masterDirty;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const updateRow = (
    exam_type_id: string,
    patch: Partial<WeightageRow>
  ) => {
    setMergedRows((prev) =>
      prev.map((r) =>
        r.exam_type_id === exam_type_id ? { ...r, ...patch } : r
      )
    );
  };

  const patchForm = (patch: Partial<MasterForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const weightageSum = useMemo(
    () =>
      mergedRows.reduce((acc, r) => {
        if (!r.is_applicable) return acc;
        const v = typeof r.weightage === "number" ? r.weightage : 0;
        return acc + v;
      }, 0),
    [mergedRows]
  );
  const weightageSumRounded =
    Math.round((weightageSum + Number.EPSILON) * 100) / 100;
  const weightageSum100 = Math.abs(weightageSumRounded - 100) < 0.01;

  const classTestCount = mergedRows.filter(
    (r) => r.kind === "class_test" && r.is_applicable
  ).length;
  const practicalCount = mergedRows.filter(
    (r) => r.kind === "practical" && r.is_applicable
  ).length;

  // ---------------------------------------------------------------------------
  // Save actions
  // ---------------------------------------------------------------------------

  const validateWeightages = (): string | null => {
    for (const r of mergedRows) {
      if (!r.is_applicable) continue;
      if (r.weightage !== "") {
        const v = Number(r.weightage);
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          return `Weightage for "${r.exam_name}" must be between 0 and 100.`;
        }
      }
      if (r.max_marks_override !== "") {
        const v = Number(r.max_marks_override);
        if (!Number.isFinite(v) || v <= 0) {
          return `Max marks override for "${r.exam_name}" must be greater than 0.`;
        }
      }
    }
    return null;
  };

  const validateMaster = (): string | null => {
    const nums: [string, number | ""][] = [
      ["Grace per-subject max", form.grace_marks_per_subject_max],
      ["Grace total max", form.grace_marks_total_max],
    ];
    for (const [label, v] of nums) {
      if (v === "") return `${label} is required.`;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return `${label} must be between 0 and 100.`;
      }
    }
    const bestOfs: [string, number | ""][] = [
      ["class_test_best_of", form.class_test_best_of],
      ["practical_best_of", form.practical_best_of],
    ];
    for (const [label, v] of bestOfs) {
      if (v === "") continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        return `${label} must be a positive integer (or blank to use all).`;
      }
    }
    return null;
  };

  const saveWeightages = async (): Promise<boolean> => {
    setExamConfigsError(null);
    const err = validateWeightages();
    if (err) {
      toast.error(err);
      return false;
    }
    const payload = {
      exam_configs: mergedRows.map((r) => ({
        exam_type_id: r.exam_type_id,
        is_applicable: r.is_applicable,
        weightage: r.weightage === "" ? null : Number(r.weightage),
        max_marks_override:
          r.max_marks_override === "" ? null : Number(r.max_marks_override),
        sort_order: Number(r.sort_order) || 0,
      })),
    };
    const res = await adminFetch(
      `/api/result-masters/${master.id}/exam-configs`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const body = (await res.json()) as {
      error?: string;
      code?: string;
      data?: unknown;
    };
    if (!res.ok) {
      if (body.code === "EXAM_CONFIGS_INSERT_FAILED") {
        setExamConfigsError(
          body.error ??
            "Exam configs insert failed — the class currently has no configs."
        );
        toast.error(
          "Weightage save failed after delete — click Retry to re-attempt."
        );
      } else {
        toast.error(body.error ?? "Failed to save weightages");
      }
      return false;
    }
    toast.success("Weightages saved");
    setWeightageBaseline(mergedRows);
    return true;
  };

  const saveMaster = async (): Promise<boolean> => {
    const err = validateMaster();
    if (err) {
      toast.error(err);
      return false;
    }
    const patch: Record<string, unknown> = {};
    const compareFields: Array<keyof MasterForm> = [
      "class_test_best_of",
      "practical_best_of",
      "grace_marks_per_subject_max",
      "grace_marks_total_max",
      "grace_marks_condition",
      "rounding_mode",
      "rounding_precision",
      "round_raw_marks",
      "include_non_scholastic",
      "non_scholastic_placement",
      "grade_scale_id",
      "show_rank",
      "show_extra_separately",
      "show_division",
    ];
    for (const key of compareFields) {
      const cur = form[key];
      const base = baseline[key];
      if (cur === base) continue;
      if (
        (key === "class_test_best_of" || key === "practical_best_of") &&
        cur === ""
      ) {
        patch[key] = null;
        continue;
      }
      if (
        key === "grace_marks_per_subject_max" ||
        key === "grace_marks_total_max"
      ) {
        patch[key] = Number(cur);
        continue;
      }
      if (key === "class_test_best_of" || key === "practical_best_of") {
        patch[key] = Number(cur);
        continue;
      }
      patch[key] = cur;
    }

    if (Object.keys(patch).length === 0) return true;

    const res = await adminPatch(
      `/api/result-masters/${master.id}`,
      patch
    );
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      toast.error(body.error ?? "Failed to save advanced settings");
      return false;
    }
    toast.success("Advanced settings saved");
    setBaseline(form);
    return true;
  };

  const handleSaveAll = async () => {
    if (!anyDirty) return;
    setSaving(true);
    try {
      let ok = true;
      if (weightageDirty) {
        const wOk = await saveWeightages();
        ok = ok && wOk;
      }
      if (masterDirty) {
        const mOk = await saveMaster();
        ok = ok && mOk;
      }
      if (ok) {
        await onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  const retryWeightages = async () => {
    setSaving(true);
    try {
      const ok = await saveWeightages();
      if (ok) await onSaved();
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <WeightageSection
        rows={mergedRows}
        sumRounded={weightageSumRounded}
        sum100={weightageSum100}
        loading={loadingExamTypes}
        error={examConfigsError}
        onRetry={retryWeightages}
        saving={saving}
        onUpdateRow={updateRow}
      />

      <BestOfSection
        classTestBestOf={form.class_test_best_of}
        practicalBestOf={form.practical_best_of}
        classTestCount={classTestCount}
        practicalCount={practicalCount}
        onChange={(field, v) => patchForm({ [field]: v } as Partial<MasterForm>)}
      />

      <GraceSection
        perSubjectMax={form.grace_marks_per_subject_max}
        totalMax={form.grace_marks_total_max}
        condition={form.grace_marks_condition}
        onChange={patchForm}
      />

      <RoundingSection
        mode={form.rounding_mode}
        precision={form.rounding_precision}
        roundRawMarks={form.round_raw_marks}
        onChange={patchForm}
      />

      <NonScholasticSection
        include={form.include_non_scholastic}
        placement={form.non_scholastic_placement}
        onChange={patchForm}
      />

      <DisplaySection
        showRank={form.show_rank}
        showExtraSeparately={form.show_extra_separately}
        showDivision={form.show_division}
        onChange={patchForm}
      />

      <GradeScaleSection
        gradeScaleId={form.grade_scale_id}
        gradeScales={grade_scales}
        onChange={(id) => patchForm({ grade_scale_id: id })}
      />

      {/* --- Global Save -------------------------------------------------- */}
      <div className="flex items-center justify-end gap-3 pt-2 pb-6">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {anyDirty
            ? `Unsaved changes: ${weightageDirty ? "weightages" : ""}${
                weightageDirty && masterDirty ? " + " : ""
              }${masterDirty ? "rules" : ""}`
            : "All changes saved"}
        </p>
        <Button
          onClick={handleSaveAll}
          disabled={saving || !anyDirty}
          className="bg-navy-900 text-white hover:bg-navy-900/90"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Save Advanced Settings
        </Button>
      </div>
    </div>
  );
}
