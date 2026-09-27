import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

/**
 * Correct the leaving date on a student who has already left.
 *
 * The date is collected when a student is marked Exited/Terminated, but it is
 * also backfilled (migration 123) for everyone who left before the column
 * existed — and where the paperwork lagged, that backfill lands on the day the
 * exit was TYPED rather than the day the child actually left. Since the date
 * is the fee billing cutoff, a wrong one leaves real money on the register.
 *
 * Deliberately separate from PATCH /api/students/status: that route moves a
 * student between statuses, and change_enrollment_status() skips a no-op
 * transition — so it can never be used to re-state a date on a status the
 * student already holds. This one changes only the date.
 */

const exitDateSchema = z.object({
  enrollment_id: z.string().uuid(),
  exit_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Leaving date must be YYYY-MM-DD"),
  // Optional: the RPC composes a self-describing reason either way, and
  // demanding a justification to fix a typo just trains people to type "x".
  note: z.string().trim().max(400).optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    // ...WithUser so the actor lands on the history row, matching the status
    // and promote routes — the other editor-permitted endpoints that attribute.
    const auth = await verifyAdminOrEditorWithUser("students");
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { admin, user } = auth;

    const parsed = exitDateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { enrollment_id, exit_date, note } = parsed.data;

    const { data, error } = await admin.rpc("set_enrollment_exit_date", {
      p_enrollment_id: enrollment_id,
      p_exit_date: exit_date,
      p_note: note ?? null,
      p_actor: user.id,
    });

    if (error) {
      console.error("[students.exit-date.PATCH]", error);
      // The RPC's RAISE messages are written for the operator ("A leaving date
      // cannot be in the future", "Only a student marked Exited or Terminated
      // has a leaving date") — surfacing them beats a generic failure that
      // leaves them guessing which of their two inputs was wrong.
      const message = error.message ?? "";
      const isValidation =
        message.includes("leaving date") || message.includes("Enrollment not found");
      return NextResponse.json(
        { error: isValidation ? message : "Failed to update the leaving date" },
        { status: isValidation ? 400 : 500 }
      );
    }

    const result = (data ?? {}) as {
      changed?: boolean;
      exit_date?: string;
      previous_exit_date?: string | null;
    };

    return NextResponse.json({
      success: true,
      changed: result.changed ?? false,
      exit_date: result.exit_date ?? exit_date,
      previous_exit_date: result.previous_exit_date ?? null,
    });
  } catch (err) {
    console.error("Update exit date error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
