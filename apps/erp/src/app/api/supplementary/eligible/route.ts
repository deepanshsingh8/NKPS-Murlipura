import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { buildSupplementaryEligible } from "@/lib/supplementary";

// GET /api/supplementary/eligible?class_id=&exam_type_id=
// Returns the eligibility list (failing-but-close students per subject)
// for the given class+exam, plus any pre-existing attempt rows. Admin or
// teacher (RLS-scoped at the row level), editors with `supplementary_exams`.
export async function GET(request: NextRequest) {
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
  if (profile.role !== "admin" && profile.role !== "teacher") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "supplementary_exams")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const params = request.nextUrl.searchParams;
  const classId = params.get("class_id");
  const examTypeId = params.get("exam_type_id");
  if (!classId || !examTypeId) {
    return NextResponse.json(
      { error: "class_id and exam_type_id are required" },
      { status: 400 }
    );
  }

  const data = await buildSupplementaryEligible(supabase, classId, examTypeId);
  if (!data) {
    return NextResponse.json(
      { error: "Class or exam type not found" },
      { status: 404 }
    );
  }
  return NextResponse.json(data);
}
