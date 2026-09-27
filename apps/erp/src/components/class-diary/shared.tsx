"use client";

import {
  BookOpen,
  CalendarDays,
  Megaphone,
  Wallet,
  Images,
  FileText,
  Pencil,
  Trash2,
  Pin,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Button } from "@nkps/shared/components/ui/button";
import { categoricalChip } from "@nkps/shared/lib/palette";
import { cn } from "@nkps/shared/lib/utils";

// Shared by the office/teacher board and the family feed. Shapes mirror the
// GET /api/class-diary response.

export type DiaryKind =
  | "homework"
  | "holiday_homework"
  | "notice"
  | "fee_reminder"
  | "photos";

export interface DiaryAttachmentView {
  path: string;
  name: string;
  type: string;
  size: number;
  url: string | null;
}

export interface DiaryPost {
  id: string;
  class_id: string | null;
  class_label: string | null;
  subject_id: string | null;
  subject_name: string | null;
  kind: DiaryKind;
  title: string;
  body: string;
  post_date: string;
  due_date: string | null;
  attachments: DiaryAttachmentView[];
  is_pinned: boolean;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  seen_count: number | null;
  is_read: boolean | null;
  for_children: string[];
}

export interface DiaryResponse {
  viewer: "staff" | "teacher" | "parent" | "student";
  can_post_school_wide: boolean;
  subjects_by_class: Record<string, { id: string; name: string }[]>;
  classes: { id: string; label: string }[];
  posts: DiaryPost[];
  has_more: boolean;
  next_offset: number | null;
  dues: { student_id: string; name: string; total: number }[];
}

export const KIND_META: Record<
  DiaryKind,
  { label: string; plural: string; icon: LucideIcon; chip: string }
> = {
  // Categorical, not status: a notice is not "information-blue" and a fee
  // reminder is not a warning — they are kinds of post. Fixed indexes so each
  // kind keeps its colour everywhere.
  homework: { label: "Homework", plural: "Homework", icon: BookOpen, chip: categoricalChip(0) },
  holiday_homework: {
    label: "Holiday Homework",
    plural: "Holiday Homework",
    icon: CalendarDays,
    chip: categoricalChip(4),
  },
  notice: { label: "Notice", plural: "Notices", icon: Megaphone, chip: categoricalChip(1) },
  fee_reminder: { label: "Fee Reminder", plural: "Fee Reminders", icon: Wallet, chip: categoricalChip(3) },
  photos: { label: "Photos", plural: "Photos", icon: Images, chip: categoricalChip(6) },
};

export const KIND_ORDER: DiaryKind[] = [
  "homework",
  "holiday_homework",
  "notice",
  "fee_reminder",
  "photos",
];

export function formatDiaryDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "Today", "Yesterday", or the date — for the day headings in a feed. */
export function dayHeading(iso: string, today: string): string {
  if (iso === today) return "Today";
  const y = new Date(`${today}T00:00:00`);
  y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(
    y.getDate()
  ).padStart(2, "0")}`;
  if (iso === yesterday) return "Yesterday";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function isImage(a: DiaryAttachmentView) {
  return a.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(a.path);
}

export function PostCard({
  post,
  showClass,
  onEdit,
  onDelete,
}: {
  post: DiaryPost;
  showClass: boolean;
  onEdit?: (post: DiaryPost) => void;
  onDelete?: (post: DiaryPost) => void;
}) {
  const meta = KIND_META[post.kind];
  const Icon = meta.icon;
  const images = post.attachments.filter(isImage);
  const files = post.attachments.filter((a) => !isImage(a));
  const unread = post.is_read === false;

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white dark:bg-card p-4 sm:p-5 shadow-sm",
        unread
          ? "border-gold-500/60 ring-1 ring-gold-500/30"
          : "border-gray-200 dark:border-border"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className={cn("gap-1", meta.chip)}>
          <Icon className="h-3.5 w-3.5" />
          {meta.label}
        </Badge>
        {showClass && (
          <Badge variant="outline" className="font-medium">
            {post.class_label ?? "Whole school"}
          </Badge>
        )}
        {post.for_children.length > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            for {post.for_children.join(", ")}
          </span>
        )}
        {post.subject_name && (
          <span className="text-xs font-medium text-navy-700 dark:text-navy-200">
            {post.subject_name}
          </span>
        )}
        {post.is_pinned && (
          <Pin className="h-3.5 w-3.5 text-gold-600 dark:text-gold-400" aria-label="Pinned" />
        )}
        {unread && (
          <Badge className="ml-auto bg-gold-500 text-navy-900 hover:bg-gold-500">New</Badge>
        )}
      </div>

      <h3 className="mt-3 font-heading text-lg font-semibold text-navy-900 dark:text-white break-words">
        {post.title}
      </h3>
      {post.body && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
          {post.body}
        </p>
      )}

      {post.due_date && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 text-sm font-medium text-amber-800 dark:text-amber-300">
          <CalendarDays className="h-4 w-4" />
          Due {formatDiaryDate(post.due_date)}
        </p>
      )}

      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"> {/* mobile-layout-ok: photo thumbnails, not form fields */}
          {images.map((a) =>
            a.url ? (
              <a
                key={a.path}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square overflow-hidden rounded-xl bg-gray-100 dark:bg-muted"
              >
                {/* Signed, short-lived URLs from a private bucket — not something
                    next/image can optimise or cache usefully. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt={a.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                />
              </a>
            ) : null
          )}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((a) => (
            <li key={a.path}>
              <a
                href={a.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 dark:border-border px-3 py-2 text-sm text-navy-900 dark:text-white hover:bg-gray-50 dark:hover:bg-muted"
              >
                <FileText className="h-4 w-4 shrink-0 text-gray-500" />
                <span className="truncate">{a.name}</span>
                <span className="ml-auto shrink-0 text-xs text-gray-400">
                  {(a.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span>
          {post.author_name ?? "School"} · {formatDiaryDate(post.post_date)}
        </span>
        {post.seen_count !== null && (
          <span className="inline-flex items-center gap-1" title="Parents and students who have opened it">
            <CheckCheck className="h-3.5 w-3.5" />
            Seen by {post.seen_count}
          </span>
        )}
        {post.can_edit && (onEdit || onDelete) && (
          <span className="ml-auto flex gap-1">
            {onEdit && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onEdit(post)}
                aria-label={`Edit "${post.title}"`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(post)}
                aria-label={`Delete "${post.title}"`}
                className="text-red-600 hover:text-red-700 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </span>
        )}
      </div>
    </article>
  );
}
