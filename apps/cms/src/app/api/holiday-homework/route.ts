import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { extractStoragePath } from "@nkps/shared/lib/storage-paths";

const BUCKET = "holiday-homework";

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("holiday_homework");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { url, fileName, title, classGrade, session, academicYear } =
      await request.json();

    if (!url || !title?.trim() || !classGrade || !session || !academicYear) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const { data: last } = await admin
      .from("holiday_homework")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = (last?.sort_order ?? -1) + 1;

    const { error } = await admin.from("holiday_homework").insert({
      title: title.trim(),
      class_grade: classGrade,
      session,
      academic_year: academicYear,
      file_url: url,
      file_name: fileName || null,
      sort_order: sortOrder,
    });

    if (error) {
      console.error("Holiday homework insert error:", error);
      return NextResponse.json(
        { error: "Failed to save homework record" },
        { status: 500 }
      );
    }

    revalidatePath("/holiday-homework");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Holiday Homework Upload Error]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await verifyAdminOrEditor("holiday_homework");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, fileUrl } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    if (fileUrl) {
      const path = extractStoragePath(fileUrl, BUCKET);
      if (path) await admin.storage.from(BUCKET).remove([path]);
    }

    const { error } = await admin
      .from("holiday_homework")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Holiday homework delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete homework" },
        { status: 500 }
      );
    }

    revalidatePath("/holiday-homework");
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
