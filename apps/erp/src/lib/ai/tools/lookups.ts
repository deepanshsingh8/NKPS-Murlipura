import { z } from "zod";
import type { CallerContext } from "../caller-context";

/**
 * The lookups the model needs before it can filter anything.
 *
 * Two categories, both mandatory for different reasons:
 *
 *  - **UUIDs.** class_ids, stream_id, house_id and subject_id are uuids. A
 *    model cannot guess one, so without these tools its first filter attempt
 *    is always wrong.
 *
 *  - **Free-text values.** gender, category, religion, minority_group and
 *    area_type are untyped strings compared with equality. A plausible-but-
 *    wrong value ("General" where the data says "GEN") returns zero rows and
 *    reads exactly like a true negative. Returning the values actually present
 *    in the session turns a silent wrong answer into a correct one.
 *
 * Deliberately NOT a tool: the 135-field catalogue. It is static per role, so
 * it belongs in the cached system prefix — a list_report_fields tool would
 * spend a full round trip on nearly every conversation to fetch a constant.
 *
 * These use `strict: true` at the tool-definition level (unlike
 * run_student_report), because every field here is genuinely required.
 */

const LOOKUP_KINDS = [
  "stream",
  "house",
  "subject",
  "category",
  "religion",
  "gender",
  "area_type",
  "minority_group",
] as const;

export const listClassesInput = z.object({});
export const listExamTypesInput = z.object({});
export const listAcademicSessionsInput = z.object({});
export const listLookupValuesInput = z.object({
  kind: z.enum(LOOKUP_KINDS),
});

export type LookupKind = (typeof LOOKUP_KINDS)[number];

/**
 * Classes the caller may actually query, in the current session.
 *
 * Scope-filtered here as well as in applyScope, so a teacher is never shown
 * the id of a class they cannot report on — offering it would only produce a
 * scope_violation a turn later.
 */
export async function executeListClasses(
  ctx: CallerContext
): Promise<{ classes: { id: string; label: string }[] }> {
  let query = ctx.admin
    .from("classes")
    .select("id, name, section, sort_order")
    .eq("academic_year_id", ctx.sessionId)
    .order("sort_order", { ascending: true });

  if (ctx.scope.kind === "classes") {
    if (ctx.scope.classIds.length === 0) return { classes: [] };
    query = query.in("id", [...ctx.scope.classIds]);
  }

  const { data, error } = await query;
  if (error || !data) return { classes: [] };

  return {
    classes: data.map((row) => ({
      id: row.id as string,
      label: row.section
        ? `${row.name as string}-${row.section as string}`
        : (row.name as string),
    })),
  };
}

export async function executeListExamTypes(
  ctx: CallerContext
): Promise<{ exam_types: { id: string; label: string; kind: string }[] }> {
  const { data, error } = await ctx.admin
    .from("exam_types")
    .select("id, name, kind, sort_order")
    .eq("academic_year_id", ctx.sessionId)
    .order("sort_order", { ascending: true });

  if (error || !data) return { exam_types: [] };
  return {
    exam_types: data.map((row) => ({
      id: row.id as string,
      label: row.name as string,
      kind: (row.kind as string) ?? "term_exam",
    })),
  };
}

/**
 * Academic sessions, so "last year's list" is expressible.
 *
 * The current session is marked rather than assumed: the server injects it as
 * the default, and the model only needs an id here when the user explicitly
 * asked about a different year.
 */
export async function executeListAcademicSessions(
  ctx: CallerContext
): Promise<{ sessions: { id: string; label: string; is_current: boolean }[] }> {
  const { data, error } = await ctx.admin
    .from("academic_years")
    .select("id, name, is_current, start_date")
    .order("start_date", { ascending: false });

  if (error || !data) return { sessions: [] };
  return {
    sessions: data.map((row) => ({
      id: row.id as string,
      label: row.name as string,
      is_current: row.is_current === true,
    })),
  };
}

/**
 * Distinct values actually present, for the filters that compare strings.
 *
 * Reads the current session's enrolled students rather than the whole student
 * table, because a value that only appears on a passed-out student is not a
 * useful suggestion for a report about this year.
 */
export async function executeListLookupValues(
  ctx: CallerContext,
  kind: LookupKind
): Promise<{ kind: LookupKind; values: { value: string; label?: string }[] }> {
  if (kind === "stream" || kind === "house" || kind === "subject") {
    const table = kind === "stream" ? "streams" : kind === "house" ? "houses" : "subjects";
    let query = ctx.admin.from(table).select("id, name").order("name");
    // This is the vocabulary the model is handed for filter.stream_id. The
    // `streams` table also holds wings (migration 118) — class bands that no
    // student is ever enrolled in — so offering one would let the model build
    // a report filtered by "Middle Wing" that always returns nothing.
    // NB: `kind` here is the lookup kind, not streams.kind.
    if (kind === "stream") query = query.eq("kind", "stream");
    const { data } = await query;
    return {
      kind,
      values: (data ?? []).map((row) => ({
        value: row.id as string,
        label: row.name as string,
      })),
    };
  }

  // Free-text student columns. Distinct over the session's roster.
  // These are the exact column names report-query.ts filters on. They must
  // stay in step with it: a mismatch here produces a vocabulary the model
  // then cannot actually filter by.
  const column: string =
    kind === "category"
      ? "category"
      : kind === "religion"
        ? "religion"
        : kind === "gender"
          ? "gender"
          : kind === "minority_group"
            ? "minority_group"
            : "area_type";

  const studentIds = await sessionStudentIds(ctx);
  if (studentIds.length === 0) return { kind, values: [] };

  const { data } = await ctx.admin
    .from("students")
    .select(column)
    .in("id", studentIds);

  const seen = new Map<string, number>();
  // Cast through unknown: the select column is a variable, so PostgREST's
  // string-literal inference cannot type the row and lands on
  // GenericStringError. The typeof guard below does the real narrowing.
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const raw = row[column];
    if (typeof raw !== "string" || !raw.trim()) continue;
    seen.set(raw, (seen.get(raw) ?? 0) + 1);
  }

  return {
    kind,
    values: [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([value]) => ({ value })),
  };
}

/**
 * Student ids in scope for the current session.
 *
 * Capped: this only feeds a distinct-values list, and pulling 20k ids to
 * compute a 10-item vocabulary would be a slow way to answer a cheap question.
 */
async function sessionStudentIds(ctx: CallerContext): Promise<string[]> {
  let query = ctx.admin
    .from("student_enrollments")
    .select("student_id")
    .eq("academic_year_id", ctx.sessionId)
    .eq("status", "active")
    .limit(5000);

  if (ctx.scope.kind === "classes") {
    if (ctx.scope.classIds.length === 0) return [];
    query = query.in("class_id", [...ctx.scope.classIds]);
  } else if (ctx.scope.kind === "students") {
    if (ctx.scope.studentIds.length === 0) return [];
    query = query.in("student_id", [...ctx.scope.studentIds]);
  }

  const { data } = await query;
  return [...new Set((data ?? []).map((r) => r.student_id as string))];
}
