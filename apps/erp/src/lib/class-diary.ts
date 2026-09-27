// Class Diary — who may read and write which class's posts.
//
// Replaces the per-class WhatsApp groups: daily homework, holiday homework,
// notices, fee reminders and function photos, posted to a class and read by
// the families of the children enrolled in it (migration 903).
//
// Every /api/class-diary route resolves its caller here and nowhere else.
// Scope is derived in TypeScript from the roster, with the service-role
// client, for the same reason verify-portal.ts gives: the SQL helpers resolve
// through auth.uid(), which is NULL under the service role, so a mistake there
// returns a silently empty set rather than an error. The RLS policies in 903
// mirror this scope as a second line, not the first.

import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { verifyPortalUser } from "@nkps/shared/lib/verify-portal";
import { getTeacherClassIds } from "@/lib/teacher-scope";

export const DIARY_BUCKET = "class-diary";

/** Signed download links live this long; the feed re-mints on every load. */
export const DIARY_URL_TTL_SECONDS = 60 * 60;

export const DIARY_KINDS = [
  "homework",
  "holiday_homework",
  "notice",
  "fee_reminder",
  "photos",
] as const;
export type DiaryKind = (typeof DIARY_KINDS)[number];

export const DIARY_MAX_ATTACHMENTS = 10;

/** Extension → content type the bucket accepts (migration 903). */
export const DIARY_FILE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
};

type Admin = ReturnType<typeof createAdminClient>;

interface CallerBase {
  admin: Admin;
  userId: string;
  name: string;
}

/** Admin, or staff/teacher granted the class_diary feature: every class. */
export interface StaffCaller extends CallerBase {
  kind: "staff";
}

/** A teacher without the grant: the classes they teach or class-teach. */
export interface TeacherCaller extends CallerBase {
  kind: "teacher";
  teacherId: string;
  classIds: string[];
}

/** A parent or student: the classes their children are enrolled in now. */
export interface PortalCaller extends CallerBase {
  kind: "portal";
  role: "parent" | "student";
  studentIds: string[];
  classIds: string[];
  /** class_id → first names of the caller's children in it (parents only). */
  childrenByClass: Record<string, string[]>;
}

export type DiaryCaller = StaffCaller | TeacherCaller | PortalCaller;

