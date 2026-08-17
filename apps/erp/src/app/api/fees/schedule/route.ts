import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { feeScheduleSchema } from "@nkps/shared/lib/validations";
import type { FeeStructure } from "@nkps/shared/types";

// Fee schedule save endpoint (migration 085).
//
// The admin edits a whole schedule as a grid — add rows, edit rows, delete
// rows — and hits Save once. Persisting that row-by-row through the generic
// /api/admin proxy would mean N round trips with no way to reject a partially
// invalid grid, so the whole schedule is submitted here and reconciled against
// what's already stored for the (year, class, stream) bucket:
//
//   • row with an id      → UPDATE in place (keeps receipts pointing at it)
//   • row without an id   → INSERT
//   • stored row missing  → DELETE, or deactivate when payments reference it
//
// A schedule row is a `fee_structures` row with frequency='one_time'; the
// amount IS what's owed on the due date, with no frequency multiplier.

// Payments FK to fee_structures, so a row that has been billed can't be hard
// deleted. Postgres reports that as 23503 (foreign_key_violation); we fall
// back to is_active=false, which removes the row from every dues/expected
// calculation while keeping issued receipts resolvable.
const FK_VIOLATION = "23503";

export async function POST(request: Request) {
  try {
    const auth = await verifyAdminOrEditorWithUser("fees");
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { admin } = auth;

    const parsed = feeScheduleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid schedule", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { academic_year_id, class_name, rows } = parsed.data;
    const stream_id = parsed.data.stream_id ?? null;

    // Existing rows in this bucket. `.is`/`.eq` differ for null, so the stream
    // filter has to branch — a whole-class schedule must not sweep up the
    // stream-specific ones sitting beside it. Scoped to active rows because
    // that is exactly what the grid loaded and the admin edited: an already-
    // deactivated row was never on screen, so its absence from the payload
    // isn't a request to delete it.
    let existingQuery = admin
      .from("fee_structures")
      .select("id")
      .eq("academic_year_id", academic_year_id)
      .eq("class_name", class_name)
      .eq("is_active", true);
    existingQuery = stream_id
      ? existingQuery.eq("stream_id", stream_id)
      : existingQuery.is("stream_id", null);
    const { data: existingRows, error: existingError } = await existingQuery;
    if (existingError) {
      return NextResponse.json(
        { error: `Failed to load current schedule: ${existingError.message}` },
        { status: 500 }
      );
    }
    const existingIds = new Set(
      ((existingRows as { id: string }[] | null) ?? []).map((r) => r.id)
    );

    // Reject an id the caller doesn't own before writing anything: without
    // this, a crafted payload could relabel another class's fee row (and its
    // receipts) by submitting that id inside this bucket's schedule.
    const foreignId = rows.find((r) => r.id && !existingIds.has(r.id));
    if (foreignId) {
      return NextResponse.json(
        { error: "A row in this schedule does not belong to this class." },
        { status: 400 }
      );
    }

    const submittedIds = new Set(
      rows.map((r) => r.id).filter((id): id is string => Boolean(id))
    );

    const toRow = (
      row: (typeof rows)[number],
      index: number
    ): Partial<FeeStructure> => ({
      academic_year_id,
      class_name,
      stream_id,
      fee_type: row.fee_type,
      amount: row.amount,
      // Each grid row is a single dated instalment, never a recurring fee.
      frequency: "one_time",
      due_date: row.due_date,
      instalment_no: index + 1,
      instalment_name: row.instalment_name?.trim() || null,
      month_label: row.month_label?.trim() || null,
      student_type: row.student_type,
      late_fee_start_date: row.late_fee_start_date || null,
      late_fee_percent: row.late_fee_percent ?? 0,
      late_fee_per_day: row.late_fee_per_day ?? 0,
      late_fee_max: row.late_fee_max ?? null,
      is_active: true,
    });

    // Rows are numbered by their position in the saved (due-date sorted) grid,
    // so S No stays stable for whoever opens the schedule next.
    const ordered = [...rows].sort((a, b) =>
      a.due_date === b.due_date
        ? a.fee_type.localeCompare(b.fee_type)
        : a.due_date < b.due_date
          ? -1
          : 1
    );

    const inserts = ordered
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => !row.id)
      .map(({ row, i }) => toRow(row, i));

    if (inserts.length > 0) {
      const { error } = await admin.from("fee_structures").insert(inserts);
      if (error) {
        return NextResponse.json(
          { error: `Failed to add schedule rows: ${error.message}` },
          { status: 400 }
        );
      }
    }

    for (const [i, row] of ordered.entries()) {
      if (!row.id) continue;
      const { error } = await admin
        .from("fee_structures")
        .update(toRow(row, i))
        .eq("id", row.id);
      if (error) {
        return NextResponse.json(
          { error: `Failed to update schedule row: ${error.message}` },
          { status: 400 }
        );
      }
    }

    // Removals. Deactivate rather than fail when receipts already reference
    // the row, and report which ones so the UI can say so plainly.
    const removedIds = [...existingIds].filter((id) => !submittedIds.has(id));
    let deactivated = 0;
    for (const id of removedIds) {
      const { error } = await admin
        .from("fee_structures")
        .delete()
        .eq("id", id);
      if (!error) continue;
      if (error.code !== FK_VIOLATION) {
        return NextResponse.json(
          { error: `Failed to remove schedule row: ${error.message}` },
          { status: 400 }
        );
      }
      const { error: deactivateError } = await admin
        .from("fee_structures")
        .update({ is_active: false })
        .eq("id", id);
      if (deactivateError) {
        return NextResponse.json(
          {
            error: `Failed to deactivate a paid schedule row: ${deactivateError.message}`,
          },
          { status: 400 }
        );
      }
      deactivated += 1;
    }

    return NextResponse.json({
      success: true,
      saved: ordered.length,
      removed: removedIds.length - deactivated,
      deactivated,
    });
  } catch (error) {
    console.error("Fee schedule save error:", error);
    return NextResponse.json(
      { error: "Failed to save fee schedule" },
      { status: 500 }
    );
  }
}
