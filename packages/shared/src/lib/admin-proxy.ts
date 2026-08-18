import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

// Generic admin DB write proxy. Each app (apps/erp, apps/cms) mounts its own
// /api/admin route as a thin wrapper that calls createAdminProxyHandler with
// its own table allowlist. Keeping the handler here ensures both apps stay
// in lockstep on auth, validation, and error handling.

export type ProxyAction = "insert" | "update" | "delete";

export interface AdminProxyConfig {
  // Map each proxied table to the editor feature_key required to write it.
  // Admins bypass this entirely. Editors must hold the matching grant.
  tableFeatureKey: Record<string, FeatureKey>;
  // Allowlisted tables and the columns admins may read/write via this proxy.
  // The set of keys here is also the table allowlist.
  allowedColumns: Record<string, string[]>;
  // Per-table actions that editors are NOT allowed to perform directly.
  // When an editor (non-admin) hits one of these, the proxy returns 403
  // with body `{ code: 'EDITOR_MUST_REQUEST', table, action, match }`.
  // The frontend catches that code and switches to the change-request
  // flow. Admins bypass this gate. Insert is never gated here — editors
  // can always create. Used by the fees module to force edits/deletes of
  // recorded fee_payments through the approval workflow.
  editorRestrictedActions?: Partial<Record<string, ReadonlyArray<Exclude<ProxyAction, "insert">>>>;
  // Escape hatch for tables owned by one module but partially written by
  // another. `student_enrollments` belongs to the students module, yet the
  // transport screen updates only its transport columns — without this, an
  // editor granted 'transport' alone can open the page and change nothing.
  //
  // A rule applies only when the action is `update` AND every key in the
  // payload falls inside its `columns` list, so the alternate grant can never
  // reach a column outside its own module (a transport editor still cannot
  // touch roll_number or status). Admins and holders of the table's own
  // feature key never reach this path.
  columnScopedFeatureKeys?: Partial<
    Record<string, ReadonlyArray<{ featureKey: FeatureKey; columns: readonly string[] }>>
  >;
}

