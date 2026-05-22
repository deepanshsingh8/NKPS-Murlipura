import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { ptmFormatSchema } from "@nkps/shared/lib/validations";

// GET /api/ptm-formats — list all templates (any authenticated user).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ptm_formats")
    .select("*")
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("[ptm-formats.GET] list:", error);
    return NextResponse.json({ error: "Failed to load PTM formats" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/ptm-formats — create (admin only).
export async function POST(request: Request) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = ptmFormatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // If this insert sets is_default=true, clear any other default first —
  // the partial unique index would otherwise reject the insert.
  if (parsed.data.is_default) {
    await admin
      .from("ptm_formats")
      .update({ is_default: false })
      .eq("is_default", true);
  }

  const { data, error } = await admin
    .from("ptm_formats")
    .insert(parsed.data)
    .select()
    .single();
  if (error) {
    console.error("[ptm-formats.POST] insert:", error);
    return NextResponse.json({ error: "Failed to create PTM format" }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}
