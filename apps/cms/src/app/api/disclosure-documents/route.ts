import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { extractStoragePath } from "@nkps/shared/lib/storage-paths";

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("disclosure");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { url, fileName: originalName, docKey } = await request.json();

    if (!url || !docKey) {
      return NextResponse.json(
        { error: "Missing url or docKey" },
        { status: 400 }
      );
    }

    // Find the existing document row
    const { data: existing } = await admin
      .from("disclosure_documents")
      .select("id, file_url")
      .eq("doc_key", docKey)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Document slot not found" },
        { status: 404 }
      );
    }

    // Delete old file from storage if replacing. L2 — derive the path via
    // extractStoragePath so cache-buster query strings don't no-op the
    // delete.
    if (existing.file_url) {
      const oldPath = extractStoragePath(existing.file_url, "disclosure-documents");
      if (oldPath) {
        await admin.storage.from("disclosure-documents").remove([oldPath]);
      }
    }

    // Update the document row
    const { error: updateError } = await admin
      .from("disclosure_documents")
      .update({
        file_url: url,
        file_name: originalName || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) {
      console.error("Disclosure document DB update error:", updateError);
      return NextResponse.json(
        { error: "Failed to save document record" },
        { status: 500 }
      );
    }

    revalidatePath("/mandatory-public-disclosure");
    return NextResponse.json({ success: true, file_url: url });
  } catch (err) {
    console.error("[Disclosure Document Upload Error]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await verifyAdminOrEditor("disclosure");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, fileUrl } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    // Remove file from storage.
    if (fileUrl) {
      const path = extractStoragePath(fileUrl, "disclosure-documents");
      if (path) await admin.storage.from("disclosure-documents").remove([path]);
    }

    // Clear file_url and file_name on the row (keep the row itself)
    const { error } = await admin
      .from("disclosure_documents")
      .update({
        file_url: null,
        file_name: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("Disclosure document delete error:", error);
      return NextResponse.json(
        { error: "Failed to clear document" },
        { status: 500 }
      );
    }

    revalidatePath("/mandatory-public-disclosure");
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
