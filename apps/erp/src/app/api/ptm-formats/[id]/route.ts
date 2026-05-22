import { NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { ptmFormatSchema } from "@nkps/shared/lib/validations";

// PATCH /api/ptm-formats/[id] — admin-only. Same is_default-clearing
// logic as POST so flipping a template to default doesn't collide with the
// partial unique index.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = ptmFormatSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.is_default === true) {
    await admin
      .from("ptm_formats")
      .update({ is_default: false })
      .eq("is_default", true)
      .neq("id", id);
  }

  const { data, error } = await admin
    .from("ptm_formats")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("[ptm-formats.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to update PTM format" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

// DELETE /api/ptm-formats/[id] — admin-only. Rejects deleting the
// last remaining active template so the generate flow always has a row to
// fall back to.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { count } = await admin
    .from("ptm_formats")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last template" },
      { status: 400 }
    );
  }

  const { error } = await admin.from("ptm_formats").delete().eq("id", id);
  if (error) {
    console.error("[ptm-formats.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete PTM format" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
