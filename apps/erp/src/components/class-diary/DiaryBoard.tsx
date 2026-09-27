"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@nkps/shared/components/ui/button";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { todayISO } from "@nkps/shared/lib/date";
import { DiaryComposer } from "./DiaryComposer";
import {
  KIND_META,
  KIND_ORDER,
  PostCard,
  dayHeading,
  type DiaryPost,
  type DiaryResponse,
} from "./shared";

/**
 * The posting side of the Class Diary — used by the office at /class-diary
 * (every class, plus school-wide) and by teachers at /teacher/class-diary
 * (their own classes). The API decides the scope; this renders what it gets.
 */
export function DiaryBoard({ audience }: { audience: "office" | "teacher" }) {
  const [classFilter, setClassFilter] = useUrlState("class_id");
  const [kindFilter, setKindFilter] = useUrlState("kind");
  const [data, setData] = useState<DiaryResponse | null>(null);
  const [posts, setPosts] = useState<DiaryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<DiaryPost | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      const qs = new URLSearchParams();
      if (classFilter) qs.set("class_id", classFilter);
      if (kindFilter) qs.set("kind", kindFilter);
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
        setData((prev) => (prev ? { ...prev, has_more: page.has_more, next_offset: page.next_offset } : page));
        setPosts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.posts.filter((p) => !seen.has(p.id))];
        });
      }
    },
    [classFilter, kindFilter]
  );

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onDelete = async (post: DiaryPost) => {
    if (!confirm(`Delete "${post.title}"? Families will no longer see it.`)) return;
    const res = await adminFetch(`/api/class-diary/${post.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not delete");
      return;
    }
    toast.success("Deleted");
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
  };

  // Pinned posts first, then by day.
  const groups = useMemo(() => {
    const pinned = posts.filter((p) => p.is_pinned);
    const rest = posts.filter((p) => !p.is_pinned);
    const byDay = new Map<string, DiaryPost[]>();
    for (const p of rest) {
      const list = byDay.get(p.post_date) ?? [];
      list.push(p);
      byDay.set(p.post_date, list);
    }
    return { pinned, days: [...byDay.entries()] };
  }, [posts]);

  const classes = data?.classes ?? [];
  const today = todayISO();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Class Diary
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {audience === "teacher"
              ? "Homework, notices and photos for your classes — families see them in their portal."
              : "Homework, notices, fee reminders and photos for every class, or the whole school."}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setComposerOpen(true);
          }}
          disabled={!data || (classes.length === 0 && !data.can_post_school_wide)}
          className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900 shadow-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Post
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <NativeSelect
          aria-label="Class"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="w-full sm:w-56"
        >
          <option value="">All classes</option>
          {data?.can_post_school_wide && <option value="school">Whole-school posts</option>}
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Type"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="w-full sm:w-56"
        >
          <option value="">All types</option>
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KIND_META[k].plural}
            </option>
          ))}
        </NativeSelect>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-border p-10 text-center">
          <NotebookPen className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 font-medium text-navy-900 dark:text-white">Nothing posted yet</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {audience === "teacher" && classes.length === 0
              ? "You are not assigned to a class this session. Ask the office to add you as class teacher or subject teacher."
              : 'Use "New Post" to send today\'s homework or a notice.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.pinned.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pinned</h2>
              {groups.pinned.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  showClass
                  onEdit={(post) => {
                    setEditing(post);
                    setComposerOpen(true);
                  }}
                  onDelete={onDelete}
                />
              ))}
            </section>
          )}
          {groups.days.map(([day, list]) => (
            <section key={day} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                {dayHeading(day, today)}
              </h2>
              {list.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  showClass
                  onEdit={(post) => {
                    setEditing(post);
                    setComposerOpen(true);
                  }}
                  onDelete={onDelete}
                />
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
                Load older posts
              </Button>
            </div>
          )}
        </div>
      )}

      <DiaryComposer
        open={composerOpen}
        onOpenChange={(o) => {
          setComposerOpen(o);
          if (!o) setEditing(null);
        }}
        classes={classes}
        subjectsByClass={data?.subjects_by_class ?? {}}
        canPostSchoolWide={!!data?.can_post_school_wide}
        defaultClassId={classFilter && classFilter !== "school" ? classFilter : null}
        editing={editing}
        onSaved={() => load()}
      />
    </div>
  );
}
