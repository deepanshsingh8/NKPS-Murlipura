// POST /api/fees/historical-revert
//
// Deletes every fee_payments row tagged with a given import_batch_id and
// source='historical_import'. Admin-only — editors cannot revert imports
// even if they hold the "fees" feature permission, because a bad revert
// destroys data permanently.
//
// Guards:
//   • caller's profile.role must be 'admin'
//   • body.batch_id must be a UUID
//   • body.confirm_batch_id must match — type-the-id confirmation prevents
//     fat-finger reverts of the wrong batch
//   • Block revert if any row in the batch has a downstream artifact:
//       - any later non-historical payment from the same student for the
//         same fee_structure (the original import has been "built on")
//       - any row with status='refunded' (refund flow already touched it)
//
// A day-book batch (migration 115) also creates the students who paid this
// session but are not on the roster, plus their enrollments. Reverting removes
// those too — otherwise undoing an import leaves a drift of ghost students
// nobody can account for. Only rows tagged with this batch id are touched, and
// a student who has picked up any other history in the meantime is kept.


import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { fetchAllRows } from "@nkps/shared/lib/fetch-all-rows";

export async function POST(req: NextRequest) {
  // Admin-only auth. Read the bearer token + verify role='admin' inline so
  // editors with the 'fees' feature flag can't revert.
  const headerList = await headers();
  const authHeader = headerList.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;
  const { data: profile } = await admin
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.must_change_password || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden — admin role required to revert imports" },
      { status: 403 }
    );
  }

  let body: { batch_id?: string; confirm_batch_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const batchId = body.batch_id?.trim();
  const confirmId = body.confirm_batch_id?.trim();
  if (!batchId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
    return NextResponse.json({ error: "batch_id must be a UUID" }, { status: 400 });
  }
  if (confirmId !== batchId) {
    return NextResponse.json(
      { error: "confirm_batch_id must match batch_id (type-to-confirm)" },
      { status: 400 }
    );
  }

  // Look up the batch — confirm at least one row exists.
  const { data: rows, error: rowsErr } = await admin
    .from("fee_payments")
    .select("id, student_id, fee_structure_id, status, amount_paid")
    .eq("import_batch_id", batchId)
    .eq("source", "historical_import");
  if (rowsErr) {
    return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { error: `No historical-import rows found for batch ${batchId}` },
      { status: 404 }
    );
  }

  // Guard: any row in this batch already refunded?
  const refunded = rows.filter((r) => r.status === "refunded");
  if (refunded.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot revert: ${refunded.length} row(s) in this batch have status='refunded'. Resolve those manually before reverting.`,
        refunded_count: refunded.length,
      },
      { status: 409 }
    );
  }

  // Guard: has any (student_id, fee_structure_id) in this batch received a
  // follow-up native payment? That would indicate downstream work has been
  // built on the imported rows.
  const pairs = new Map<string, { student_id: string; fee_structure_id: string }>();
  for (const r of rows) {
    if (r.fee_structure_id) {
      const k = `${r.student_id}::${r.fee_structure_id}`;
      pairs.set(k, { student_id: r.student_id, fee_structure_id: r.fee_structure_id });
    }
  }
  const followups: number = await countFollowupNativePayments(admin, [...pairs.values()]);
  if (followups > 0) {
    return NextResponse.json(
      {
        error: `Cannot revert: ${followups} native (non-imported) payment(s) exist for students/structures in this batch. Reverting would orphan those follow-up payments. Delete them first if intentional.`,
        followups,
      },
      { status: 409 }
    );
  }

  // Delete the rows.
  const { error: delErr, count } = await admin
    .from("fee_payments")
    .delete({ count: "exact" })
    .eq("import_batch_id", batchId)
    .eq("source", "historical_import");
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Enrollments and stub students created by the same batch. Payments are
  // gone by this point, so a failure here is reported as a partial revert
  // rather than rolled back — the same honesty the results revert applies.
  const warnings: string[] = [];
  let enrollmentsDeleted = 0;
  let studentsDeleted = 0;

  const { data: batchEnrollments, error: enrollReadErr } = await admin
    .from("student_enrollments")
    .select("id, student_id")
    .eq("import_batch_id", batchId)
    .eq("source", "historical_import");

  if (enrollReadErr) {
    warnings.push(
      `Payments were deleted, but the batch's enrollments could not be read ` +
        `(${enrollReadErr.message}). Remove them by hand.`
    );
  } else if (batchEnrollments && batchEnrollments.length > 0) {
    const { error: enrollDelErr, count: enrollCount } = await admin
      .from("student_enrollments")
      .delete({ count: "exact" })
      .eq("import_batch_id", batchId)
      .eq("source", "historical_import");
    if (enrollDelErr) {
      warnings.push(
        `Payments were deleted, but ${batchEnrollments.length} enrollment(s) ` +
          `could not be removed (${enrollDelErr.message}).`
      );
    } else {
      enrollmentsDeleted = enrollCount ?? batchEnrollments.length;
      const studentIds = [...new Set(batchEnrollments.map((e) => e.student_id as string))];
      const removed = await deleteStubStudents(admin, studentIds);
      studentsDeleted = removed.deleted;
      warnings.push(...removed.warnings);
    }
  }

  // Stamp the registry last, so a batch is only marked reverted once its rows
  // are actually gone.
  const { error: stampErr } = await admin
    .from("import_batches")
    .update({ reverted_at: new Date().toISOString(), reverted_by: userId })
    .eq("id", batchId);
  if (stampErr) {
    warnings.push(
      `The batch was reverted but could not be marked as such ` +
        `(${stampErr.message}). It will still appear as active in the import history.`
    );
  }

  return NextResponse.json({
    success: true,
    deleted: count ?? rows.length,
    enrollments_deleted: enrollmentsDeleted,
    students_deleted: studentsDeleted,
    batch_id: batchId,
    warnings,
  });
}

