import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

const PAGE_ROUTES: Record<string, string[]> = {
  home: ["/", "/facilities"],
  about: ["/about"],
  "student-life": ["/student-life"],
  facilities: ["/facilities"],
  global: ["/", "/about", "/student-life", "/facilities"],
};

function revalidatePages(page: string) {
  const routes = PAGE_ROUTES[page] ?? ["/"];
  for (const route of routes) {
    revalidatePath(route);
  }
}

export async function GET() {
  const admin = await verifyAdminOrEditor("site_media");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await admin
    .from("site_media")
    .select("*")
    .order("page")
    .order("section")
    .order("sort_order");

  if (error) {
    console.error("Fetch site media error:", error);
    return NextResponse.json({ error: "Failed to fetch site media" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("site_media");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { slot, url } = await request.json();

    if (!slot || !url) {
      return NextResponse.json({ error: "Missing slot or url" }, { status: 400 });
    }

    // Update the slot's current_url and get the page for revalidation
    const { data: updated, error: updateError } = await admin
      .from("site_media")
      .update({ current_url: url, updated_at: new Date().toISOString() })
      .eq("slot", slot)
      .select("page")
      .single();

    if (updateError) {
      console.error("Site media DB update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update media record" },
        { status: 500 }
      );
    }

    revalidatePages(updated?.page ?? "home");

    return NextResponse.json({ success: true, url });
  } catch {
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await verifyAdminOrEditor("site_media");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slot, action } = await request.json();

  if (!slot || action !== "reset") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Get the default_url and page for this slot
  const { data: record, error: fetchError } = await admin
    .from("site_media")
    .select("default_url, current_url, page")
    .eq("slot", slot)
    .single();

  if (fetchError || !record) {
    return NextResponse.json({ error: "Slot not found" }, { status: 404 });
  }

  // Optionally delete the old file from storage if it was a custom upload
  if (record.current_url !== record.default_url && record.current_url.includes("/site-media/")) {
    const urlParts = record.current_url.split("/site-media/");
    const fileName = urlParts[urlParts.length - 1];
    if (fileName) {
      await admin.storage.from("site-media").remove([fileName]);
    }
  }

  // Reset to default
  const { error: updateError } = await admin
    .from("site_media")
    .update({ current_url: record.default_url, updated_at: new Date().toISOString() })
    .eq("slot", slot);

  if (updateError) {
    console.error("Reset site media error:", updateError);
    return NextResponse.json({ error: "Failed to reset media" }, { status: 500 });
  }

  revalidatePages(record.page);

  return NextResponse.json({ success: true });
}