function readBearerToken(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

export async function currentAcademicYearId(admin: Admin): Promise<string | null> {
  const { data } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Who is calling, and what they may see. `null` means unauthenticated or no
 * role here — respond 401. Fails closed on must_change_password, like every
 * other gate in the app.
 */
export async function resolveDiaryCaller(): Promise<DiaryCaller | null> {
  const headersList = await headers();
  const token = readBearerToken(headersList.get("authorization"));
  if (!token) return null;

  const admin = createAdminClient();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const [{ data: profile }, { data: grant }] = await Promise.all([
    admin
      .from("profiles")
      .select("role, full_name, must_change_password, teacher_id")
      .eq("id", user.id)
      .single(),
    admin
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "class_diary")
      .maybeSingle(),
  ]);
  if (!profile || profile.must_change_password) return null;

  const role = profile.role as string;
  const name = (profile.full_name as string | null) ?? "School";

  if (role === "admin" || ((role === "staff" || role === "teacher") && grant)) {
    return { kind: "staff", admin, userId: user.id, name };
  }

  if (role === "teacher") {
    const teacherId = profile.teacher_id as string | null;
    if (!teacherId) return null;
    const classIds = await getTeacherClassIds(admin, teacherId);
    return { kind: "teacher", admin, userId: user.id, name, teacherId, classIds };
  }

  if (role === "parent" || role === "student") {
    const portal = await verifyPortalUser();
    if (!portal || portal.userId !== user.id) return null;

    const yearId = await currentAcademicYearId(admin);
    const childrenByClass: Record<string, string[]> = {};
    if (yearId && portal.studentIds.length > 0) {
      const { data: rows } = await admin
        .from("student_enrollments")
        .select("class_id, students(full_name)")
        .eq("academic_year_id", yearId)
        .eq("status", "active")
        .in("student_id", portal.studentIds);
      for (const r of rows ?? []) {
        const cid = r.class_id as string;
        const full =
          (r.students as unknown as { full_name: string } | null)?.full_name ?? "";
        (childrenByClass[cid] ??= []).push(full.split(/\s+/)[0] || full);
      }
    }
    return {
      kind: "portal",
      admin,
      userId: user.id,
      name,
      role: portal.role,
      studentIds: portal.studentIds,
      classIds: Object.keys(childrenByClass),
      childrenByClass,
    };
  }

  // Staff without the grant, or any other role: no diary.
  return null;
}

/** Whether the caller may create posts for these classes. */
export function canPostTo(caller: DiaryCaller, classIds: string[], schoolWide: boolean) {
  if (caller.kind === "staff") return true;
  if (caller.kind === "portal") return false;
  if (schoolWide) return false;
  const mine = new Set(caller.classIds);
  return classIds.length > 0 && classIds.every((id) => mine.has(id));
}

/** Whether the caller may edit / delete this post. */
export function canModify(
  caller: DiaryCaller,
  post: { created_by: string | null; class_id: string | null }
) {
  if (caller.kind === "staff") return true;
  if (caller.kind === "portal") return false;
  // A teacher edits their own posts, and only while the class is still theirs.
  return (
    post.created_by === caller.userId &&
    post.class_id !== null &&
    caller.classIds.includes(post.class_id)
  );
}

/**
 * PostgREST `or` filter for the rows a non-staff caller may read. Class ids
 * are uuids from our own queries, never user input, so interpolating them is
 * safe.
 *
 * School-wide posts carry the session they were written in; with `yearId`
 * they are narrowed to that session (or unset), so last year's notices do not
 * sit in this year's feed. Class posts need no such narrowing — the class is
 * itself a session's class. One `or` holds all of it, nested, rather than two
 * chained .or() calls.
 */
export function visibilityFilter(
  caller: TeacherCaller | PortalCaller,
  yearId?: string | null
): string {
  const parts = [
    yearId
      ? `and(class_id.is.null,or(academic_year_id.eq.${yearId},academic_year_id.is.null))`
      : "class_id.is.null",
  ];
  if (caller.classIds.length > 0) {
    parts.push(`class_id.in.(${caller.classIds.join(",")})`);
  }
  if (caller.kind === "teacher") parts.push(`created_by.eq.${caller.userId}`);
  return parts.join(",");
}

// ── Validation ───────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const attachmentSchema = z.object({
  path: z.string().min(1).max(300),
  name: z.string().min(1).max(200),
  type: z.string().max(100),
  size: z.number().int().nonnegative().max(10 * 1024 * 1024),
});
export type DiaryAttachment = z.infer<typeof attachmentSchema>;

const postFields = {
  kind: z.enum(DIARY_KINDS),
  title: z.string().trim().min(1, "Add a title").max(200),
  body: z.string().max(5000).default(""),
  subject_id: z.string().uuid().nullable().optional(),
  post_date: isoDate.optional(),
  due_date: isoDate.nullable().optional(),
  attachments: z.array(attachmentSchema).max(DIARY_MAX_ATTACHMENTS).default([]),
  is_pinned: z.boolean().optional(),
};

export const diaryCreateSchema = z
  .object({
    ...postFields,
    class_ids: z.array(z.string().uuid()).max(100).default([]),
    school_wide: z.boolean().default(false),
  })
  .refine((v) => v.school_wide || v.class_ids.length > 0, {
    message: "Pick at least one class",
    path: ["class_ids"],
  })
  .refine((v) => !v.due_date || !v.post_date || v.due_date >= v.post_date, {
    message: "The due date is before the post date",
    path: ["due_date"],
  });

export const diaryUpdateSchema = z
  .object({
    kind: postFields.kind.optional(),
    title: postFields.title.optional(),
    body: z.string().max(5000).optional(),
    subject_id: postFields.subject_id,
    post_date: isoDate.optional(),
    due_date: isoDate.nullable().optional(),
    attachments: z.array(attachmentSchema).max(DIARY_MAX_ATTACHMENTS).optional(),
    is_pinned: z.boolean().optional(),
  })
  .strict();

/**
 * An attachment must be a file this user uploaded through the diary's own
 * upload route — every such path starts with their user id. Without this a
 * post could point at any object in the bucket, including another class's
 * photos, and the feed would happily sign it for the wrong families.
 * Staff may re-use any diary path (the office re-posting a teacher's file).
 */
export function attachmentsAllowed(caller: DiaryCaller, attachments: DiaryAttachment[]) {
  if (caller.kind === "staff") return attachments.every((a) => !a.path.includes(".."));
  return attachments.every(
    (a) => a.path.startsWith(`${caller.userId}/`) && !a.path.includes("..")
  );
}
