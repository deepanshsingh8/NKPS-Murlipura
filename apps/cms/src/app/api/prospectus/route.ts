import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { extractStoragePath } from "@nkps/shared/lib/storage-paths";

const BUCKET = "prospectus";

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("prospectus");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { url, fileName, title } = await request.json();

    if (!url || !title?.trim()) {
      return NextResponse.json(
        { error: "Missing url or title" },
        { status: 400 }
      );
    }

    // Append to the end of the list.
    const { data: last } = await admin
      .from("prospectus_documents")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = (last?.sort_order ?? -1) + 1;

    const { error } = await admin.from("prospectus_documents").insert({
      title: title.trim(),
      file_url: url,
      file_name: fileName || null,
      sort_order: sortOrder,
    });

    if (error) {
      console.error("Prospectus insert error:", error);
      return NextResponse.json(
        { error: "Failed to save document record" },
        { status: 500 }
      );
    }

    revalidatePath("/prospectus");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Prospectus Upload Error]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await verifyAdminOrEditor("prospectus");
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
      .from("prospectus_documents")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Prospectus delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete document" },
        { status: 500 }
      );
    }

    revalidatePath("/prospectus");
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
