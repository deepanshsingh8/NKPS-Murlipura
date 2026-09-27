import type { SupabaseClient, User } from "@supabase/supabase-js";
import { runStudentReport, toMatrix } from "@/lib/report-query";
import { resolveFields } from "@nkps/shared/lib/report-fields";
import type { ReportFilters } from "@nkps/shared/lib/report-filters";
import { scopeHash, type RowScope } from "./caller-context";

/**
 * Re-executes a stored query run under a FRESH authorization check.
 *
 * Shared by the on-screen table and the CSV, because both must make the same
 * three guarantees and neither should re-derive them independently:
 *
 *  1. The run has not expired. Checked lazily here — there is no cron anywhere
 *     in this repo, so nothing may depend on a sweeper having deleted it.
 *  2. The caller's scope still hashes to what it hashed when they asked. A
 *     teacher who lost a class between preview and download gets a 403, not
 *     stale rows.
 *  3. The stored filters are used verbatim. They were already scoped when
 *     written, so re-running cannot widen anything even if the model's
 *     original request tried to.
 *  4. The run belongs to the caller's own conversation.
 *
 * (4) was missing until chat history made it matter. The scope check in (2)
 * looks like it covers ownership, and does not: every holder of the `reports`
 * grant resolves to `{kind:"all"}`, so the hashes always match and any of them
 * could pass any run id. Both could have built the same report by hand, so the
 * exposure was small — but a persistent history turns run ids into durable,
 * quotable handles, and a handle that works for anyone is a handle that leaks.
 *
 * The trade-off is honest: the query runs a second time and the data may have
 * moved, so callers state the fresh total rather than the one from the
 * preview. In exchange there is no cached blob of student rows sitting
 * anywhere, and authorization is re-checked at the moment of download.
 */

export type RerunFailure =
  | { code: "not_found"; status: 404; message: string }
  | { code: "expired"; status: 410; message: string }
  | { code: "scope_changed"; status: 403; message: string };

export interface RerunOptions {
  /**
   * Whose runs these are. A run attached to someone else's conversation is
   * reported as not_found, never as forbidden — the id must not become a way
   * to discover that a colleague asked something.
   */
  ownerId?: string;
  /**
   * Skip the expiry check only. Used by the explicit re-run path, which then
   * writes a NEW run row rather than reviving this one, so the expired handle
   * stays expired and a fresh authorization moment is recorded.
   */
  ignoreExpiry?: boolean;
}

export interface RerunSuccess {
  headers: string[];
  body: (string | number | null)[][];
  total: number;
  fieldKeys: string[];
  sensitive: boolean;
  academicYearId: string | null;
  filters: ReportFilters;
  /** Carried so the re-run path can clone this row's attribution. */
  conversationId: string | null;
  messageSeq: number | null;
  purpose: string | null;
}

export async function rerunQueryRun(
  admin: SupabaseClient,
  runId: string,
  scope: RowScope,
  isAdmin: boolean,
  opts: RerunOptions = {}
): Promise<{ ok: true; data: RerunSuccess } | { ok: false; error: RerunFailure }> {
  const { data: run } = await admin
    .from("ai_query_runs")
    .select(
      "id, filters, field_keys, scope_hash, expires_at, academic_year_id, conversation_id, message_seq, purpose"
    )
    .eq("id", runId)
    .maybeSingle();

  const notFound = {
    ok: false as const,
    error: {
      code: "not_found" as const,
      status: 404 as const,
      message: "That result is no longer available.",
    },
  };

  if (!run) return notFound;

  // A run with no conversation predates chat history and has no owner to
  // check; the scope check still applies to it.
  if (opts.ownerId && run.conversation_id) {
    const { data: owner } = await admin
      .from("ai_conversations")
      .select("actor_id")
      .eq("id", run.conversation_id as string)
      .maybeSingle();
    if (owner && owner.actor_id !== opts.ownerId) return notFound;
  }

  if (!opts.ignoreExpiry && new Date(run.expires_at as string).getTime() < Date.now()) {
    return {
      ok: false,
      error: {
        code: "expired",
        status: 410,
        message: "That result has expired. Ask the question again to get a fresh one.",
      },
    };
  }

  if ((run.scope_hash as string) !== scopeHash(scope)) {
    return {
      ok: false,
      error: {
        code: "scope_changed",
        status: 403,
        message:
          "Your access changed since this result was produced. Ask the question again.",
      },
    };
  }

  const filters = run.filters as ReportFilters;
  const storedKeys = (run.field_keys as string[]) ?? [];
  const conversationId = (run.conversation_id as string | null) ?? null;
  const messageSeq = (run.message_seq as number | null) ?? null;
  const purpose = (run.purpose as string | null) ?? null;

  // Re-resolve rather than trusting the stored list to still be valid: a field
  // retired since the run was created should drop out, not throw.
  const fields = resolveFields(storedKeys);

  const result = await runStudentReport(admin, filters, fields);
  const { headers, body } = toMatrix(result.rows, fields);

  return {
    ok: true,
    data: {
      headers,
      body,
      total: result.total,
      fieldKeys: fields.map((f) => f.key),
      // The stored run already passed the sensitivity gate at creation time;
      // this only records whether the sheet carries sensitive columns.
      sensitive: !isAdmin ? false : fields.some((f) => f.sensitive === true),
      academicYearId: (run.academic_year_id as string | null) ?? result.session?.id ?? null,
      filters,
      conversationId,
      messageSeq,
      purpose,
    },
  };
}

/**
 * Records an AI-produced download in the same trail as a manual one.
 *
 * Written inline rather than through export-handler's logExport(), matching
 * what the report builder's own export route already does — logExport is
 * module-private, takes a Request it derives IP and user-agent from, and
 * constrains `dataset` to a union that this path does not add to. `dataset`
 * stays 'students' on purpose: the corpus is the same, only the route differs,
 * which is exactly why `source` exists as a separate column.
 */
export async function logAiExport(args: {
  admin: SupabaseClient;
  user: User;
  role: string;
  runId: string;
  format: "csv";
  academicYearId: string | null;
  rowCount: number;
  fieldKeys: string[];
  sensitive: boolean;
  filters: unknown;
  request: Request;
}): Promise<void> {
  const forwarded = args.request.headers.get("x-forwarded-for");
  const { error } = await args.admin.from("export_events").insert({
    actor_id: args.user.id,
    actor_role: args.role,
    dataset: "students",
    feature_key: "reports",
    format: args.format,
    academic_year_id: args.academicYearId,
    row_count: args.rowCount,
    column_count: args.fieldKeys.length,
    fields: args.fieldKeys,
    sensitive: args.sensitive,
    filter_summary: "Produced by the assistant",
    filter_spec: args.filters,
    source_app: "erp",
    source_path: "/reports/ask",
    source: "ai",
    ai_run_id: args.runId,
    client_ip: forwarded?.split(",")[0]?.trim() ?? null,
    user_agent: args.request.headers.get("user-agent"),
  });
  if (error) console.error("[ai.export] audit insert failed:", error.message);

  await args.admin
    .from("ai_query_runs")
    .update({ exported_at: new Date().toISOString() })
    .eq("id", args.runId);
}
