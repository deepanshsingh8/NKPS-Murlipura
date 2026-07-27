import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { buildWhiteSheetData } from "@/lib/white-sheet";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (profile.role !== "admin") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "white_sheet")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const examTypeId = searchParams.get("exam_type_id");

  if (!classId || !examTypeId) {
    return NextResponse.json(
      { error: "class_id and exam_type_id are required" },
      { status: 400 }
    );
  }

  // The builder reads `results` (and related tables) which have no SELECT
  // policy for editors (role 'staff'), so on the RLS-bound cookie client an
  // editor would silently get a blank sheet. Build the data with the
  // service-role client; the admin/editor permission gate above (on the cookie
  // client) is unchanged.
  const data = await buildWhiteSheetData(createAdminClient(), classId, examTypeId);
  if (!data) {
    return NextResponse.json(
      { error: "Class or exam type not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
