"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Image as ImageIcon,
  FileText,
  MessageSquare,
  Users,
  GraduationCap,
  TrendingUp,
  Calendar,
  ArrowRight,
  ClipboardCheck,
  UserCog,
  Sparkles,
} from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { cn } from "@nkps/shared/lib/utils";
import { Badge } from "@nkps/shared/components/ui/badge";
import { DashboardAnalytics } from "@nkps/shared/components/DashboardAnalytics";
import {
  CmsContentInsights,
  type CmsInsightsData,
} from "@nkps/shared/components/CmsContentInsights";
import { EVENT_TYPE_LABELS, EVENT_TYPE_COLORS } from "@nkps/shared/lib/constants/calendar";
import type { CalendarEventType } from "@nkps/shared/types";

type Scope = "cms" | "erp";

// Server returns only the stat keys this caller is allowed to see.
interface Stats {
  galleryCount?: number;
  tcCount?: number;
  unreadCount?: number;
  totalUsers?: number;
  totalStudents?: number;
  totalStaff?: number;
  pendingRegistrations?: number;
}

interface UpcomingEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: CalendarEventType;
  start_date: string;
  end_date: string | null;
}

const cmsStatCards = [
  {
    key: "galleryCount" as const,
    label: "Gallery Images",
    icon: ImageIcon,
    iconBg: "bg-amber-100 dark:bg-amber-900/30",
    iconColor: "text-amber-600",
    accent: "from-amber-500/10 to-transparent",
    href: "/gallery",
  },
  {
    key: "tcCount" as const,
    label: "Transfer Certificates",
    icon: FileText,
    iconBg: "bg-gold-300/30 dark:bg-gold-500/20",
    iconColor: "text-gold-600",
    accent: "from-gold-500/10 to-transparent",
    href: "/transfer-certificates",
  },
  {
    key: "unreadCount" as const,
    label: "Unread Messages",
    icon: MessageSquare,
    iconBg: "bg-rose-100 dark:bg-rose-900/30",
    iconColor: "text-rose-600",
    accent: "from-rose-500/10 to-transparent",
    href: "/contact",
  },
];

const erpStatCards = [
  {
    key: "totalUsers" as const,
    label: "Total Users",
    icon: Users,
    iconBg: "bg-violet-100 dark:bg-violet-900/30",
    iconColor: "text-violet-600",
    accent: "from-violet-500/10 to-transparent",
    href: "/people/users",
  },
  {
    key: "totalStudents" as const,
    label: "Students",
    icon: GraduationCap,
    iconBg: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-600",
    accent: "from-blue-500/10 to-transparent",
    href: "/people/students",
  },
  {
    key: "totalStaff" as const,
    label: "Staff",
    icon: UserCog,
    iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
    iconColor: "text-emerald-600",
    accent: "from-emerald-500/10 to-transparent",
    href: "/people/staff",
  },
  {
    key: "pendingRegistrations" as const,
    label: "Pending Registrations",
    icon: ClipboardCheck,
    iconBg: "bg-orange-100 dark:bg-orange-900/30",
    iconColor: "text-orange-600",
    accent: "from-orange-500/10 to-transparent",
    href: "/registrations",
  },
];

function getGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

