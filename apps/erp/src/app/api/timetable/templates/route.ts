import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * §2 §3 Timetable templates.
 * GET  /api/timetable/templates                → list all with their periods
 * POST /api/timetable/templates                → clone an existing system template
 * POST /api/timetable/templates  (no clone)    → create a blank custom template
 */

interface TemplatePeriodRow {
  id: string;
  template_id: string;
  position: number;
  kind: "teaching" | "lunch" | "break";
  label: string | null;
  start_time: string;
  end_time: string;
}

export async function GET() {
  const admin = await verifyAdminOrEditor("timetable");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: templates } = await admin
    .from("timetable_templates")
    .select("*")
    .order("code");

  const { data: allPeriods } = await admin
    .from("timetable_template_periods")
    .select("*")
    .order("position");

  const grouped: Record<string, TemplatePeriodRow[]> = {};
  for (const p of (allPeriods as TemplatePeriodRow[]) ?? []) {
    if (!grouped[p.template_id]) grouped[p.template_id] = [];
    grouped[p.template_id].push(p);
  }

  return NextResponse.json({
    templates: (templates ?? []).map((t) => ({
      ...t,
      periods: grouped[(t as { id: string }).id] ?? [],
    })),
  });
}

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("timetable");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const cloneFromId: string | undefined = body?.clone_from_id;
  const name: string = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  // 1) Insert a new (non-system) template row
  let teachingCount = 0;
  let cloneRows: TemplatePeriodRow[] = [];
  if (cloneFromId) {
    const { data: src } = await admin
      .from("timetable_templates")
      .select("teaching_period_count")
      .eq("id", cloneFromId)
      .single();
    teachingCount = (src as { teaching_period_count: number } | null)?.teaching_period_count ?? 0;

    const { data: srcPeriods } = await admin
      .from("timetable_template_periods")
      .select("*")
      .eq("template_id", cloneFromId)
      .order("position");
    cloneRows = (srcPeriods as TemplatePeriodRow[]) ?? [];
  } else {
    teachingCount = Number(body?.teaching_period_count ?? 0);
  }

  const { data: created, error } = await admin
    .from("timetable_templates")
    .insert({
      name,
      code: body?.code ?? null,
      description: body?.description ?? null,
      teaching_period_count: teachingCount,
      is_system: false,
    })
    .select("id")
    .single();
  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Failed to create" }, { status: 400 });
  }

  if (cloneRows.length > 0) {
    const rows = cloneRows.map((r) => ({
      template_id: (created as { id: string }).id,
      position: r.position,
      kind: r.kind,
      label: r.label,
      start_time: r.start_time,
      end_time: r.end_time,
    }));
    const { error: pErr } = await admin.from("timetable_template_periods").insert(rows);
    if (pErr) {
      return NextResponse.json({ error: `Template created but periods failed: ${pErr.message}` }, { status: 400 });
    }
  }

  return NextResponse.json({ id: (created as { id: string }).id });
}