/**
 * Delete the stub students a day-book import created, and only those.
 *
 * A student is removed only when nothing else references them: no payments, no
 * results, no attendance, no remaining enrollment, no portal login, no TC. If
 * anything at all has attached to them since the import, they are kept and
 * named in the warnings — deleting a students row CASCADEs to receipts and
 * results, so the cautious direction here is to leave a stray student behind
 * rather than destroy history that outlived the batch.
 */
async function deleteStubStudents(
  admin: ReturnType<typeof createAdminClient>,
  studentIds: string[]
): Promise<{ deleted: number; warnings: string[] }> {
  const warnings: string[] = [];
  if (studentIds.length === 0) return { deleted: 0, warnings };

  const keep = new Set<string>();
  const dependents: Array<{ table: string; column: string }> = [
    { table: "fee_payments", column: "student_id" },
    { table: "results", column: "student_id" },
    { table: "attendance", column: "student_id" },
    { table: "student_enrollments", column: "student_id" },
    { table: "profiles", column: "student_id" },
    { table: "transfer_certificates", column: "student_id" },
  ];

  for (const dep of dependents) {
    const { data, error } = await admin
      .from(dep.table)
      .select(dep.column)
      .in(dep.column, studentIds);
    if (error) {
      // Fail closed: an unreadable dependency means we cannot prove the
      // student is unreferenced, so nothing is deleted.
      warnings.push(
        `Stub students were kept: could not check ${dep.table} ` +
          `(${error.message}).`
      );
      return { deleted: 0, warnings };
    }
    for (const row of data ?? []) {
      const id = (row as unknown as Record<string, unknown>)[dep.column];
      if (typeof id === "string") keep.add(id);
    }
  }

  // Only students created by this import, i.e. never activated by anyone.
  const { data: stubs, error: stubErr } = await admin
    .from("students")
    .select("id, admission_no, full_name")
    .in("id", studentIds)
    .eq("is_active", false)
    .eq("is_alumni", false);
  if (stubErr) {
    warnings.push(`Stub students were kept: ${stubErr.message}`);
    return { deleted: 0, warnings };
  }

  const removable = (stubs ?? []).filter((s) => !keep.has(s.id as string));
  const kept = studentIds.length - removable.length;
  if (kept > 0) {
    warnings.push(
      `${kept} student(s) created by this import were kept because other ` +
        `records now reference them. Review them in People → Students → Exited.`
    );
  }
  if (removable.length === 0) return { deleted: 0, warnings };

  const { error: delErr, count } = await admin
    .from("students")
    .delete({ count: "exact" })
    .in(
      "id",
      removable.map((s) => s.id as string)
    );
  if (delErr) {
    warnings.push(`Stub students could not be deleted: ${delErr.message}`);
    return { deleted: 0, warnings };
  }
  return { deleted: count ?? removable.length, warnings };
}

/**
 * Native payments that landed on a (student, fee_structure) pair this batch
 * also touched — the sign that someone has built on the imported rows.
 *
 * The pairs are intersected in memory rather than in the query. The obvious
 * `.in(student_id, …).in(fee_structure_id, …)` is a cross-product: with a
 * day-book batch spanning 800+ students and a shared class schedule, it counts
 * any native payment by any student in the batch against any structure in the
 * batch, and a single unrelated receipt would then block the revert forever.
 * A revert that can never run is the same as no revert.
 *
 * Errors still fail closed — an unreadable ledger means we cannot prove the
 * batch is safe to remove.
 */
async function countFollowupNativePayments(
  admin: ReturnType<typeof createAdminClient>,
  pairs: Array<{ student_id: string; fee_structure_id: string }>
): Promise<number> {
  if (pairs.length === 0) return 0;

  const wanted = new Set(pairs.map((p) => `${p.student_id}::${p.fee_structure_id}`));
  const studentIds = [...new Set(pairs.map((p) => p.student_id))];

  let total = 0;
  // Chunked to keep the PostgREST query string within limits, and each chunk
  // paged: `.range(0, 9999)` cannot lift PostgREST's 1000-row cap, and a short
  // read here UNDER-counts the follow-up payments that make a revert unsafe.
  // Every other failure in this function returns Infinity precisely so the
  // revert is refused rather than allowed on incomplete information; a
  // truncated read has to do the same.
  for (let i = 0; i < studentIds.length; i += 200) {
    const chunk = studentIds.slice(i, i + 200);
    const { data, error, truncated } = await fetchAllRows<{
      student_id: string;
      fee_structure_id: string;
    }>((from, to) =>
      admin
        .from("fee_payments")
        .select("student_id, fee_structure_id")
        .in("student_id", chunk)
        .eq("source", "erp_native")
        .not("fee_structure_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (error || truncated) return Number.POSITIVE_INFINITY;
    for (const row of data) {
      if (wanted.has(`${row.student_id}::${row.fee_structure_id}`)) total += 1;
    }
  }
  return total;
}
