import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  reportFiltersSchema,
  type ReportFilters,
} from "@nkps/shared/lib/report-filters";

/**
 * Who is asking, and which rows they are allowed to see.
 *
 * ── Why scope is not RLS ────────────────────────────────────────────────────
 * The obvious design is to hand the caller's own RLS-bound Supabase client to
 * runStudentReport and let the database scope the query. It is wrong here, and
 * the reasons are worth keeping written down because the design keeps looking
 * tempting:
 *
 *  1. RLS failures are SILENT. bus_stops and bus_stop_fees have RLS enabled
 *     with zero policies, so a non-service-role read returns an empty array
 *     rather than an error, and the fee join quietly understates every
 *     transport family's balance. This is not hypothetical — it shipped.
 *  2. report-query.ts was written and tested against a service client. Under
 *     RLS every .in() batch silently shrinks, so `total` becomes "rows I could
 *     see" while still reading as "rows matching your filter".
 *  3. Its reads page a whole cohort's rows into memory. Per-row policy
 *     functions over that many rows turn an admin query into minutes.
 *  4. The SQL scope helpers do not work under service role anyway:
 *     get_my_parent_id(), get_my_children_ids() and get_my_class_ids() all
 *     resolve through auth.uid(), which is NULL there — so they return empty
 *     sets, not errors. Same silent-empty failure class as (1).
 *
 * A concurrent audit found the same bug class in production: computeRanksForClass
 * was called with an RLS-bound client, the ranking cohort collapsed to the one
 * student the caller could see, and every parent's report card said "Rank 1".
 *
 * So: service-role client, scope derived in explicit TypeScript, injected by
 * the server, and unreachable from anything the model can write.
 */

export type CallerRole = "admin" | "editor" | "teacher" | "parent" | "student";

/**
 * The rows this caller may see. Never derived from model output, never from a
 * request body — only from a verified session.
 */
export type RowScope =
  | { kind: "all" }
  | {
      kind: "classes";
      classIds: readonly string[];
      /**
       * Which rule produced the list. Two different teacher scopes exist and
       * conflating them is a privilege bug: get_my_class_ids() is
       * class_teacher_id UNION class_subjects.teacher_id, but the remarks
       * route requires class_teacher_id alone. Remark drafting must pass
       * "class_teacher".
       */
      source: "class_teacher" | "teaches";
    }
  | { kind: "students"; studentIds: readonly string[] };

export interface CallerContext {
  readonly channel: "erp_web" | "portal_web" | "whatsapp";
  readonly role: CallerRole;
  /** Null on the whatsapp channel, which has no Supabase session. */
  readonly userId: string | null;
  readonly parentId: string | null;
  readonly teacherId: string | null;
  readonly scope: RowScope;
  /**
   * A deliberate human act in the UI, never a model decision and never a
   * request-body default. Gates the sensitive-field set.
   */
  readonly allowSensitive: boolean;
  /** Server-resolved current session; the model may override with a real id. */
  readonly sessionId: string;
  /** Service role. Row scoping is this module's job, not the database's. */
  readonly admin: SupabaseClient;
  /**
   * Null when the audit row could not be opened.
   *
   * Explicitly nullable rather than an empty-string sentinel: the audit
   * helpers skip on a falsy id, so `""` silently disabled tool-call logging
   * while query runs were still being written — a half-populated trail that
   * reads as complete. A null says "audit unavailable" out loud.
   */
  readonly conversationId: string | null;
}

/**
 * A ReportFilters that has been through applyScope().
 *
 * The brand is the point: only applyScope can mint one, and the AI call site
 * is typed to require it. Someone who deletes the scoping step gets a compile
 * error rather than a data leak.
 */
declare const scopedBrand: unique symbol;
export type ScopedFilters = ReportFilters & { readonly [scopedBrand]: true };

export interface ScopeError {
  code: "scope_violation" | "invalid_filters" | "empty_scope";
  message: string;
  /** Rendered into a tool_result the model can act on. */
  detail?: unknown;
}

export type ApplyScopeResult =
  | { ok: true; filters: ScopedFilters; scopeNote: string }
  | { ok: false; error: ScopeError };

/**
 * Parse what the model produced, inject what the server owns, and narrow to
 * the caller's scope.
 *
 * Three things happen here that must not move elsewhere:
 *  - session_id is injected. It is a required uuid in the real schema and the
 *    model cannot know it, so leaving it to the model guarantees a wasted
 *    first turn.
 *  - class_ids INTERSECTS with scope. Never unions. An empty intersection is
 *    an error naming what the caller *can* query, never a fallback to "all".
 *  - a student-scoped caller (parent/student) is rejected outright. They do
 *    not get this tool; they get the narrow per-child tools, because adding a
 *    student_ids key to the model-writable filter object would put a
 *    scope-shaped field within the model's reach.
 */
