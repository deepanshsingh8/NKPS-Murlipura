import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";

export const runtime = "nodejs";

/**
 * Saved report presets.
 *
 * Ownership is enforced here as well as in RLS. The queries run on the
 * service-role client (consistent with every other admin route in this app,
 * and required because it is reached with a bearer token rather than a cookie
 * session), which bypasses RLS — so these checks are the live control, not a
 * convenience. The policies in migration 091 are the backstop.
 *
 * Rules:
 *  • You see your own presets plus every shared one.
 *  • You may only create presets owned by yourself.
 *  • Only admins may publish (`is_shared`) or touch a system preset
 *    (`created_by IS NULL`).
 */

const presetBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  entity: z.literal("students").default("students"),
  // Stored whole and re-validated on use by reportFiltersSchema, so a preset
  // saved before a filter was added still loads.
  filters: z.record(z.string(), z.unknown()).default({}),
  fields: z.array(z.string().max(64)).max(200).default([]),
  is_shared: z.boolean().default(false),
});

export async function GET() {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await caller.admin
    .from("report_presets")
    .select("id, name, entity, filters, fields, is_shared, created_by, updated_at")
    .eq("entity", "students")
    .or(`created_by.eq.${caller.user.id},is_shared.is.true`)
    .order("is_shared", { ascending: false })
    .order("name");

  if (error) {
    console.error("[reports.presets.GET]", error);
    return NextResponse.json({ error: "Failed to load presets" }, { status: 500 });
  }

  return NextResponse.json({
    data: (data ?? []).map((p) => ({
      ...p,
      // The UI needs to know which delete buttons to render without learning
      // anyone's user id.
      can_edit: caller.role === "admin" || p.created_by === caller.user.id,
      is_system: p.created_by === null,
    })),
  });
}

export async function POST(request: Request) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = presetBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid preset", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.is_shared && caller.role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin can share a preset with everyone" },
      { status: 403 }
    );
  }

  // Upsert on (owner, name): saving twice under the same name overwrites,
  // which is what "Save" means to someone iterating on a report.
  const { data, error } = await caller.admin
    .from("report_presets")
    .upsert(
      {
        name: parsed.data.name,
        entity: parsed.data.entity,
        filters: parsed.data.filters,
        fields: parsed.data.fields,
        is_shared: parsed.data.is_shared,
        created_by: caller.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "created_by, name" }
    )
    .select("id, name, entity, filters, fields, is_shared, created_by, updated_at")
    .single();

  if (error) {
    console.error("[reports.presets.POST]", error);
    return NextResponse.json({ error: "Failed to save preset" }, { status: 500 });
  }

  return NextResponse.json({
    data: { ...data, can_edit: true, is_system: false },
  });
}

export async function DELETE(request: Request) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Read first: the caller must be told "not yours" rather than silently
  // getting a 200 for a delete that matched nothing.
  const { data: existing, error: readError } = await caller.admin
    .from("report_presets")
    .select("id, created_by")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    console.error("[reports.presets.DELETE] read", readError);
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  const isOwner = existing.created_by === caller.user.id;
  if (!isOwner && caller.role !== "admin") {
    return NextResponse.json(
      { error: "You can only delete your own presets" },
      { status: 403 }
    );
  }

  const { error } = await caller.admin.from("report_presets").delete().eq("id", id);
  if (error) {
    console.error("[reports.presets.DELETE]", error);
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
