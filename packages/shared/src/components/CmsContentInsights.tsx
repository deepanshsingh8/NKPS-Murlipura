"use client";

import Link from "next/link";
import {
  Image as ImageIcon,
  Newspaper,
  Layers,
  ScrollText,
  FileText,
  MessageSquare,
  Activity,
  Mail,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

interface BreakdownData {
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
  contact?: { total: number; unread: number; addedThisMonth: number };
}

interface ActivityItem {
  id: string;
  feature: FeatureKey;
  title: string;
  sublabel: string | null;
  at: string;
  action: "added" | "updated";
}

interface RecentMessage {
  id: string;
  full_name: string;
  subject: string;
  snippet: string;
  is_read: boolean;
  created_at: string;
}

export interface CmsInsightsData {
  breakdown: BreakdownData;
  recentActivity: ActivityItem[];
  recentMessages: RecentMessage[];
}

const FEATURE_META: Record<
  FeatureKey,
  { icon: LucideIcon; tone: string; href: string; label: string } | undefined
> = {
  gallery: {
    icon: ImageIcon,
    tone: "bg-amber-100 text-amber-600 dark:bg-amber-900/30",
    href: "/gallery",
    label: "Gallery",
  },
  articles: {
    icon: Newspaper,
    tone: "bg-sky-100 text-sky-600 dark:bg-sky-900/30",
    href: "/articles",
    label: "Article",
  },
  site_media: {
    icon: Layers,
    tone: "bg-violet-100 text-violet-600 dark:bg-violet-900/30",
    href: "/site-media",
    label: "Site media",
  },
  disclosure: {
    icon: ScrollText,
    tone: "bg-teal-100 text-teal-600 dark:bg-teal-900/30",
    href: "/disclosure",
    label: "Disclosure",
  },
  transfer_certificates: {
    icon: FileText,
    tone: "bg-gold-300/30 text-gold-600 dark:bg-gold-500/20",
    href: "/transfer-certificates",
    label: "Transfer certificate",
  },
  contact: {
    icon: MessageSquare,
    tone: "bg-rose-100 text-rose-600 dark:bg-rose-900/30",
    href: "/contact",
    label: "Contact message",
  },
} as Record<FeatureKey, { icon: LucideIcon; tone: string; href: string; label: string } | undefined>;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((now - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.round(diffDay / 7)}w ago`;
  if (diffDay < 365) return `${Math.round(diffDay / 30)}mo ago`;
  return `${Math.round(diffDay / 365)}y ago`;
}

const GALLERY_CATEGORY_TONES: Record<string, string> = {
  academics: "bg-blue-500",
  sports: "bg-emerald-500",
  cultural: "bg-pink-500",
  campus: "bg-amber-500",
  events: "bg-violet-500",
};

function ContentCard({
  icon: Icon,
  label,
  href,
  tone,
  children,
  delay,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  tone: string;
  children: React.ReactNode;
  delay: number;
}) {
  return (
    <Link
      href={href}
      className="erp-stat-card relative overflow-hidden group dash-fade-up block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 hover:border-gray-300/90 dark:hover:border-border"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-110",
              tone
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
            {label}
          </h3>
        </div>
        <ArrowRight className="h-4 w-4 text-gray-300 transition-all duration-200 group-hover:text-blue-500 group-hover:translate-x-0.5" />
      </div>
      {children}
    </Link>
  );
}

function GalleryBreakdown({
  data,
}: {
  data: NonNullable<BreakdownData["gallery"]>;
}) {
  const meta = FEATURE_META.gallery!;
  const topCategories = data.byCategory.slice(0, 5);
  const max = Math.max(...topCategories.map((c) => c.count), 1);
  return (
    <ContentCard
      icon={meta.icon}
      label="Gallery"
      href={meta.href}
      tone={meta.tone}
      delay={0}
    >
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
          {data.total.toLocaleString("en-IN")}
        </span>
        <span className="text-[11px] text-gray-400">images</span>
        {data.addedThisMonth > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">
            +{data.addedThisMonth} this month
          </span>
        )}
      </div>
      {topCategories.length === 0 ? (
        <p className="text-xs text-gray-400">No images yet</p>
      ) : (
        <div className="space-y-1.5">
          {topCategories.map((c, i) => (
            <div key={c.name} className="flex items-center gap-2 text-xs">
              <span className="capitalize w-20 shrink-0 text-gray-600 dark:text-gray-400">
                {c.name}
              </span>
              <div className="flex-1 h-2 rounded bg-gray-100 dark:bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded dash-grow-w",
                    GALLERY_CATEGORY_TONES[c.name] ?? "bg-gray-400"
                  )}
                  style={{
                    width: `${Math.max((c.count / max) * 100, 6)}%`,
                    animationDelay: `${i * 40}ms`,
                  }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-gray-500 w-6 text-right">
                {c.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </ContentCard>
  );
}

function ArticlesBreakdown({
  data,
}: {
  data: NonNullable<BreakdownData["articles"]>;
}) {
  const meta = FEATURE_META.articles!;
  const total = data.published + data.drafts;
  const pubPct = total > 0 ? (data.published / total) * 100 : 0;
  return (
    <ContentCard
      icon={meta.icon}
      label="Articles"
      href={meta.href}
      tone={meta.tone}
      delay={60}
    >
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
          {total.toLocaleString("en-IN")}
        </span>
        <span className="text-[11px] text-gray-400">total</span>
        {data.addedThisMonth > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">
            +{data.addedThisMonth} this month
          </span>
        )}
      </div>
      {total === 0 ? (
        <p className="text-xs text-gray-400">No articles yet</p>
      ) : (
        <>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-muted overflow-hidden mb-2 flex">
            <div
              className="h-full bg-sky-500 dash-grow-w"
              style={{ width: `${pubPct}%` }}
            />
            <div
              className="h-full bg-amber-400 dash-grow-w"
              style={{ width: `${100 - pubPct}%`, animationDelay: "80ms" }}
            />
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <span className="h-2 w-2 rounded-sm bg-sky-500" />
              Published
              <span className="font-semibold text-navy-900 dark:text-white tabular-nums">
                {data.published}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <span className="h-2 w-2 rounded-sm bg-amber-400" />
              Drafts
              <span className="font-semibold text-navy-900 dark:text-white tabular-nums">
                {data.drafts}
              </span>
            </span>
          </div>
        </>
      )}
    </ContentCard>
  );
}

function SiteMediaBreakdown({
  data,
}: {
  data: NonNullable<BreakdownData["siteMedia"]>;
}) {
  const meta = FEATURE_META.site_media!;
  return (
    <ContentCard
      icon={meta.icon}
      label="Site Media"
      href={meta.href}
      tone={meta.tone}
      delay={120}
    >
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
          {data.total.toLocaleString("en-IN")}
        </span>
        <span className="text-[11px] text-gray-400">media slots configured</span>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Logos, banners and section images used across the public site.
      </p>
    </ContentCard>
  );
}

function DisclosureBreakdown({
  data,
}: {
  data: NonNullable<BreakdownData["disclosure"]>;
}) {
  const meta = FEATURE_META.disclosure!;
  const missing = Math.max(data.total - data.withFile, 0);
  const pct = data.total > 0 ? Math.round((data.withFile / data.total) * 100) : 0;
  return (
    <ContentCard
      icon={meta.icon}
      label="Disclosure"
      href={meta.href}
      tone={meta.tone}
      delay={180}
    >
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
          {data.withFile}/{data.total}
        </span>
        <span className="text-[11px] text-gray-400">documents uploaded</span>
        <span
          className={cn(
            "ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded",
            pct === 100
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          )}
        >
          {pct}% complete
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full dash-grow-w",
            pct === 100
              ? "bg-emerald-500"
              : "bg-gradient-to-r from-teal-500 to-teal-400"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {missing > 0 && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          {missing} document{missing === 1 ? "" : "s"} still missing a file.
        </p>
      )}
    </ContentCard>
  );
}

function TcBreakdown({
  data,
}: {
  data: NonNullable<BreakdownData["transferCertificates"]>;
}) {
  const meta = FEATURE_META.transfer_certificates!;
  return (
    <ContentCard
      icon={meta.icon}
      label="Transfer Certificates"
      href={meta.href}
      tone={meta.tone}
      delay={240}
    >
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
          {data.total.toLocaleString("en-IN")}
        </span>
        <span className="text-[11px] text-gray-400">on file</span>
        {data.addedThisMonth > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">
            +{data.addedThisMonth} this month
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Issued certificates available for parent / student lookup.
      </p>
    </ContentCard>
  );
}

function ContactBreakdown({
  data,
}: {
  data: NonNullable<BreakdownData["contact"]>;
}) {
  const meta = FEATURE_META.contact!;
  const read = Math.max(data.total - data.unread, 0);
  return (
    <ContentCard
      icon={meta.icon}
      label="Contact Messages"
      href={meta.href}
      tone={meta.tone}
      delay={300}
    >
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
          {data.total.toLocaleString("en-IN")}
        </span>
        <span className="text-[11px] text-gray-400">total received</span>
        {data.addedThisMonth > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">
            +{data.addedThisMonth} this month
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-[11px]">
        <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <CircleDashed className="h-3.5 w-3.5 text-rose-500" />
          Unread
          <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
            {data.unread}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          Read
          <span className="font-semibold text-navy-900 dark:text-white tabular-nums">
            {read}
          </span>
        </span>
      </div>
    </ContentCard>
  );
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="erp-empty-state bg-white dark:bg-card rounded-2xl border border-gray-200/80 dark:border-border">
        <Activity className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-400">No recent activity</p>
      </div>
    );
  }
  return (
    <div className="bg-white dark:bg-card rounded-2xl border border-gray-200/80 dark:border-border overflow-hidden">
      <ul className="divide-y divide-gray-100 dark:divide-border">
        {items.map((item, i) => {
          const meta = FEATURE_META[item.feature];
          if (!meta) return null;
          const Icon = meta.icon;
          return (
            <li
              key={item.id}
              className="dash-fade-up"
              style={{ animationDelay: `${i * 35}ms` }}
            >
              <Link
                href={meta.href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-muted/40 group"
              >
                <div
                  className={cn(
                    "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                    meta.tone
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-navy-900 dark:text-white truncate">
                    {item.title}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    <span className="capitalize">{meta.label}</span>
                    {" · "}
                    <span>{item.action === "added" ? "Added" : "Updated"}</span>
                    {item.sublabel && (
                      <>
                        {" · "}
                        <span className="capitalize">{item.sublabel}</span>
                      </>
                    )}
                  </p>
                </div>
                <span className="text-[11px] text-gray-400 tabular-nums shrink-0">
                  {relativeTime(item.at)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-300 transition-all duration-200 group-hover:text-blue-500 group-hover:translate-x-0.5 shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MessagesPreview({ items }: { items: RecentMessage[] }) {
  if (items.length === 0) {
    return (
      <div className="erp-empty-state bg-white dark:bg-card rounded-2xl border border-gray-200/80 dark:border-border">
        <Mail className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-400">No messages yet</p>
      </div>
    );
  }
  return (
    <div className="bg-white dark:bg-card rounded-2xl border border-gray-200/80 dark:border-border overflow-hidden">
      <ul className="divide-y divide-gray-100 dark:divide-border">
        {items.map((m, i) => (
          <li
            key={m.id}
            className="dash-fade-up"
            style={{ animationDelay: `${i * 35}ms` }}
          >
            <Link
              href="/contact"
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-muted/40 group"
            >
              <div
                className={cn(
                  "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                  m.is_read
                    ? "bg-gray-100 text-gray-400 dark:bg-muted"
                    : "bg-rose-100 text-rose-600 dark:bg-rose-900/30"
                )}
              >
                <Mail className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p
                    className={cn(
                      "text-sm truncate",
                      m.is_read
                        ? "font-medium text-navy-900 dark:text-white"
                        : "font-semibold text-navy-900 dark:text-white"
                    )}
                  >
                    {m.full_name}
                  </p>
                  {!m.is_read && (
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
                  )}
                  <span className="ml-auto text-[11px] text-gray-400 tabular-nums shrink-0">
                    {relativeTime(m.created_at)}
                  </span>
                </div>
                <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300 truncate">
                  {m.subject}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {m.snippet}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CmsContentInsights({
  data,
  loading,
}: {
  data: CmsInsightsData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="erp-stat-card animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-9 w-9 rounded-lg bg-gray-100 dark:bg-muted" />
                <div className="h-4 w-28 bg-gray-100 dark:bg-muted rounded" />
              </div>
              <div className="space-y-2">
                <div className="h-6 w-20 bg-gray-100 dark:bg-muted rounded" />
                <div className="h-2 w-full bg-gray-100 dark:bg-muted rounded" />
                <div className="h-2 w-3/4 bg-gray-100 dark:bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { breakdown, recentActivity, recentMessages } = data;
  const hasContact = !!breakdown.contact;
  const hasAnyBreakdown =
    !!breakdown.gallery ||
    !!breakdown.articles ||
    !!breakdown.siteMedia ||
    !!breakdown.disclosure ||
    !!breakdown.transferCertificates ||
    !!breakdown.contact;

  return (
    <div className="space-y-8">
      {hasAnyBreakdown && (
        <div className="dash-fade-up" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-5 w-5 text-gray-400" />
            <h2 className="erp-section-title">Content Snapshot</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {breakdown.gallery && <GalleryBreakdown data={breakdown.gallery} />}
            {breakdown.articles && (
              <ArticlesBreakdown data={breakdown.articles} />
            )}
            {breakdown.siteMedia && (
              <SiteMediaBreakdown data={breakdown.siteMedia} />
            )}
            {breakdown.disclosure && (
              <DisclosureBreakdown data={breakdown.disclosure} />
            )}
            {breakdown.transferCertificates && (
              <TcBreakdown data={breakdown.transferCertificates} />
            )}
            {breakdown.contact && <ContactBreakdown data={breakdown.contact} />}
          </div>
        </div>
      )}

      <div
        className={cn(
          "grid gap-6",
          hasContact ? "grid-cols-1 lg:grid-cols-5" : "grid-cols-1"
        )}
      >
        <div
          className={cn(
            "dash-fade-up",
            hasContact ? "lg:col-span-3" : "col-span-1"
          )}
          style={{ animationDelay: "180ms" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-gray-400" />
            <h2 className="erp-section-title">Recent Activity</h2>
          </div>
          <ActivityFeed items={recentActivity} />
        </div>

        {hasContact && (
          <div
            className="dash-fade-up lg:col-span-2"
            style={{ animationDelay: "240ms" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-gray-400" />
                <h2 className="erp-section-title">Latest Messages</h2>
              </div>
              <Link
                href="/contact"
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors group"
              >
                View all
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
            <MessagesPreview items={recentMessages} />
          </div>
        )}
      </div>
    </div>
  );
}