export function applyScope(
  ctx: CallerContext,
  modelFilters: unknown
): ApplyScopeResult {
  if (ctx.scope.kind === "students") {
    return {
      ok: false,
      error: {
        code: "scope_violation",
        message:
          "This caller cannot run student reports. Use the per-child tools instead.",
      },
    };
  }

  const raw =
    modelFilters && typeof modelFilters === "object"
      ? { ...(modelFilters as Record<string, unknown>) }
      : {};

  // The server owns the session. A model-supplied value is honoured only
  // because a legitimate "last year's list" needs it; it is still a real uuid
  // from list_academic_sessions, not a free-text guess.
  if (!raw.session_id || typeof raw.session_id !== "string") {
    raw.session_id = ctx.sessionId;
  }

  const parsed = reportFiltersSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "invalid_filters",
        message: "Those filters are not valid.",
        detail: parsed.error.flatten(),
      },
    };
  }

  const filters = parsed.data;
  let scopeNote = "All classes.";

  if (ctx.scope.kind === "classes") {
    const allowed = new Set(ctx.scope.classIds);
    if (allowed.size === 0) {
      return {
        ok: false,
        error: {
          code: "empty_scope",
          message:
            "You are not assigned to any class in this session, so there is nothing to report on.",
        },
      };
    }

    const requested = filters.class_ids ?? [];
    const effective =
      requested.length === 0
        ? [...allowed]
        : requested.filter((id) => allowed.has(id));

    if (effective.length === 0) {
      return {
        ok: false,
        error: {
          code: "scope_violation",
          message:
            "That class is outside what you can see. You can report on the classes you are assigned to.",
          detail: { allowed_class_ids: [...allowed] },
        },
      };
    }

    filters.class_ids = effective;
    scopeNote =
      requested.length === 0
        ? `Your ${effective.length} assigned class(es).`
        : `${effective.length} of the classes you asked for (the rest are outside your access).`;
  }

  return {
    ok: true,
    filters: filters as ScopedFilters,
    scopeNote,
  };
}

/**
 * Defence in depth. applyScope already narrowed the query, so this should
 * never drop anything; if it does, the query builder changed under us and the
 * caller should treat a non-zero drop count as an incident, not a filter.
 */
export function enforceScopeOnRows<T extends { enrollment?: Record<string, unknown> | null }>(
  ctx: CallerContext,
  rows: readonly T[]
): { rows: T[]; dropped: number } {
  if (ctx.scope.kind === "all") return { rows: [...rows], dropped: 0 };

  if (ctx.scope.kind === "classes") {
    const allowed = new Set(ctx.scope.classIds);
    const kept = rows.filter((r) => {
      const classId = r.enrollment?.class_id;
      return typeof classId === "string" && allowed.has(classId);
    });
    return { rows: kept, dropped: rows.length - kept.length };
  }

  const allowed = new Set(ctx.scope.studentIds);
  const kept = rows.filter((r) => {
    const studentId = r.enrollment?.student_id;
    return typeof studentId === "string" && allowed.has(studentId);
  });
  return { rows: kept, dropped: rows.length - kept.length };
}

/**
 * A stable fingerprint of the caller's scope.
 *
 * Stored with a query run and re-derived at download time: a teacher who lost
 * a class between asking and exporting gets a 403 rather than stale rows. Ids
 * are sorted so the same scope always hashes the same.
 */
export function scopeHash(scope: RowScope): string {
  const canonical =
    scope.kind === "all"
      ? "all"
      : scope.kind === "classes"
        ? `classes:${scope.source}:${[...scope.classIds].sort().join(",")}`
        : `students:${[...scope.studentIds].sort().join(",")}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * Classes a teacher may report on.
 *
 * `mode` is not a convenience — it is the privilege boundary. "class_teacher"
 * is the narrow rule the remarks route enforces; "teaches" additionally
 * includes subjects they teach, matching get_my_class_ids(). Passing the wrong
 * one silently widens what a teacher can read.
 */
export async function resolveTeacherClassIds(
  admin: SupabaseClient,
  teacherId: string,
  academicYearId: string,
  mode: "class_teacher" | "teaches"
): Promise<string[]> {
  const { data: owned } = await admin
    .from("classes")
    .select("id")
    .eq("academic_year_id", academicYearId)
    .eq("class_teacher_id", teacherId);

  const ids = new Set((owned ?? []).map((r) => r.id as string));
  if (mode === "class_teacher") return [...ids];

  const { data: classIdRows } = await admin
    .from("classes")
    .select("id")
    .eq("academic_year_id", academicYearId);
  const yearClassIds = (classIdRows ?? []).map((r) => r.id as string);
  if (yearClassIds.length === 0) return [...ids];

  const { data: taught } = await admin
    .from("class_subjects")
    .select("class_id")
    .eq("teacher_id", teacherId)
    .in("class_id", yearClassIds);

  for (const row of taught ?? []) ids.add(row.class_id as string);
  return [...ids];
}
