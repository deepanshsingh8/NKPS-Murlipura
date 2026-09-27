"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, NotebookPen, Wallet, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@nkps/shared/components/ui/button";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { todayISO } from "@nkps/shared/lib/date";
import { cn } from "@nkps/shared/lib/utils";
import {
  KIND_META,
  KIND_ORDER,
  PostCard,
  dayHeading,
  type DiaryKind,
  type DiaryPost,
  type DiaryResponse,
} from "./shared";

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * The reading side of the Class Diary, for parents (/parent/diary) and
 * students (/student/diary): what the class WhatsApp group used to carry,
 * scoped to the child's own class. Opening the page marks what is on screen
 * as read, which is what the teacher's "Seen by" counts.
 */
export function DiaryFeed({ audience }: { audience: "parent" | "student" }) {
  const [kind, setKind] = useState<DiaryKind | "">("");
  const [classId, setClassId] = useState("");
  const [data, setData] = useState<DiaryResponse | null>(null);
  const [posts, setPosts] = useState<DiaryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const markRead = useCallback(async (list: DiaryPost[]) => {
    const ids = list.filter((p) => p.is_read === false).map((p) => p.id);
    if (ids.length === 0) return;
    // Fire and forget: a failed receipt must never get in the way of reading.
    adminFetch("/api/class-diary/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_ids: ids.slice(0, 100) }),
    }).catch(() => {});
  }, []);

  const load = useCallback(
    async (offset = 0) => {
      const qs = new URLSearchParams();
      if (kind) qs.set("kind", kind);
      if (classId) qs.set("class_id", classId);
      if (offset) qs.set("offset", String(offset));
      const res = await adminFetch(`/api/class-diary?${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not load the diary");
        return;
      }
      const page = json as DiaryResponse;
      if (offset === 0) {
        setData(page);
        setPosts(page.posts);
      } else {
        setData((prev) =>
          prev ? { ...prev, has_more: page.has_more, next_offset: page.next_offset } : page
        );
        setPosts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.posts.filter((p) => !seen.has(p.id))];
        });
      }
      markRead(page.posts);
    },
    [kind, classId, markRead]
  );

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const groups = useMemo(() => {
    const pinned = posts.filter((p) => p.is_pinned);
    const byDay = new Map<string, DiaryPost[]>();
    for (const p of posts.filter((x) => !x.is_pinned)) {
      const list = byDay.get(p.post_date) ?? [];
      list.push(p);
      byDay.set(p.post_date, list);
    }
    return { pinned, days: [...byDay.entries()] };
  }, [posts]);

  const today = todayISO();
  const classes = data?.classes ?? [];
  const dues = data?.dues ?? [];
  const feesHref = audience === "parent" ? "/parent/fees" : "/student/fees";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Class Diary
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Homework, notices, fee reminders and photos from school.
        </p>
      </div>

      {dues.length > 0 && (
        <Link
          href={feesHref}
          className="flex items-center gap-3 rounded-2xl border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-4 text-amber-900 dark:text-amber-200"
        >
          <Wallet className="h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Fees pending</p>
            <p className="text-sm">
              {dues
                .map((d) =>
                  audience === "parent"
                    ? `${d.name.split(/\s+/)[0]}: ${rupees.format(d.total)}`
                    : rupees.format(d.total)
                )
                .join(" · ")}
            </p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </Link>
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {(["", ...KIND_ORDER] as const).map((k) => {
          const active = kind === k;
          return (
            <button
              key={k || "all"}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={active}
              className={cn(
                "inline-flex min-h-11 sm:min-h-9 shrink-0 items-center rounded-full border px-4 text-sm transition-colors",
                active
                  ? "border-navy-900 bg-navy-900 text-white dark:border-gold-500 dark:bg-gold-500 dark:text-navy-900"
                  : "border-gray-200 dark:border-border bg-white dark:bg-card text-gray-700 dark:text-gray-300"
              )}
            >
              {k ? KIND_META[k].plural : "All"}
            </button>
          );
        })}
      </div>

      {classes.length > 1 && (
        <NativeSelect
          aria-label="Class"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          className="w-full sm:w-64"
        >
          <option value="">All my children&apos;s classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-border p-10 text-center">
          <NotebookPen className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 font-medium text-navy-900 dark:text-white">Nothing here yet</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {classes.length === 0
              ? "No class is linked to this account for the current session. Please contact the school office."
              : "Homework and notices from the class teacher will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.pinned.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Pinned
              </h2>
              {groups.pinned.map((p) => (
                <PostCard key={p.id} post={p} showClass={classes.length > 1 || !p.class_id} />
              ))}
            </section>
          )}
          {groups.days.map(([day, list]) => (
            <section key={day} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                {dayHeading(day, today)}
              </h2>
              {list.map((p) => (
                <PostCard key={p.id} post={p} showClass={classes.length > 1 || !p.class_id} />
              ))}
            </section>
          ))}
          {data?.has_more && data.next_offset !== null && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  await load(data.next_offset ?? 0);
                  setLoadingMore(false);
                }}
              >
                {loadingMore && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Show older posts
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
