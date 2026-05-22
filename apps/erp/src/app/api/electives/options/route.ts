import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * Manage the per-slot allowed subject lists.
 * Admin (or editor with `subjects` permission) can add/remove options.
 */

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("subjects");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const slot = Number(body?.slot);
  const subjectId = String(body?.subject_id ?? "");
  const label = body?.label ? String(body.label) : `Elective ${slot}`;
  const sortOrder = Number(body?.sort_order ?? 0);

  if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
    return NextResponse.json({ error: "slot must be 1–9" }, { status: 400 });
  }
  if (!subjectId) {
    return NextResponse.json({ error: "subject_id is required" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("elective_slot_options")
    .insert({
      slot,
      subject_id: subjectId,
      label,
      sort_order: sortOrder,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ id: data?.id });
}

export async function DELETE(request: Request) {
  const admin = await verifyAdminOrEditor("subjects");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await admin.from("elective_slot_options").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
