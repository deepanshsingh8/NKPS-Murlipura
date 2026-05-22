import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import {
  sectionCardCreateSchema,
  sectionCardUpdateSchema,
} from "@nkps/shared/lib/validations";

export async function GET(request: NextRequest) {
  const admin = await verifyAdminOrEditor("site_media");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const section = request.nextUrl.searchParams.get("section");

  let query = admin
    .from("section_cards")
    .select("*")
    .order("section")
    .order("sort_order");

  if (section) {
    query = query.eq("section", section);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Fetch section cards error:", error);
    return NextResponse.json({ error: "Failed to fetch section cards" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("site_media");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = sectionCardCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const fields = parsed.data;
    const name = fields.name ?? null;

    // User-added cards are never default. Defaults are only created via the
    // seed migrations under scripts/migrations/cms/.
    const record: Record<string, unknown> = {
      section: fields.section,
      title: fields.title ?? null,
      subtitle: fields.subtitle ?? null,
      description: fields.description ?? null,
      quote: fields.quote ?? null,
      name,
      role: fields.role ?? null,
      initials: name ? name.charAt(0).toUpperCase() : null,
      date: fields.date ?? null,
      cta_text: fields.cta_text ?? null,
      cta_link: fields.cta_link ?? null,
      icon: fields.icon ?? null,
      link: fields.link ?? null,
      designation: fields.designation ?? null,
      message: fields.message ?? null,
      year: fields.year ?? null,
      season: fields.season ?? null,
      image_url: fields.image_url || null,
      sort_order: fields.sort_order ?? 0,
      is_active: fields.is_active !== false,
      is_default: false,
    };

    const { data, error: insertError } = await admin
      .from("section_cards")
      .insert(record)
      .select()
      .single();

    if (insertError) {
      console.error("Section card insert error:", insertError);
      return NextResponse.json({ error: "Failed to create card" }, { status: 500 });
    }

    revalidatePath("/");

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await verifyAdminOrEditor("site_media");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Action: reset_to_default — restore a default card's editable fields
    // from the snapshot captured at seed time. Image and sort_order are
    // intentionally NOT reset (admins often re-photo / re-order without
    // wanting that wiped when they reset the copy).
    if (body?.action === "reset_to_default") {
      const id = typeof body.id === "string" ? body.id : null;
      if (!id) {
        return NextResponse.json({ error: "Card ID is required" }, { status: 400 });
      }
      const { data: card, error: fetchError } = await admin
        .from("section_cards")
        .select("is_default, default_snapshot")
        .eq("id", id)
        .single();
      if (fetchError || !card) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!card.is_default || !card.default_snapshot) {
        return NextResponse.json(
          { error: "This card has no default snapshot to reset to" },
          { status: 409 }
        );
      }
      const snapshot = card.default_snapshot as Record<string, unknown>;
      const { error: resetError } = await admin
        .from("section_cards")
        .update({ ...snapshot, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (resetError) {
        console.error("Section card reset error:", resetError);
        return NextResponse.json({ error: "Failed to reset card" }, { status: 500 });
      }
      revalidatePath("/");
      return NextResponse.json({ success: true });
    }

    const confirmEmpty = body?.confirm_empty === true;

    const parsed = sectionCardUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { id, data: parsedUpdates } = parsed.data;
    // Mutable copy for the auto-derived fields below.
    const updates: Record<string, unknown> = { ...parsedUpdates };

    if (updates.name) {
      updates.initials = (updates.name as string).charAt(0).toUpperCase();
    }

    // Empty-section guard: if this PATCH would deactivate the only remaining
    // active card in its section, the CMS must opt in via confirm_empty so
    // editors don't accidentally make a section disappear from the website.
    if (updates.is_active === false && !confirmEmpty) {
      const { data: target } = await admin
        .from("section_cards")
        .select("section, is_active")
        .eq("id", id)
        .single();
      if (target?.is_active === true) {
        const { count } = await admin
          .from("section_cards")
          .select("id", { count: "exact", head: true })
          .eq("section", target.section)
          .eq("is_active", true);
        if ((count ?? 0) <= 1) {
          return NextResponse.json(
            {
              error: `This is the last active card in "${target.section}". Pass confirm_empty=true to leave the section empty on the website.`,
              code: "section_would_be_empty",
            },
            { status: 409 }
          );
        }
      }
    }

    // Clean up old image from storage if a new image_url is provided
    if (updates.image_url) {
      const { data: existing } = await admin
        .from("section_cards")
        .select("image_url")
        .eq("id", id)
        .single();

      if (existing?.image_url?.includes("/site-media/section-cards/")) {
        const urlParts = existing.image_url.split("/site-media/");
        const oldFileName = urlParts[urlParts.length - 1];
        if (oldFileName) {
          await admin.storage.from("site-media").remove([oldFileName]);
        }
      }
    }

    updates.updated_at = new Date().toISOString();

    const { error: updateError } = await admin
      .from("section_cards")
      .update(updates)
      .eq("id", id);

    if (updateError) {
      console.error("Section card update error:", updateError);
      return NextResponse.json({ error: "Failed to update card" }, { status: 500 });
    }

    revalidatePath("/");

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await verifyAdminOrEditor("site_media");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Card ID is required" }, { status: 400 });
    }

    // Default cards are protected: deactivate them, don't delete. The seed
    // migrations are the only thing that should produce or remove these rows.
    const { data: card } = await admin
      .from("section_cards")
      .select("image_url, is_default")
      .eq("id", id)
      .single();

    if (card?.is_default) {
      return NextResponse.json(
        {
          error: "Cannot delete a default card. Deactivate it to hide it from the website instead.",
          code: "default_card_protected",
        },
        { status: 409 }
      );
    }

    if (card?.image_url?.includes("/site-media/section-cards/")) {
      const urlParts = card.image_url.split("/site-media/");
      const fileName = urlParts[urlParts.length - 1];
      if (fileName) {
        await admin.storage.from("site-media").remove([fileName]);
      }
    }

    const { error } = await admin
      .from("section_cards")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Section card delete error:", error);
      return NextResponse.json({ error: "Failed to delete card" }, { status: 500 });
    }

    revalidatePath("/");

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