export function createAdminProxyHandler(config: AdminProxyConfig) {
  const {
    tableFeatureKey,
    allowedColumns,
    editorRestrictedActions,
    columnScopedFeatureKeys,
  } = config;
  const allowedTables = Object.keys(allowedColumns);

  // Returns the alternate feature key an editor could hold instead of the
  // table's own, or null when no rule covers this payload. Only `update` is
  // eligible: an insert creates a whole row (columns the caller omitted still
  // get written as defaults) and a delete removes every column, so neither can
  // be honestly described as touching one module's columns.
  function scopedFeatureKey(
    table: string,
    action: ProxyAction,
    data: unknown
  ): FeatureKey | null {
    if (action !== "update") return null;
    const rules = columnScopedFeatureKeys?.[table];
    if (!rules || !data || typeof data !== "object") return null;
    const keys = Object.keys(data as Record<string, unknown>);
    if (keys.length === 0) return null;
    const rule = rules.find((r) => keys.every((k) => r.columns.includes(k)));
    return rule ? rule.featureKey : null;
  }

  return async function POST(request: NextRequest) {
    try {
      const { action, table, data, match } = await request.json();

      if (!allowedTables.includes(table)) {
        return NextResponse.json({ error: "Table not allowed" }, { status: 403 });
      }

      const featureKey = tableFeatureKey[table];
      let auth = await verifyAdminOrEditorWithUser(featureKey);
      if (!auth) {
        // Second chance for a cross-module write whose payload stays inside
        // another feature's columns — see columnScopedFeatureKeys.
        const altKey = scopedFeatureKey(table, action, data);
        if (altKey) auth = await verifyAdminOrEditorWithUser(altKey);
      }
      if (!auth) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const { admin: _admin, user, role } = auth;
      const admin = _admin;

      // Editor-only action gate. Admins bypass; editors hitting a
      // restricted action get an EDITOR_MUST_REQUEST 403 that the
      // frontend translates into the change-request modal.
      if (role === "editor" && (action === "update" || action === "delete")) {
        const restricted = editorRestrictedActions?.[table];
        if (restricted?.includes(action)) {
          return NextResponse.json(
            {
              error:
                "Editors cannot directly modify this record. File a change request for an admin to review.",
              code: "EDITOR_MUST_REQUEST",
              table,
              action,
              match,
            },
            { status: 403 }
          );
        }
      }

      const allowedCols = allowedColumns[table];

      // Validate data keys against column allowlist
      if (data && typeof data === "object") {
        const invalidKeys = Object.keys(data).filter((k) => !allowedCols.includes(k));
        if (invalidKeys.length > 0) {
          return NextResponse.json(
            { error: "Invalid data fields" },
            { status: 400 }
          );
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query = admin.from(table) as any;
      let result: { data: unknown; error: { message: string; code?: string } | null };

      switch (action) {
        case "insert": {
          result = await query.insert(data).select();
          break;
        }
        case "update": {
          if (!match || !match.column || match.value === undefined) {
            return NextResponse.json(
              { error: "Match criteria required for update" },
              { status: 400 }
            );
          }
          if (!allowedCols.includes(match.column)) {
            return NextResponse.json(
              { error: "Invalid match column" },
              { status: 400 }
            );
          }
          result = await query
            .update(data)
            .eq(match.column, match.value)
            .select();
          break;
        }
        case "delete": {
          if (!match || !match.column || match.value === undefined) {
            return NextResponse.json(
              { error: "Match criteria required for delete" },
              { status: 400 }
            );
          }
          if (!allowedCols.includes(match.column)) {
            return NextResponse.json(
              { error: "Invalid match column" },
              { status: 400 }
            );
          }
          result = await query
            .delete()
            .eq(match.column, match.value);
          break;
        }
        default:
          return NextResponse.json(
            { error: "Invalid action. Use insert, update, or delete." },
            { status: 400 }
          );
      }

      if (result.error) {
        console.error(
          `[admin-proxy] error actor=${user.id} table=${table} action=${action}:`,
          result.error
        );
        const errMsg = result.error.message ?? "";
        if (
          result.error.code === "23505" ||
          /duplicate key|unique constraint/i.test(errMsg)
        ) {
          return NextResponse.json(
            { error: "This record already exists. Duplicate entries are not allowed." },
            { status: 409 }
          );
        }
        // FK violation: the row is referenced by other tables. Surface a
        // user-actionable message instead of the generic 500 — for fees the
        // typical cause is recorded payments, and the right move is to
        // deactivate rather than delete. We also pattern-match the message
        // because Supabase sometimes ships the error without `code` set
        // (REST layer occasionally strips it).
        if (
          result.error.code === "23503" ||
          /foreign key|violates foreign key constraint/i.test(errMsg)
        ) {
          const msg =
            action === "delete"
              ? "Cannot delete: other records reference this row. Deactivate it instead, or remove the dependent records first."
              : "This change references a record that doesn't exist or is invalid.";
          return NextResponse.json({ error: msg }, { status: 409 });
        }
        // Check constraint violation — surface a hint pointing at the input
        // since most constraints we have (amount > 0, distance min ≤ max,
        // override-reason length) are about user data.
        if (
          result.error.code === "23514" ||
          /check constraint/i.test(errMsg)
        ) {
          return NextResponse.json(
            {
              error:
                "One or more values don't meet the table's rules (e.g. amount must be > 0, distance min ≤ max). Adjust and retry.",
            },
            { status: 400 }
          );
        }
        // Don't echo Supabase's error.message — it can leak column/table names
        // and constraint hints. The detailed log above is enough for debugging.
        return NextResponse.json(
          { error: "Operation failed. Please check your input and try again." },
          { status: 500 }
        );
      }

      // Cheap structured audit trail. Real audit_log table is the bigger fix
      // tracked separately in the bug audit (H22 follow-up).
      console.info(
        `[admin-proxy] ok actor=${user.id} table=${table} action=${action} match=${
          match ? `${match.column}=${match.value}` : "(none)"
        }`
      );
      return NextResponse.json({ success: true, data: result.data });
    } catch {
      return NextResponse.json(
        { error: "An unexpected error occurred" },
        { status: 500 }
      );
    }
  };
}