// Capitalize the first character; leave the rest as the user typed it so
// names like "deepansh" don't get mangled into "Deepansh" + lowercased middle
// (we only want the leading letter uppercased).
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Derive a display name from the auth profile. Returns the full name (first
// + last, space-separated) when set. The Supabase signup trigger falls back
// full_name → email when no name was provided on signup, so a lot of
// accounts have an email-shaped full_name. In that case, derive a name from
// the email's local part — splitting on `.`/`_`/`-` so "john.doe" becomes
// "John Doe" instead of one mashed token.
function displayName(fullName: string | null, email: string | null): string {
  const trimmedName = fullName?.trim();
  if (trimmedName && !trimmedName.includes("@")) {
    return trimmedName.split(/\s+/).filter(Boolean).join(" ");
  }
  const source = trimmedName?.includes("@") ? trimmedName : email?.trim();
  if (!source) return "";
  const local = source.split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.replace(/\d+$/, ""))
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useCountUp(target: number, durationMs = 900) {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [display, setDisplay] = useState(() =>
    prefersReducedMotion() ? safeTarget : 0
  );
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (safeTarget === 0 || prefersReducedMotion()) return;

    const start = performance.now();
    const tick = (t: number) => {
      const progress = Math.min((t - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * safeTarget));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [safeTarget, durationMs]);

  return display;
}

function CountUp({ value }: { value: number }) {
  const display = useCountUp(value);
  return <>{display.toLocaleString("en-IN")}</>;
}

function getEventCountdown(startDate: string): { label: string; tone: "now" | "soon" | "later" } {
  const target = new Date(startDate + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff <= 0) return { label: "Today", tone: "now" };
  if (diff === 1) return { label: "Tomorrow", tone: "soon" };
  if (diff < 7) return { label: `in ${diff} days`, tone: "soon" };
  if (diff < 14) return { label: "Next week", tone: "later" };
  if (diff < 31) return { label: `in ${Math.round(diff / 7)} weeks`, tone: "later" };
  return { label: `in ${Math.round(diff / 30)} mo`, tone: "later" };
}

const COUNTDOWN_TONES = {
  now: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  soon: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  later: "bg-gray-100 text-gray-600 dark:bg-muted/50 dark:text-gray-400",
} as const;

export function DashboardView({ scope }: { scope: Scope }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [canSeeEvents, setCanSeeEvents] = useState(false);
  const [cmsInsights, setCmsInsights] = useState<CmsInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Each app exposes /api/dashboard at its root (returns module-specific
        // counts). Scope still determines which stat cards render below.
        const res = await adminFetch("/api/dashboard");
        const data = await res.json();
        if (res.ok) {
          setStats(data.stats);
          setUpcomingEvents(data.upcomingEvents ?? []);
          setCanSeeEvents(!!data.canSeeEvents);
          setCmsInsights(data.cmsInsights ?? null);
        }
      } catch {
        // Silently fail — dashboard will show empty state
      } finally {
        setLoading(false);
      }
    };

    const fetchUser = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        if (user.email) setUserEmail(user.email);
        const { data } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .single();
        if (data?.full_name) setUserName(data.full_name);
      } catch {
        // Silent fail.
      }
    };

    fetchData();
    fetchUser();
  }, []);

  const formatEventDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return {
      day: d.getDate(),
      month: d.toLocaleDateString("en-IN", { month: "short" }),
    };
  };

  const greeting = getGreeting();
  const todayLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const name = displayName(userName, userEmail);

  const cardConfig = scope === "cms" ? cmsStatCards : erpStatCards;
  const visibleCards = cardConfig.filter(
    ({ key }) => loading || stats?.[key] !== undefined
  );

  const showAnalytics = scope === "erp";
  const showEvents = scope === "erp";
  const showCmsInsights = scope === "cms";
  const eventsHref = "/calendar";
  const moduleLabel = scope === "cms" ? "Content" : "School operations";

  return (
    <div className="space-y-8">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-border bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 dash-fade-up">
        <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-gold-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-blue-500/15 blur-3xl" />

        <div className="relative px-6 py-7 md:px-8 md:py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-gold-300/90 mb-2">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-[0.18em]">
                  {todayLabel}
                </span>
              </div>
              <h1 className="font-heading text-2xl md:text-3xl font-bold text-white tracking-tight">
                {greeting}
                {name && (
                  <>
                    , <span className="text-gold-400">{name}</span>
                  </>
                )}
              </h1>
              <p className="text-sm text-white/60 mt-1.5">
                {`${moduleLabel} dashboard — here's the overview.`}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 backdrop-blur-sm">
              <div className="h-8 w-8 rounded-lg bg-gold-500/20 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-gold-300" />
              </div>
              <div className="leading-tight">
                <p className="text-[10px] uppercase tracking-wider text-white/50">
                  {scope === "cms" ? "CMS" : "ERP"}
                </p>
                <p className="text-xs font-semibold text-white">
                  Live overview
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {visibleCards.map(
          ({ key, label, icon: Icon, iconBg, iconColor, accent, href }, i) => {
            const value = stats?.[key];
            const cardInner = (
              <>
                <div
                  className={cn(
                    "absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl rounded-bl-full opacity-60 transition-opacity duration-300 group-hover:opacity-90",
                    accent
                  )}
                />
                <div className="relative flex items-center gap-4">
                  <div
                    className={cn(
                      "h-12 w-12 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3",
                      iconBg
                    )}
                  >
                    <Icon className={cn("h-5.5 w-5.5", iconColor)} />
                  </div>
                  <div className="min-w-0">
                    {loading ? (
                      <div className="h-8 w-16 bg-gray-100 dark:bg-muted rounded-lg animate-pulse" />
                    ) : (
                      <p className="text-3xl font-bold text-navy-900 dark:text-white tracking-tight tabular-nums">
                        <CountUp value={value ?? 0} />
                      </p>
                    )}
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {label}
                    </p>
                  </div>
                </div>
                {!loading && (
                  <div className="absolute bottom-3 right-4 flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500 opacity-0 translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
                    View
                    <ArrowRight className="h-3 w-3" />
                  </div>
                )}
              </>
            );

            const baseClass = cn(
              "erp-stat-card relative overflow-hidden group dash-fade-up",
              !loading && "hover:border-gray-300/90 dark:hover:border-border"
            );
            const baseStyle = { animationDelay: `${i * 60}ms` };

            return loading || !href ? (
              <div key={key} className={baseClass} style={baseStyle}>
                {cardInner}
              </div>
            ) : (
              <Link
                key={key}
                href={href}
                className={cn(
                  baseClass,
                  "block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2"
                )}
                style={baseStyle}
              >
                {cardInner}
              </Link>
            );
          }
        )}
      </div>

      {showAnalytics && (
        <div className="dash-fade-up" style={{ animationDelay: "180ms" }}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-gray-400" />
            <h2 className="erp-section-title">Analytics</h2>
          </div>
          <DashboardAnalytics />
        </div>
      )}

      {showCmsInsights && (
        <CmsContentInsights data={cmsInsights} loading={loading} />
      )}

      {showEvents && (loading || canSeeEvents) && (
        <div className="dash-fade-up" style={{ animationDelay: "240ms" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-gray-400" />
              <h2 className="erp-section-title">Upcoming Events</h2>
            </div>
            <Link
              href={eventsHref}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors group"
            >
              View All
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-card rounded-xl border border-gray-200/80 dark:border-border p-4 animate-pulse"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 bg-gray-100 dark:bg-muted rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-40 bg-gray-100 dark:bg-muted rounded" />
                      <div className="h-3 w-24 bg-gray-50 dark:bg-muted rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : upcomingEvents.length === 0 ? (
            <div className="erp-empty-state bg-white dark:bg-card rounded-2xl border border-gray-200/80 dark:border-border">
              <Calendar className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm text-gray-400">No upcoming events scheduled</p>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.map((evt, i) => {
                const { day, month } = formatEventDate(evt.start_date);
                const countdown = getEventCountdown(evt.start_date);
                return (
                  <Link
                    key={evt.id}
                    href={eventsHref}
                    className="block bg-white dark:bg-card rounded-xl border border-gray-200/80 dark:border-border p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-blue-300/60 dark:hover:border-border group dash-fade-up"
                    style={{ animationDelay: `${280 + i * 50}ms` }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-navy-900/5 dark:bg-white/5 flex flex-col items-center justify-center shrink-0 transition-colors group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20">
                        <span className="text-lg font-bold leading-none text-navy-900 dark:text-white">
                          {day}
                        </span>
                        <span className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 mt-0.5">
                          {month}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className="font-semibold text-navy-900 dark:text-white text-sm truncate">
                            {evt.title}
                          </p>
                          <Badge
                            className={cn(
                              "text-[10px] px-1.5 py-0 shrink-0",
                              EVENT_TYPE_COLORS[evt.event_type] ??
                                EVENT_TYPE_COLORS.other
                            )}
                          >
                            {EVENT_TYPE_LABELS[evt.event_type] ?? evt.event_type}
                          </Badge>
                          <span
                            className={cn(
                              "text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0",
                              COUNTDOWN_TONES[countdown.tone]
                            )}
                          >
                            {countdown.label}
                          </span>
                        </div>
                        {evt.description && (
                          <p className="text-xs text-gray-400 truncate">
                            {evt.description}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 text-gray-300 shrink-0 transition-all duration-200 group-hover:text-blue-500 group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
