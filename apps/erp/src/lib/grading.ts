// Single source of truth for grade resolution and computation.
//
// Replaces the 4 previously-duplicated hardcoded grade functions in:
//   - src/app/api/erp/results/bulk/route.ts
//   - src/app/teacher/results/page.tsx
//   - src/app/erp/exams/results/page.tsx
//   - src/lib/report-card.ts
//
// Admins can define named grade scales (rows in `grade_scales`) with cutoff
// bands (`grade_bands`). Each scope ('scholastic' | 'non_scholastic') has
// exactly one default scale. A class can override that default by inserting
// a row into `class_grade_scales`.

import type { SupabaseClient } from "@supabase/supabase-js";

export type GradeScope = "scholastic" | "non_scholastic";

export interface GradeBand {
  label: string;
  min_pct: number;
  max_pct: number;
  remark: string | null;
  sort_order: number;
}

export interface GradeScale {
  id: string;
  name: string;
  scope: GradeScope;
  is_default: boolean;
  bands: GradeBand[];
}

/**
 * Pick the grade label that owns a given percentage.
 *
 * Lookup rule: take the band with the largest `min_pct` that is still ≤ `pct`.
 * In effect each band claims `[min_pct, next_band.min_pct)` regardless of what
 * the admin keyed in `max_pct`. This avoids two real-world failure modes:
 *
 *  1. Inclusive-inclusive overlap ambiguity. The seeded defaults use ranges
 *     like A 80–89.99 / A+ 90–100. With `<= max_pct` matching, a value of
 *     exactly 89.99 is in *both* bands; the iteration order then decides the
 *     letter (a rounding precision change can flip A → A+ silently).
 *  2. Tiny gaps from the `.99` trick. A value like 89.995 falls between
 *     89.99 and 90.0, so a strict-interval lookup would return null.
 *
 * Tiebreak on equal `min_pct` is `sort_order` ascending. Returns null only
 * when `pct` sits below the lowest band's `min_pct` (e.g. an admin scale
 * that doesn't go down to 0).
 */
export function computeGrade(
  pct: number,
  bands: readonly GradeBand[]
): string | null {
  if (bands.length === 0) return null;
  const clamped = Math.min(100, Math.max(0, pct));
  const sorted = [...bands].sort((a, b) => {
    if (b.min_pct !== a.min_pct) return b.min_pct - a.min_pct;
    return a.sort_order - b.sort_order;
  });
  for (const band of sorted) {
    if (clamped >= band.min_pct) return band.label;
  }
  return null;
}

/**
 * Fetch the default scale for a scope. Used when a class has no override
 * or when caller doesn't care about class-level customization.
 */
export async function getDefaultGradeScale(
  supabase: SupabaseClient,
  scope: GradeScope
): Promise<GradeScale | null> {
  const { data: scale, error } = await supabase
    .from("grade_scales")
    .select("id, name, scope, is_default")
    .eq("scope", scope)
    .eq("is_default", true)
    .maybeSingle();

  if (error || !scale) return null;

  const { data: bands, error: bandErr } = await supabase
    .from("grade_bands")
    .select("label, min_pct, max_pct, remark, sort_order")
    .eq("grade_scale_id", scale.id)
    .order("sort_order", { ascending: true });

  if (bandErr) return null;

  return {
    id: scale.id as string,
    name: scale.name as string,
    scope: scale.scope as GradeScope,
    is_default: scale.is_default as boolean,
    bands: (bands ?? []) as GradeBand[],
  };
}

/**
 * Resolve the grade scale for a specific class:
 *   1. If `class_grade_scales` has a row for the class → use that scale.
 *   2. Otherwise → fall back to the scope's default scale.
 *   3. If neither exists → return null (callers should treat as "no scale
 *      configured" and suppress grade display rather than inventing letters).
 */
export async function resolveGradeScaleForClass(
  supabase: SupabaseClient,
  classId: string,
  scope: GradeScope = "scholastic"
): Promise<GradeScale | null> {
  const { data: override } = await supabase
    .from("class_grade_scales")
    .select("grade_scale_id")
    .eq("class_id", classId)
    .maybeSingle();

  const targetId = override?.grade_scale_id as string | undefined;

  if (targetId) {
    const { data: scale } = await supabase
      .from("grade_scales")
      .select("id, name, scope, is_default")
      .eq("id", targetId)
      .maybeSingle();

    if (scale && scale.scope === scope) {
      const { data: bands } = await supabase
        .from("grade_bands")
        .select("label, min_pct, max_pct, remark, sort_order")
        .eq("grade_scale_id", scale.id)
        .order("sort_order", { ascending: true });

      return {
        id: scale.id as string,
        name: scale.name as string,
        scope: scale.scope as GradeScope,
        is_default: scale.is_default as boolean,
        bands: (bands ?? []) as GradeBand[],
      };
    }
  }

  return getDefaultGradeScale(supabase, scope);
}

/**
 * Resolve scales for multiple classes at once. Returns a Map keyed by
 * class_id. Classes without an explicit override share the default scale
 * object (same reference — safe because GradeScale is treated as immutable).
 *
 * Useful for report-card generation where we process many students spanning
 * multiple classes and want to avoid N+1 queries.
 */
export async function resolveGradeScalesForClasses(
  supabase: SupabaseClient,
  classIds: readonly string[],
  scope: GradeScope = "scholastic"
): Promise<Map<string, GradeScale | null>> {
  const result = new Map<string, GradeScale | null>();
  if (classIds.length === 0) return result;

  const defaultScale = await getDefaultGradeScale(supabase, scope);
  const { data: overrides } = await supabase
    .from("class_grade_scales")
    .select("class_id, grade_scale_id")
    .in("class_id", [...classIds]);

  const overrideByClass = new Map<string, string>();
  for (const row of overrides ?? []) {
    overrideByClass.set(row.class_id as string, row.grade_scale_id as string);
  }

  const overrideScaleIds = [...new Set(overrideByClass.values())];
  const scaleCache = new Map<string, GradeScale>();

  if (overrideScaleIds.length > 0) {
    const { data: scales } = await supabase
      .from("grade_scales")
      .select("id, name, scope, is_default")
      .in("id", overrideScaleIds)
      .eq("scope", scope);

    const { data: bands } = await supabase
      .from("grade_bands")
      .select("grade_scale_id, label, min_pct, max_pct, remark, sort_order")
      .in("grade_scale_id", overrideScaleIds)
      .order("sort_order", { ascending: true });

    const bandsByScale = new Map<string, GradeBand[]>();
    for (const b of bands ?? []) {
      const key = b.grade_scale_id as string;
      const arr = bandsByScale.get(key) ?? [];
      arr.push({
        label: b.label as string,
        min_pct: Number(b.min_pct),
        max_pct: Number(b.max_pct),
        remark: (b.remark as string | null) ?? null,
        sort_order: b.sort_order as number,
      });
      bandsByScale.set(key, arr);
    }

    for (const s of scales ?? []) {
      scaleCache.set(s.id as string, {
        id: s.id as string,
        name: s.name as string,
        scope: s.scope as GradeScope,
        is_default: s.is_default as boolean,
        bands: bandsByScale.get(s.id as string) ?? [],
      });
    }
  }

  for (const classId of classIds) {
    const overrideId = overrideByClass.get(classId);
    if (overrideId && scaleCache.has(overrideId)) {
      result.set(classId, scaleCache.get(overrideId)!);
    } else {
      result.set(classId, defaultScale);
    }
  }

  return result;
}
