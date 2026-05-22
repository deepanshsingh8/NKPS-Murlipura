import { NextResponse } from "next/server";
import { getCallerAccess } from "@nkps/shared/lib/verify-admin";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

// CMS-side dashboard counts. Privileged stats never appear in the response
// for an editor who lacks the grant, so nothing leaks into the DOM.
export async function GET() {
  const access = await getCallerAccess();
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, isAdmin, permissions } = access;
  const can = (key: FeatureKey) => isAdmin || permissions.has(key);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const monthIso = startOfMonth.toISOString();

  // Run every block in parallel and short-circuit anything the caller can't see.
  const [
    galleryCountRes,
    galleryMonthRes,
    galleryByCategoryRes,
    galleryRecentRes,
    tcCountRes,
    tcMonthRes,
    tcRecentRes,
    unreadCountRes,
    contactTotalRes,
    contactMonthRes,
    contactRecentRes,
    articlesPublishedRes,
    articlesDraftRes,
    articlesMonthRes,
    articlesRecentRes,
    siteMediaCountRes,
    siteMediaRecentRes,
    disclosureCountRes,
    disclosureWithFileRes,
    disclosureRecentRes,
  ] = await Promise.all([
    can("gallery")
      ? admin.from("gallery_images").select("*", { count: "exact", head: true })
      : Promise.resolve({ count: null as number | null }),
    can("gallery")
      ? admin
          .from("gallery_images")
          .select("*", { count: "exact", head: true })
          .gte("created_at", monthIso)
      : Promise.resolve({ count: null as number | null }),
    can("gallery")
      ? admin.from("gallery_images").select("category")
      : Promise.resolve({ data: null as { category: string }[] | null }),
    can("gallery")
      ? admin
          .from("gallery_images")
          .select("id, alt, category, created_at")
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null as { id: string; alt: string; category: string; created_at: string }[] | null }),

    can("transfer_certificates")
      ? admin
          .from("transfer_certificates")
          .select("*", { count: "exact", head: true })
      : Promise.resolve({ count: null as number | null }),
    can("transfer_certificates")
      ? admin
          .from("transfer_certificates")
          .select("*", { count: "exact", head: true })
          .gte("created_at", monthIso)
      : Promise.resolve({ count: null as number | null }),
    can("transfer_certificates")
      ? admin
          .from("transfer_certificates")
          .select("id, student_name, academic_year, created_at")
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null as { id: string; student_name: string; academic_year: string; created_at: string }[] | null }),

    can("contact")
      ? admin
          .from("contact_submissions")
          .select("*", { count: "exact", head: true })
          .eq("is_read", false)
      : Promise.resolve({ count: null as number | null }),
    can("contact")
      ? admin
          .from("contact_submissions")
          .select("*", { count: "exact", head: true })
      : Promise.resolve({ count: null as number | null }),
    can("contact")
      ? admin
          .from("contact_submissions")
          .select("*", { count: "exact", head: true })
          .gte("created_at", monthIso)
      : Promise.resolve({ count: null as number | null }),
    can("contact")
      ? admin
          .from("contact_submissions")
          .select("id, full_name, subject, message, is_read, created_at")
          .order("created_at", { ascending: false })
          .limit(4)
      : Promise.resolve({ data: null as { id: string; full_name: string; subject: string; message: string; is_read: boolean; created_at: string }[] | null }),

    can("articles")
      ? admin
          .from("articles")
          .select("*", { count: "exact", head: true })
          .eq("is_published", true)
      : Promise.resolve({ count: null as number | null }),
    can("articles")
      ? admin
          .from("articles")
          .select("*", { count: "exact", head: true })
          .eq("is_published", false)
      : Promise.resolve({ count: null as number | null }),
    can("articles")
      ? admin
          .from("articles")
          .select("*", { count: "exact", head: true })
          .gte("created_at", monthIso)
      : Promise.resolve({ count: null as number | null }),
    can("articles")
      ? admin
          .from("articles")
          .select("id, title, is_published, published_at, created_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null as { id: string; title: string; is_published: boolean; published_at: string | null; created_at: string; updated_at: string }[] | null }),

    can("site_media")
      ? admin.from("site_media").select("*", { count: "exact", head: true })
      : Promise.resolve({ count: null as number | null }),
    can("site_media")
      ? admin
          .from("site_media")
          .select("id, label, slot, updated_at")
          .order("updated_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null as { id: string; label: string; slot: string; updated_at: string }[] | null }),

    can("disclosure")
      ? admin.from("disclosure_documents").select("*", { count: "exact", head: true })
      : Promise.resolve({ count: null as number | null }),
    can("disclosure")
      ? admin
          .from("disclosure_documents")
          .select("*", { count: "exact", head: true })
          .not("file_url", "is", null)
      : Promise.resolve({ count: null as number | null }),
    can("disclosure")
      ? admin
          .from("disclosure_documents")
          .select("id, label, doc_key, file_url, updated_at")
          .order("updated_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null as { id: string; label: string; doc_key: string; file_url: string | null; updated_at: string }[] | null }),
  ]);

  const stats: Partial<
    Record<"galleryCount" | "tcCount" | "unreadCount", number>
  > = {};
  if (can("gallery")) stats.galleryCount = galleryCountRes.count ?? 0;
  if (can("transfer_certificates")) stats.tcCount = tcCountRes.count ?? 0;
  if (can("contact")) stats.unreadCount = unreadCountRes.count ?? 0;

  // Aggregate gallery category counts client-server side (Supabase has no
  // group-by helper without raw SQL/views).
  const galleryByCategory: { name: string; count: number }[] = [];
  if (can("gallery") && galleryByCategoryRes.data) {
    const tallies = new Map<string, number>();
    for (const row of galleryByCategoryRes.data) {
      tallies.set(row.category, (tallies.get(row.category) ?? 0) + 1);
    }
    for (const [name, count] of tallies) galleryByCategory.push({ name, count });
    galleryByCategory.sort((a, b) => b.count - a.count);
  }

  // Build a unified activity feed from whatever the caller can see. Each
  // entry encodes the feature so the client can route the click and pick the
  // right icon.
  type Activity = {
    id: string;
    feature: FeatureKey;
    title: string;
    sublabel: string | null;
    at: string;
    action: "added" | "updated";
  };
  const activity: Activity[] = [];

  if (can("gallery") && galleryRecentRes.data) {
    for (const r of galleryRecentRes.data) {
      activity.push({
        id: `gallery-${r.id}`,
        feature: "gallery",
        title: r.alt,
        sublabel: r.category,
        at: r.created_at,
        action: "added",
      });
    }
  }
  if (can("transfer_certificates") && tcRecentRes.data) {
    for (const r of tcRecentRes.data) {
      activity.push({
        id: `tc-${r.id}`,
        feature: "transfer_certificates",
        title: r.student_name,
        sublabel: r.academic_year,
        at: r.created_at,
        action: "added",
      });
    }
  }
  if (can("articles") && articlesRecentRes.data) {
    for (const r of articlesRecentRes.data) {
      const wasUpdated =
        r.updated_at && r.created_at && r.updated_at !== r.created_at;
      activity.push({
        id: `article-${r.id}`,
        feature: "articles",
        title: r.title,
        sublabel: r.is_published ? "Published" : "Draft",
        at: r.updated_at ?? r.created_at,
        action: wasUpdated ? "updated" : "added",
      });
    }
  }
  if (can("site_media") && siteMediaRecentRes.data) {
    for (const r of siteMediaRecentRes.data) {
      activity.push({
        id: `media-${r.id}`,
        feature: "site_media",
        title: r.label,
        sublabel: r.slot,
        at: r.updated_at,
        action: "updated",
      });
    }
  }
  if (can("disclosure") && disclosureRecentRes.data) {
    for (const r of disclosureRecentRes.data) {
      activity.push({
        id: `disclosure-${r.id}`,
        feature: "disclosure",
        title: r.label,
        sublabel: r.file_url ? "File uploaded" : "No file",
        at: r.updated_at,
        action: "updated",
      });
    }
  }

  activity.sort((a, b) => b.at.localeCompare(a.at));
  const recentActivity = activity.slice(0, 8);

  // Per-feature breakdown blocks. Server omits anything the caller lacks.
  const breakdown: {
    gallery?: {
      total: number;
      addedThisMonth: number;
      byCategory: { name: string; count: number }[];
    };
    articles?: {
      published: number;
      drafts: number;
      addedThisMonth: number;
    };
    siteMedia?: { total: number };
    disclosure?: { total: number; withFile: number };
    transferCertificates?: { total: number; addedThisMonth: number };
    contact?: {
      total: number;
      unread: number;
      addedThisMonth: number;
    };
  } = {};

  if (can("gallery")) {
    breakdown.gallery = {
      total: galleryCountRes.count ?? 0,
      addedThisMonth: galleryMonthRes.count ?? 0,
      byCategory: galleryByCategory,
    };
  }
  if (can("articles")) {
    breakdown.articles = {
      published: articlesPublishedRes.count ?? 0,
      drafts: articlesDraftRes.count ?? 0,
      addedThisMonth: articlesMonthRes.count ?? 0,
    };
  }
  if (can("site_media")) {
    breakdown.siteMedia = { total: siteMediaCountRes.count ?? 0 };
  }
  if (can("disclosure")) {
    breakdown.disclosure = {
      total: disclosureCountRes.count ?? 0,
      withFile: disclosureWithFileRes.count ?? 0,
    };
  }
  if (can("transfer_certificates")) {
    breakdown.transferCertificates = {
      total: tcCountRes.count ?? 0,
      addedThisMonth: tcMonthRes.count ?? 0,
    };
  }
  if (can("contact")) {
    breakdown.contact = {
      total: contactTotalRes.count ?? 0,
      unread: unreadCountRes.count ?? 0,
      addedThisMonth: contactMonthRes.count ?? 0,
    };
  }

  const recentMessages = can("contact")
    ? (contactRecentRes.data ?? []).map((m) => ({
        id: m.id,
        full_name: m.full_name,
        subject: m.subject,
        snippet: (m.message ?? "").slice(0, 110),
        is_read: m.is_read,
        created_at: m.created_at,
      }))
    : [];

  return NextResponse.json({
    stats,
    cmsInsights: {
      breakdown,
      recentActivity,
      recentMessages,
    },
  });
}
