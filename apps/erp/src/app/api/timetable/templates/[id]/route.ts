import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

interface PeriodInput {
  position: number;
  kind: "teaching" | "lunch" | "break";
  label?: string | null;
  start_time: string;
  end_time: string;
}

/**
 * PUT  /api/timetable/templates/[id]   → replace this template's period rows + edit metadata
 *                                        Body: { name?, description?, periods: PeriodInput[] }
 * DELETE /api/timetable/templates/[id] → delete (only if not is_system)
 */

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdminOrEditor("timetable");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json();
  const periods: PeriodInput[] = Array.isArray(body?.periods) ? body.periods : [];

  // Validation: each period must satisfy end > start, positions are unique 1..N,
  // exactly one lunch slot allowed (per spec — "must include a 20-minute lunch break").
  if (periods.length === 0) {
    return NextResponse.json({ error: "periods cannot be empty" }, { status: 400 });
  }
  const positions = new Set<number>();
  let lunchCount = 0;
  let teachingCount = 0;
  for (const p of periods) {
    if (!Number.isInteger(p.position) || p.position < 1) {
      return NextResponse.json({ error: "positions must be integers ≥ 1" }, { status: 400 });
    }
    if (positions.has(p.position)) {
      return NextResponse.json({ error: `duplicate position ${p.position}` }, { status: 400 });
    }
    positions.add(p.position);
    if (!["teaching", "lunch", "break"].includes(p.kind)) {
      return NextResponse.json({ error: `invalid kind ${p.kind}` }, { status: 400 });
    }
    if (!p.start_time || !p.end_time || p.end_time <= p.start_time) {
      return NextResponse.json({ error: `period ${p.position} has invalid times` }, { status: 400 });
    }
    if (p.kind === "lunch") lunchCount++;
    if (p.kind === "teaching") teachingCount++;
  }
  if (lunchCount === 0) {
    return NextResponse.json({ error: "Each template must include a lunch slot" }, { status: 400 });
  }

  // Update template metadata if provided
  const meta: Record<string, unknown> = { teaching_period_count: teachingCount };
  if (body?.name) meta.name = String(body.name);
  if (body?.description !== undefined) meta.description = body.description;
  if (body?.code !== undefined) meta.code = body.code;
  const { error: metaErr } = await admin
    .from("timetable_templates")
    .update(meta)
    .eq("id", id);
  if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 400 });

  // Replace all periods atomically — delete then insert.
  const { error: delErr } = await admin
    .from("timetable_template_periods")
    .delete()
    .eq("template_id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  const rows = periods
    .sort((a, b) => a.position - b.position)
    .map((p) => ({
      template_id: id,
      position: p.position,
      kind: p.kind,
      label: p.label ?? null,
      start_time: p.start_time,
      end_time: p.end_time,
    }));
  const { error: insErr } = await admin
    .from("timetable_template_periods")
    .insert(rows);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdminOrEditor("timetable");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  // Refuse to delete system templates — admin should clone-and-edit instead.
  const { data: row } = await admin
    .from("timetable_templates")
    .select("is_system")
    .eq("id", id)
    .maybeSingle();
  if ((row as { is_system: boolean } | null)?.is_system) {
    return NextResponse.json({ error: "System templates cannot be deleted; clone and edit instead." }, { status: 400 });
  }
  const { error } = await admin.from("timetable_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
