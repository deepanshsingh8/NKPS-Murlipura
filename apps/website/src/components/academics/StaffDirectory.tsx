"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Users, Loader2 } from "lucide-react";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { STAFF } from "@nkps/shared/lib/constants";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { cn } from "@nkps/shared/lib/utils";
import type { StaffMember } from "@nkps/shared/types";

const PUBLIC_CATEGORIES = ["management", "pgt", "tgt", "prt", "motherTeachers", "admin"] as const;

const tabs = [
  { label: "Management", key: "management" as const },
  { label: "PGT", key: "pgt" as const },
  { label: "TGT", key: "tgt" as const },
  { label: "PRT", key: "prt" as const },
  { label: "Mother Teachers", key: "motherTeachers" as const },
  { label: "Administrative Staff", key: "admin" as const },
];

type TabKey = (typeof tabs)[number]["key"];

// Deterministic avatar colors based on name hash
const AVATAR_COLORS = [
  "from-navy-800 to-navy-900",
  "from-blue-500 to-blue-700",
  "from-gold-500 to-gold-600",
  "from-emerald-500 to-emerald-700",
  "from-violet-500 to-violet-700",
  "from-rose-500 to-rose-700",
  "from-cyan-500 to-cyan-700",
  "from-amber-500 to-amber-700",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      delay: i * 0.05,
      ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
    },
  }),
  exit: { opacity: 0, y: -12, scale: 0.98, transition: { duration: 0.2 } },
};

export function StaffDirectory() {
  const [activeTab, setActiveTab] = useState<TabKey>("management");
  const [search, setSearch] = useState("");
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [dbStaff, setDbStaff] = useState<Record<string, StaffMember[]> | null>(null);
  const [dbLoading, setDbLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("staff_members")
          .select("*")
          .eq("is_active", true)
          .in("category", PUBLIC_CATEGORIES as unknown as string[])
          .order("sort_order")
          .order("name");

        if (cancelled) return;

        if (!error && data && data.length > 0) {
          const grouped: Record<string, StaffMember[]> = {};
          for (const member of data as StaffMember[]) {
            if (!grouped[member.category]) grouped[member.category] = [];
            grouped[member.category].push(member);
          }
          setDbStaff(grouped);
        }
      } catch {
        // Silently fall back to constants
      } finally {
        if (!cancelled) setDbLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Use DB data if available, otherwise fall back to constants
  const getStaffForTab = (key: TabKey): Array<{ name: string; subject: string; photo_url?: string | null }> => {
    if (dbStaff) {
      return dbStaff[key] ?? [];
    }
    // Fallback to constants
    const fallback = STAFF[key as keyof typeof STAFF];
    return fallback ? [...fallback] : [];
  };

  const getCount = (key: TabKey): number => {
    if (dbStaff) return dbStaff[key]?.length ?? 0;
    const fallback = STAFF[key as keyof typeof STAFF];
    return fallback?.length ?? 0;
  };

  const staffData = getStaffForTab(activeTab);
  const filtered = staffData.filter((member) =>
    member.name.toLowerCase().includes(search.toLowerCase())
  );

  // Sliding indicator position
  useEffect(() => {
    const el = tabRefs.current.get(activeTab);
    if (el) {
      const parent = el.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        setIndicatorStyle({
          left: elRect.left - parentRect.left,
          width: elRect.width,
        });
      }
    }
  }, [activeTab]);

  return (
    <section className="section-padding">
      <div className="page-container">
        <SectionHeading
          title="Our Faculty"
          subtitle="Meet our dedicated team of educators committed to academic excellence"
          light
        />

        {/* Premium pill tabs with sliding indicator */}
        <div className="flex justify-center mt-10 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-4">
          <div className="relative inline-flex items-center gap-1 rounded-full bg-white/[0.04] p-1.5 shadow-sm border border-chalk/20 shrink-0">
            {/* Sliding indicator */}
            <motion.div
              className="absolute top-1.5 bottom-1.5 rounded-full bg-navy-900"
              animate={{
                left: indicatorStyle.left,
                width: indicatorStyle.width,
              }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
            />

            {tabs.map((tab) => (
              <button
                key={tab.key}
                ref={(el) => {
                  if (el) tabRefs.current.set(tab.key, el);
                }}
                onClick={() => {
                  setActiveTab(tab.key);
                  setSearch("");
                }}
                className={cn(
                  "relative z-10 flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors duration-200",
                  activeTab === tab.key
                    ? "text-white"
                    : "text-chalk-dim hover:text-chalk"
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "inline-flex items-center justify-center min-w-[1.375rem] h-[1.375rem] px-1.5 rounded-full text-xs font-semibold transition-colors duration-200",
                    activeTab === tab.key
                      ? "bg-white/20 text-white"
                      : "bg-white/10 text-chalk-dim"
                  )}
                >
                  {getCount(tab.key)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Polished search */}
        <div className="max-w-md mx-auto mt-8 relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-chalk-faint group-focus-within:text-gold-500 transition-colors" />
          <input
            type="text"
            placeholder="Search faculty by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 rounded-xl border border-chalk/20 bg-white/[0.06] text-sm text-chalk placeholder:text-chalk-faint focus:outline-none focus:ring-2 focus:ring-gold-500/20 focus:border-gold-500 shadow-sm transition-all"
          />
        </div>

        {/* Card grid */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab + search}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-10"
          >
            {filtered.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-16 text-chalk-faint"
              >
                <Users className="w-10 h-10 mb-3 text-chalk-faint" />
                <p className="text-sm font-medium">No faculty members found</p>
                <p className="text-xs mt-1">Try adjusting your search</p>
              </motion.div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filtered.map((member, index) => (
                  <motion.div
                    key={member.name}
                    custom={index}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="group/card relative bg-white/[0.04] rounded-2xl border border-chalk/20 p-5 transition-all duration-300 hover:shadow-lg hover:border-gold-500/40 hover:-translate-y-0.5"
                  >
                    {/* Subtle top accent line */}
                    <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-gold-500/40 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300" />

                    {/* Avatar */}
                    {member.photo_url ? (
                      <div className="w-12 h-12 rounded-full overflow-hidden mb-3.5 shadow-[0_14px_28px_-14px_rgba(0,0,0,0.55)] ring-1 ring-chalk/20 relative">
                        <Image
                          src={member.photo_url}
                          alt={member.name}
                          fill
                          className="object-cover"
                          sizes="48px"
                        />
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center mb-3.5 shadow-sm",
                          getAvatarColor(member.name)
                        )}
                      >
                        <span className="text-sm font-bold text-white leading-none">
                          {getInitials(member.name)}
                        </span>
                      </div>
                    )}

                    {/* Info */}
                    <h3 className="text-sm font-semibold text-chalk leading-snug">
                      {member.name}
                    </h3>
                    <p className="text-xs text-chalk-dim mt-1 leading-relaxed">
                      {member.subject}
                    </p>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Subtle member count */}
        <div className="mt-6 text-center">
          <p className="text-xs text-chalk-faint">
            {dbLoading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </span>
            ) : (
              `Showing ${filtered.length} of ${staffData.length} faculty members`
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
