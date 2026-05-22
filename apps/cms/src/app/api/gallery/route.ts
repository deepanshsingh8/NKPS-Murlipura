import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("gallery");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { url, alt, category, currentCount = 0, gallery_event_id } = await request.json();

    if (!url || !alt || !category) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const { error: insertError } = await admin
      .from("gallery_images")
      .insert({
        src: url,
        alt,
        category,
        sort_order: currentCount,
        gallery_event_id: gallery_event_id || null,
      });

    if (insertError) {
      console.error("Gallery DB insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to save image record" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, src: url });
  } catch (err) {
    console.error("[Gallery Upload Error]", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await verifyAdminOrEditor("gallery");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Bulk delete: body.items = [{ id, src }, ...]
    if (Array.isArray(body.items) && body.items.length > 0) {
      const items = body.items as { id: string; src: string }[];
      const fileNames = items.map((item) => {
        const parts = item.src.split("/");
        return parts[parts.length - 1];
      });
      const ids = items.map((item) => item.id);

      // Delete DB rows first — if Storage removal fails later we can retry, but
      // an orphaned row pointing at a missing file shows broken images in the UI.
      const { error } = await admin
        .from("gallery_images")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("Gallery bulk delete DB error:", error);
        return NextResponse.json({ error: "Failed to delete images" }, { status: 500 });
      }

      if (fileNames.length > 0) {
        const { error: storageError } = await admin.storage.from("gallery").remove(fileNames);
        if (storageError) {
          console.error("Gallery bulk delete storage error:", storageError);
        }
      }

      return NextResponse.json({ success: true, deleted: ids.length });
    }

    // Single delete
    const { id, src } = body;

    const urlParts = (src as string).split("/");
    const fileName = urlParts[urlParts.length - 1];

    const { error } = await admin
      .from("gallery_images")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Gallery delete DB error:", error);
      return NextResponse.json({ error: "Failed to delete image" }, { status: 500 });
    }

    const { error: storageError } = await admin.storage.from("gallery").remove([fileName]);
    if (storageError) {
      console.error("Gallery delete storage error:", storageError);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Gallery Delete Error]", err);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
