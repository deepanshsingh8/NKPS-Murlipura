import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import {
  ELECTIVE_CLASSES,
  isElectiveClass,
  normaliseElectiveClasses,
  type ElectiveClass,
} from "@nkps/shared/lib/electives";

/**
 * Manage the per-slot allowed subject lists.
 * Admin (or editor with `subjects` permission) can add/scope/remove options.
 *
 * XI and XII keep separate lists via `applies_to_classes`. Because the table
 * is UNIQUE(slot, subject_id), a subject offered to both classes is one row
 * naming both — so POST merges into an existing row rather than failing on the
 * constraint, and PATCH narrows or widens that row.
 */

/**
 * Reads `applies_to_classes` off a request body.
 * Returns the parsed list, or null when the caller sent something invalid.
 * Omitting the field entirely means both classes, matching the column default.
 */
function readClasses(raw: unknown): ElectiveClass[] | null {
  if (raw === undefined || raw === null) return [...ELECTIVE_CLASSES];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every(isElectiveClass)) return null;
  return ELECTIVE_CLASSES.filter((c) => raw.includes(c));
}

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("subjects");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const slot = Number(body?.slot);
  const subjectId = String(body?.subject_id ?? "");
  const label = body?.label ? String(body.label) : `Elective ${slot}`;
  const sortOrder = Number(body?.sort_order ?? 0);
  const classes = readClasses(body?.applies_to_classes);

  if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
    return NextResponse.json({ error: "slot must be 1–9" }, { status: 400 });
  }
  if (!subjectId) {
    return NextResponse.json({ error: "subject_id is required" }, { status: 400 });
  }
  if (!classes) {
    return NextResponse.json(
      { error: "applies_to_classes must be a non-empty list of XI and/or XII" },
      { status: 400 }
    );
  }

  // Already offered in this slot for the other class — widen that row instead
  // of inserting a second one the UNIQUE constraint would reject anyway.
  const { data: existing } = await admin
    .from("elective_slot_options")
    .select("id, applies_to_classes, is_active")
    .eq("slot", slot)
    .eq("subject_id", subjectId)
    .maybeSingle();

  if (existing) {
    const merged = ELECTIVE_CLASSES.filter(
      (c) =>
        classes.includes(c) ||
        normaliseElectiveClasses(existing.applies_to_classes).includes(c)
    );
    const { error } = await admin
      .from("elective_slot_options")
      .update({ applies_to_classes: merged, is_active: true })
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ id: existing.id, applies_to_classes: merged });
  }

  const { data, error } = await admin
    .from("elective_slot_options")
    .insert({
      slot,
      subject_id: subjectId,
      label,
      applies_to_classes: classes,
      sort_order: sortOrder,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ id: data?.id, applies_to_classes: classes });
}

/**
 * Re-scope an existing option: PATCH { id, applies_to_classes }.
 *
 * Sending an empty list is how the UI removes an option from its last
 * remaining class, so it is treated as a delete rather than an error — a row
 * that applies to no class would sit in the table invisible and unfixable.
 */
export async function PATCH(request: Request) {
  const admin = await verifyAdminOrEditor("subjects");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const raw = body?.applies_to_classes;
  if (!Array.isArray(raw) || !raw.every(isElectiveClass)) {
    return NextResponse.json(
      { error: "applies_to_classes must be a list of XI and/or XII" },
      { status: 400 }
    );
  }

  if (raw.length === 0) {
    const { error } = await admin.from("elective_slot_options").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const classes = ELECTIVE_CLASSES.filter((c) => raw.includes(c));
  const { error } = await admin
    .from("elective_slot_options")
    .update({ applies_to_classes: classes })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, applies_to_classes: classes });
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
