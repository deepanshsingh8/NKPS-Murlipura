import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { slugify } from "@nkps/shared/lib/articles";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function revalidateArticlePaths(slug?: string | null) {
  revalidatePath("/");
  revalidatePath("/articles");
  if (slug) revalidatePath(`/articles/${slug}`);
}

export async function GET(request: NextRequest) {
  const admin = await verifyAdminOrEditor("articles");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("slug");

  let query = admin.from("articles").select("*").order("published_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  if (slug) query = query.eq("slug", slug);

  const { data, error } = await query;
  if (error) {
    console.error("Fetch articles error:", error);
    return NextResponse.json({ error: "Failed to fetch articles" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("articles");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const title = (body.title as string | undefined)?.trim();
    const content = (body.content as string | undefined) ?? "";

    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (!content.trim()) return NextResponse.json({ error: "Content is required" }, { status: 400 });

    const slug = ((body.slug as string | undefined)?.trim() || slugify(title)).toLowerCase();
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json({ error: "Slug must be lowercase letters, numbers, and hyphens only" }, { status: 400 });
    }

    const { data: existing } = await admin.from("articles").select("id").eq("slug", slug).maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "An article with this slug already exists" }, { status: 409 });
    }

    const isPublished = body.is_published === true;
    const tags = Array.isArray(body.tags)
      ? (body.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean)
      : [];

    const record = {
      slug,
      title,
      excerpt: (body.excerpt as string | undefined)?.trim() || null,
      content,
      cover_image_url: (body.cover_image_url as string | undefined) || null,
      author_name: (body.author_name as string | undefined)?.trim() || null,
      meta_description: (body.meta_description as string | undefined)?.trim() || null,
      tags,
      is_published: isPublished,
      published_at: isPublished ? (body.published_at || new Date().toISOString()) : null,
    };

    const { data, error: insertError } = await admin.from("articles").insert(record).select().single();

    if (insertError) {
      console.error("Article insert error:", insertError);
      return NextResponse.json({ error: "Failed to create article" }, { status: 500 });
    }

    revalidateArticlePaths(slug);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Article POST unexpected error:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await verifyAdminOrEditor("articles");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, data: updates = {} } = body as { id?: string; data?: Record<string, unknown> };

    if (!id) return NextResponse.json({ error: "Article ID is required" }, { status: 400 });

    const { data: existing } = await admin
      .from("articles")
      .select("id, slug, is_published, published_at, cover_image_url")
      .eq("id", id)
      .single();

    if (!existing) return NextResponse.json({ error: "Article not found" }, { status: 404 });

    if (typeof updates.slug === "string") {
      const newSlug = updates.slug.trim().toLowerCase();
      if (!SLUG_RE.test(newSlug)) {
        return NextResponse.json({ error: "Slug must be lowercase letters, numbers, and hyphens only" }, { status: 400 });
      }
      if (newSlug !== existing.slug) {
        const { data: dupe } = await admin.from("articles").select("id").eq("slug", newSlug).maybeSingle();
        if (dupe) return NextResponse.json({ error: "An article with this slug already exists" }, { status: 409 });
      }
      updates.slug = newSlug;
    }

    if (updates.is_published === true && !existing.is_published && !updates.published_at) {
      updates.published_at = new Date().toISOString();
    }

    if (typeof updates.cover_image_url === "string" && existing.cover_image_url && existing.cover_image_url !== updates.cover_image_url) {
      if (existing.cover_image_url.includes("/site-media/articles/")) {
        const parts = existing.cover_image_url.split("/site-media/");
        const oldFile = parts[parts.length - 1];
        if (oldFile) await admin.storage.from("site-media").remove([oldFile]);
      }
    }

    updates.updated_at = new Date().toISOString();

    const { error: updateError } = await admin.from("articles").update(updates).eq("id", id);
    if (updateError) {
      console.error("Article update error:", updateError);
      return NextResponse.json({ error: "Failed to update article" }, { status: 500 });
    }

    const finalSlug = typeof updates.slug === "string" ? updates.slug : existing.slug;
    revalidateArticlePaths(existing.slug);
    if (finalSlug !== existing.slug) revalidateArticlePaths(finalSlug);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Article PATCH unexpected error:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await verifyAdminOrEditor("articles");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "Article ID is required" }, { status: 400 });

    const { data: article } = await admin
      .from("articles")
      .select("slug, cover_image_url")
      .eq("id", id)
      .single();

    // Always attempt to clean up the cover image, regardless of URL shape.
    // Earlier code only matched the `/site-media/articles/…` pattern, which
    // skipped the older `/site-media/<filename>` format and left orphan
    // blobs behind. We now extract the path after `/site-media/` (if present)
    // and try a delete; failures are logged but never block the article delete.
    if (article?.cover_image_url) {
      const url = article.cover_image_url;
      const marker = "/site-media/";
      const idx = url.indexOf(marker);
      if (idx >= 0) {
        const fileName = url.slice(idx + marker.length).split("?")[0];
        if (fileName) {
          const { error: storageErr } = await admin.storage
            .from("site-media")
            .remove([fileName]);
          if (storageErr) {
            console.error(
              `[articles.DELETE] storage cleanup ${fileName}:`,
              storageErr
            );
          }
        }
      }
    }

    const { error } = await admin.from("articles").delete().eq("id", id);
    if (error) {
      console.error("Article delete error:", error);
      return NextResponse.json({ error: "Failed to delete article" }, { status: 500 });
    }

    revalidateArticlePaths(article?.slug);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Article DELETE unexpected error:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
