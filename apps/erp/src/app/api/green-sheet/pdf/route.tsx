import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { getPdfTemplate } from "@/lib/pdf-templates";
import { GreenSheetPDF } from "@/components/pdf/GreenSheetPDF";
import { buildGreenSheetData } from "@/lib/green-sheet";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";

export const runtime = "nodejs";

let cachedLogo: Buffer | null = null;
async function loadLogo(): Promise<Buffer | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const logoPath = path.join(process.cwd(), "public", "images", "logo.png");
    cachedLogo = await fs.readFile(logoPath);
    return cachedLogo;
  } catch {
    return null;
  }
}

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
      .eq("feature_key", "green_sheet")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const academicYearId = searchParams.get("academic_year_id");
  if (!classId || !academicYearId) {
    return NextResponse.json(
      { error: "class_id and academic_year_id are required" },
      { status: 400 }
    );
  }

  const data = await buildGreenSheetData(supabase, classId, academicYearId);
  if (!data) {
    return NextResponse.json(
      { error: "Class or academic year not found" },
      { status: 404 }
    );
  }

  const { header } = await getPdfTemplate(supabase, "green_sheet");
  const logoData = await loadLogo();
  const generatedOn = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const buffer = await renderToBuffer(
    <GreenSheetPDF
      school={{
        name: header.school_name,
        address_line: header.address_line,
        affiliation: header.affiliation,
        affiliation_number: header.affiliation_number,
      }}
      meta={data.meta}
      exams={data.exams}
      rows={data.rows}
      logoData={logoData ?? undefined}
      generatedOn={generatedOn}
    />
  );

  const safe = (s: string) => s.replace(/[^\w\-]+/g, "_");
  const filename = `green-sheet_${safe(data.meta.class_name)}_${safe(
    data.meta.section ?? ""
  )}_${safe(data.meta.academic_year_label)}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionAttachment(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
