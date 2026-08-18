import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { feeScheduleCopySchema } from "@nkps/shared/lib/validations";
import type { FeeStructure } from "@nkps/shared/types";

// Copy one saved fee schedule onto other classes / streams.
//
// Nursery–X and XII share the same schedule shape (only the amounts differ),
// and XI needs the same rows repeated for every stream. Re-keying five rows
// fifteen times by hand is where transcription errors come from, so the admin
// builds one schedule and clones it, then edits the amounts per class.
//
// A target that already has rows is REPLACED wholesale — a copy is "make this
// class look like that one", and merging would leave the target holding a mix
// of two schedules. Rows already referenced by receipts can't be deleted, so
// those are deactivated instead and reported back.

const FK_VIOLATION = "23503";

// Columns carried over to the copy. Deliberately excludes id/created_at and
// the bucket keys (class_name, stream_id), which the target supplies.
const COPIED_COLUMNS = [
  "fee_type",
  "amount",
  "frequency",
  "due_date",
  "instalment_no",
  "instalment_name",
  "month_label",
  "student_type",
  "late_fee_start_date",
  "late_fee_percent",
  "late_fee_per_day",
  "late_fee_max",
  "description",
  "class_level",
] as const;

export async function POST(request: Request) {
  try {
    const auth = await verifyAdminOrEditorWithUser("fees");
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { admin } = auth;

    const parsed = feeScheduleCopySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid copy request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { academic_year_id, source_class_name, targets } = parsed.data;
    const source_stream_id = parsed.data.source_stream_id ?? null;

    let sourceQuery = admin
      .from("fee_structures")
      .select(COPIED_COLUMNS.join(", "))
      .eq("academic_year_id", academic_year_id)
      .eq("class_name", source_class_name)
      .eq("is_active", true);
    sourceQuery = source_stream_id
      ? sourceQuery.eq("stream_id", source_stream_id)
      : sourceQuery.is("stream_id", null);
    const { data: sourceRows, error: sourceError } = await sourceQuery;
    if (sourceError) {
      return NextResponse.json(
        { error: `Failed to read source schedule: ${sourceError.message}` },
        { status: 500 }
      );
    }
    const source = (sourceRows as unknown as Partial<FeeStructure>[]) ?? [];
    if (source.length === 0) {
      return NextResponse.json(
        { error: "The source class has no active fee schedule to copy." },
        { status: 400 }
      );
    }

    let copied = 0;
    let deactivated = 0;
    const skipped: string[] = [];

    for (const target of targets) {
      const targetStreamId = target.stream_id ?? null;
      // Copying a schedule onto itself would wipe the source and re-insert it
      // — harmless in effect but it churns ids that receipts point at.
      if (
        target.class_name === source_class_name &&
        targetStreamId === source_stream_id
      ) {
        skipped.push(target.class_name);
        continue;
      }

      // Only the live schedule is replaced. Rows already deactivated (because
      // receipts reference them) stay put — they're history, not the schedule.
      let existingQuery = admin
        .from("fee_structures")
        .select("id")
        .eq("academic_year_id", academic_year_id)
        .eq("class_name", target.class_name)
        .eq("is_active", true);
      existingQuery = targetStreamId
        ? existingQuery.eq("stream_id", targetStreamId)
        : existingQuery.is("stream_id", null);
      const { data: existing, error: existingError } = await existingQuery;
      if (existingError) {
        return NextResponse.json(
          {
            error: `Failed to read ${target.class_name}'s schedule: ${existingError.message}`,
          },
          { status: 500 }
        );
      }

      for (const row of (existing as { id: string }[] | null) ?? []) {
        const { error } = await admin
          .from("fee_structures")
          .delete()
          .eq("id", row.id);
        if (!error) continue;
        if (error.code !== FK_VIOLATION) {
          return NextResponse.json(
            {
              error: `Failed to clear ${target.class_name}'s schedule: ${error.message}`,
            },
            { status: 400 }
          );
        }
        const { error: deactivateError } = await admin
          .from("fee_structures")
          .update({ is_active: false })
          .eq("id", row.id);
        if (deactivateError) {
          return NextResponse.json(
            {
              error: `Failed to deactivate a paid row in ${target.class_name}: ${deactivateError.message}`,
            },
            { status: 400 }
          );
        }
        deactivated += 1;
      }

      const { error: insertError } = await admin.from("fee_structures").insert(
        source.map((row) => ({
          ...row,
          academic_year_id,
          class_name: target.class_name,
          stream_id: targetStreamId,
          is_active: true,
        }))
      );
      if (insertError) {
        return NextResponse.json(
          {
            error: `Failed to copy into ${target.class_name}: ${insertError.message}`,
          },
          { status: 400 }
        );
      }
      copied += 1;
    }

    return NextResponse.json({
      success: true,
      rows: source.length,
      classes: copied,
      deactivated,
      skipped,
    });
  } catch (error) {
    console.error("Fee schedule copy error:", error);
    return NextResponse.json(
      { error: "Failed to copy fee schedule" },
      { status: 500 }
    );
  }
}
