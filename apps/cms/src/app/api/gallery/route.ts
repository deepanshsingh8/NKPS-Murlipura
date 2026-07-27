import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { extractStoragePath } from "@nkps/shared/lib/storage-paths";

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

    // Bulk delete: body.items = [{ id }, ...]. We IGNORE any client-supplied
    // src and re-derive the storage path from the DB row, so a crafted body
    // can't point the delete at an arbitrary object.
    if (Array.isArray(body.items) && body.items.length > 0) {
      const items = body.items as { id: string }[];
      const ids = items.map((item) => item.id);

      const { data: rows } = await admin
        .from("gallery_images")
        .select("src")
        .in("id", ids);
      const fileNames = (rows ?? [])
        .map((r: { src: string | null }) => extractStoragePath(r.src, "gallery"))
        .filter((p): p is string => !!p);

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

    // Single delete. Re-derive the storage path from the DB row (not the
    // client-supplied src) so the delete can't be aimed at another object.
    const { id } = body;

    const { data: row } = await admin
      .from("gallery_images")
      .select("src")
      .eq("id", id)
      .maybeSingle();
    const fileName = row ? extractStoragePath(row.src, "gallery") : null;

    const { error } = await admin
      .from("gallery_images")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Gallery delete DB error:", error);
      return NextResponse.json({ error: "Failed to delete image" }, { status: 500 });
    }

    if (!fileName) {
      return NextResponse.json({ success: true });
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
