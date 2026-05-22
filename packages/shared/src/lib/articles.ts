import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type { Article } from "@nkps/shared/types";

export async function getLatestArticles(limit = 3): Promise<Article[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("articles")
    .select("*")
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as Article[];
}

export async function getPublishedArticles(): Promise<Article[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("articles")
    .select("*")
    .eq("is_published", true)
    .order("published_at", { ascending: false });

  return (data ?? []) as Article[];
}

export async function getArticleBySlug(
  slug: string,
  { publishedOnly = true }: { publishedOnly?: boolean } = {}
): Promise<Article | null> {
  const supabase = createAdminClient();
  let query = supabase.from("articles").select("*").eq("slug", slug);
  if (publishedOnly) query = query.eq("is_published", true);
  const { data } = await query.maybeSingle();
  return (data as Article | null) ?? null;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
