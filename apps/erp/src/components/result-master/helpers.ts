// Shared helpers for the Result Master admin tabs. Step 6 (Advanced) and
// Step 7 (Preview) should import from here instead of redefining.

import type {
  ExamKind,
  ResultMasterPassCriteriaType,
  ResultMasterRoundingMode,
} from "@nkps/shared/types";

// Human-readable labels for each supported pass-criteria type.
// Kept local (not imported from `describePassCriteria`) because that helper
// expects the config too and we just want a dropdown label.
export const CRITERIA_TYPE_LABEL: Record<ResultMasterPassCriteriaType, string> =
  {
    all_main_subjects: "Must pass every main subject",
    overall_percentage: "Main aggregate ≥ overall %",
    main_and_overall: "Every main subject passes AND aggregate ≥ overall %",
    pass_n_subjects: "Pass at least N main subjects",
    allow_one_fail: "Allow one fail if aggregate ≥ overall %",
  };

export function labelForCriteriaType(type: string): string {
  return CRITERIA_TYPE_LABEL[type as ResultMasterPassCriteriaType] ?? type;
}

// Sensible default config per criteria type. The API rejects non-{} configs
// for `all_main_subjects`, so the blank object here is load-bearing.
export function defaultConfigFor(
  type: ResultMasterPassCriteriaType | string
): Record<string, unknown> {
  switch (type) {
    case "all_main_subjects":
      return {};
    case "overall_percentage":
    case "main_and_overall":
    case "allow_one_fail":
      return { overall_pct: 33 };
    case "pass_n_subjects":
      return { n: 1 };
    default:
      return {};
  }
}

// Shallow-equality for a config object. Sufficient for dirty tracking because
// criteria configs are flat scalar maps.
export function shallowEqualRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

// Client-side mirror of `roundNumber` in src/lib/final-result.ts. Used for the
// Advanced tab's live preview panel so admins see the effect before saving.
// Intentionally matches the server implementation byte-for-byte.
export function previewRound(
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

// Shape of a `class_exam_configs` row with the embedded `exam_types` join as
// returned by GET /api/erp/result-masters. Referenced by the Advanced tab.
export interface ExamConfigWithType {
  id: string | null;
  class_id: string | null;
  exam_type_id: string;
  is_applicable: boolean;
  weightage: number | null;
  max_marks_override: number | null;
  sort_order: number;
  exam_types: {
    id: string;
    name: string;
    kind: ExamKind;
    max_marks: number;
    sort_order: number;
    academic_year_id: string;
  } | null;
}

export interface ExamTypeRow {
  id: string;
  name: string;
  kind: ExamKind;
  max_marks: number;
  sort_order: number;
  academic_year_id: string;
}

// Union-merge existing `class_exam_configs` rows with every exam_type for the
// academic year. Exam types without a row show up with default values
// (is_applicable=true, weightage=null, max_marks_override=null) so the admin
// can configure newly-added exam types without needing to touch the
// exam_types page first. A saved PUT will upsert whatever the admin leaves.
export function mergeExamConfigsWithExamTypes(
  existingConfigs: readonly ExamConfigWithType[],
  allExamTypes: readonly ExamTypeRow[]
): ExamConfigWithType[] {
  const byId = new Map<string, ExamConfigWithType>();
  for (const c of existingConfigs) byId.set(c.exam_type_id, c);

  const merged: ExamConfigWithType[] = allExamTypes.map((et) => {
    const existing = byId.get(et.id);
    if (existing) {
      // Ensure the embedded exam_types payload is present even if the GET
      // route dropped it (defense in depth).
      return {
        ...existing,
        exam_types: existing.exam_types ?? {
          id: et.id,
          name: et.name,
          kind: et.kind,
          max_marks: et.max_marks,
          sort_order: et.sort_order,
          academic_year_id: et.academic_year_id,
        },
      };
    }
    return {
      id: null,
      class_id: null,
      exam_type_id: et.id,
      is_applicable: true,
      weightage: null,
      max_marks_override: null,
      sort_order: et.sort_order,
      exam_types: {
        id: et.id,
        name: et.name,
        kind: et.kind,
        max_marks: et.max_marks,
        sort_order: et.sort_order,
        academic_year_id: et.academic_year_id,
      },
    };
  });

  merged.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    const an = a.exam_types?.name ?? "";
    const bn = b.exam_types?.name ?? "";
    return an.localeCompare(bn);
  });

  return merged;
}

export const EXAM_KIND_LABEL: Record<ExamKind, string> = {
  term_exam: "Term",
  class_test: "Class test",
  practical: "Practical",
};
