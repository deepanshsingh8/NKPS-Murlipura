import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { todayISO } from "@nkps/shared/lib/date";
import { formatClassName } from "@nkps/shared/lib/utils";
import { getStudentOutstandingDues } from "@/lib/student-dues";
import {
  DIARY_BUCKET,
  DIARY_KINDS,
  DIARY_URL_TTL_SECONDS,
  attachmentsAllowed,
  canModify,
  canPostTo,
  currentAcademicYearId,
  diaryCreateSchema,
  resolveDiaryCaller,
  visibilityFilter,
  type DiaryAttachment,
  type DiaryCaller,
} from "@/lib/class-diary";

// GET  /api/class-diary?class_id=&kind=&offset=&limit=
//   The caller's feed, newest first. Staff see every class; a teacher sees
//   their classes plus school-wide posts; a parent or student sees their
//   children's classes plus school-wide posts. Also returns the class list
//   the caller may filter by (and, for staff and teachers, post to), and for
//   families their outstanding fee dues.
//
// POST /api/class-diary
//   Create a post in one or more classes (or school-wide, staff only). One row
//   per class — see migration 903 for why.

const POST_COLUMNS =
  "id, class_id, subject_id, kind, title, body, post_date, due_date, attachments, is_pinned, batch_id, created_by, author_name, created_at, updated_at, classes(name, section, streams(name)), subjects(name)";

interface ClassOption {
  id: string;
  label: string;
  sort_order: number;
}

async function classOptions(caller: DiaryCaller): Promise<ClassOption[]> {
  const yearId = await currentAcademicYearId(caller.admin);
  let q = caller.admin
    .from("classes")
    .select("id, name, section, sort_order, streams(name)")
    .order("sort_order", { ascending: true });
  if (caller.kind === "staff") {
    if (!yearId) return [];
    q = q.eq("academic_year_id", yearId);
  } else {
    if (caller.classIds.length === 0) return [];
    q = q.in("id", caller.classIds);
  }
  const { data } = await q;
  return (data ?? []).map((c) => ({
    id: c.id as string,
    label: formatClassName(c as unknown as { name: string; section: string; streams: unknown }),
    sort_order: (c.sort_order as number) ?? 0,
  }));
}

function classLabel(row: Record<string, unknown>): string | null {
  const cls = row.classes as { name: string; section: string; streams?: unknown } | null;
  return cls ? formatClassName(cls) : null;
}

export async function GET(request: NextRequest) {
  const caller = await resolveDiaryCaller();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = caller;
  const params = request.nextUrl.searchParams;
  const classId = params.get("class_id");
  const kind = params.get("kind");
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 30, 1), 100);

  let query = admin
    .from("class_diary_posts")
    .select(POST_COLUMNS)
    .order("post_date", { ascending: false })
    .order("created_at", { ascending: false })
    // Offset rather than a cursor: the order is by post_date first, which a
    // created_at cursor cannot follow. A post arriving between pages shifts
    // one row; the client de-duplicates by id.
    .range(offset, offset + limit);

  const yearId = await currentAcademicYearId(admin);
  if (caller.kind !== "staff") {
    query = query.or(visibilityFilter(caller, yearId));
  } else if (yearId && (!classId || classId === "school")) {
    // Office, not narrowed to one class: this session's posts. A single class
    // is already a single session, so that filter needs nothing more.
    query = query.or(`academic_year_id.eq.${yearId},academic_year_id.is.null`);
  }
  if (classId === "school") {
    query = query.is("class_id", null);
  } else if (classId) {
    // A class outside the caller's scope simply matches nothing: the
    // visibility filter above is ANDed with this one.
    query = query.eq("class_id", classId);
  }
  if (kind && (DIARY_KINDS as readonly string[]).includes(kind)) {
    query = query.eq("kind", kind);
  }

  const [{ data: rows, error }, classes] = await Promise.all([
    query,
    classOptions(caller),
  ]);
  if (error) {
    console.error("[class-diary.GET] list:", error);
    return NextResponse.json({ error: "Failed to load the class diary" }, { status: 500 });
  }

  const hasMore = (rows ?? []).length > limit;
  const page = (rows ?? []).slice(0, limit) as Record<string, unknown>[];
  const ids = page.map((r) => r.id as string);

  // Sign every attachment in one round trip.
  const paths = [
    ...new Set(
      page.flatMap((r) => ((r.attachments as DiaryAttachment[]) ?? []).map((a) => a.path))
    ),
  ];
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await admin.storage
      .from(DIARY_BUCKET)
      .createSignedUrls(paths, DIARY_URL_TTL_SECONDS);
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  // Read receipts: a count for the people who post, a flag for the family.
  const seen = new Map<string, number>();
  const mine = new Set<string>();
  if (ids.length > 0) {
    if (caller.kind === "portal") {
      const { data: reads } = await admin
        .from("class_diary_reads")
        .select("post_id")
        .eq("profile_id", caller.userId)
        .in("post_id", ids);
      for (const r of reads ?? []) mine.add(r.post_id as string);
    } else {
      const { data: reads } = await admin
        .from("class_diary_reads")
        .select("post_id")
        .in("post_id", ids);
      for (const r of reads ?? []) {
        const id = r.post_id as string;
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
  }

  const posts = page.map((r) => {
    const attachments = ((r.attachments as DiaryAttachment[]) ?? []).map((a) => ({
      ...a,
      url: signed.get(a.path) ?? null,
    }));
    const cid = r.class_id as string | null;
    return {
      id: r.id as string,
      class_id: cid,
      class_label: classLabel(r),
      subject_id: r.subject_id as string | null,
      subject_name: (r.subjects as { name: string } | null)?.name ?? null,
      kind: r.kind as string,
      title: r.title as string,
      body: r.body as string,
      post_date: r.post_date as string,
      due_date: r.due_date as string | null,
      attachments,
      is_pinned: r.is_pinned as boolean,
      author_name: r.author_name as string | null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
      can_edit: canModify(caller, {
        created_by: r.created_by as string | null,
        class_id: cid,
      }),
      seen_count: caller.kind === "portal" ? null : seen.get(r.id as string) ?? 0,
      is_read: caller.kind === "portal" ? mine.has(r.id as string) : null,
      for_children:
        caller.kind === "portal" && caller.role === "parent" && cid
          ? caller.childrenByClass[cid] ?? []
          : [],
    };
  });

  // Families see what they owe next to the school's reminders. Same figure
  // the download gate uses (lenient on late fees; see student-dues.ts).
  let dues: { student_id: string; name: string; total: number }[] = [];
  if (caller.kind === "portal" && offset === 0 && caller.studentIds.length > 0) {
    const { data: students } = await admin
      .from("students")
      .select("id, full_name")
      .in("id", caller.studentIds);
    const results = await Promise.all(
      (students ?? []).map(async (s) => {
        try {
          const d = await getStudentOutstandingDues(admin, s.id as string);
          return d.hasOutstanding
            ? { student_id: s.id as string, name: s.full_name as string, total: d.total }
            : null;
        } catch (e) {
          // Never block the diary on the fee maths.
          console.error("[class-diary.GET] dues:", e);
          return null;
        }
      })
    );
    dues = results.filter((d): d is NonNullable<typeof d> => d !== null);
  }

  // For the composer: which subjects each postable class has, so homework
  // can say which subject it is for.
  const subjectsByClass: Record<string, { id: string; name: string }[]> = {};
  if (caller.kind !== "portal" && offset === 0 && classes.length > 0) {
    const { data: cs } = await admin
      .from("class_subjects")
      .select("class_id, subjects(id, name)")
      .in(
        "class_id",
        classes.map((c) => c.id)
      );
    for (const row of cs ?? []) {
      const subj = row.subjects as unknown as { id: string; name: string } | null;
      if (!subj) continue;
      (subjectsByClass[row.class_id as string] ??= []).push({ id: subj.id, name: subj.name });
    }
    for (const list of Object.values(subjectsByClass)) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return NextResponse.json({
    viewer: caller.kind === "portal" ? caller.role : caller.kind,
    subjects_by_class: subjectsByClass,
    can_post_school_wide: caller.kind === "staff",
    classes: classes.map(({ id, label }) => ({ id, label })),
    posts,
    has_more: hasMore,
    next_offset: hasMore ? offset + limit : null,
    dues,
  });
}

export async function POST(request: Request) {
  const caller = await resolveDiaryCaller();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (caller.kind === "portal") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = diaryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const classIds = input.school_wide ? [] : [...new Set(input.class_ids)];

  if (!canPostTo(caller, classIds, input.school_wide)) {
    return NextResponse.json(
      {
        error: input.school_wide
          ? "Only the office can post to the whole school"
          : "You can only post to classes you teach",
      },
      { status: 403 }
    );
  }
  if (!attachmentsAllowed(caller, input.attachments)) {
    return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
  }

  const { admin } = caller;
  const postDate = input.post_date ?? todayISO();
  if (input.due_date && input.due_date < postDate) {
    return NextResponse.json(
      { error: "The due date is before the post date" },
      { status: 400 }
    );
  }

  // Each class carries its own session; a school-wide post takes the current one.
  let targets: { class_id: string | null; academic_year_id: string | null }[];
  if (input.school_wide) {
    targets = [{ class_id: null, academic_year_id: await currentAcademicYearId(admin) }];
  } else {
    const { data: cls, error } = await admin
      .from("classes")
      .select("id, academic_year_id")
      .in("id", classIds);
    if (error || !cls || cls.length !== classIds.length) {
      return NextResponse.json({ error: "Unknown class" }, { status: 400 });
    }
    targets = cls.map((c) => ({
      class_id: c.id as string,
      academic_year_id: c.academic_year_id as string,
    }));
  }

  const batchId = targets.length > 1 ? randomUUID() : null;
  const rows = targets.map((t) => ({
    ...t,
    subject_id: input.subject_id ?? null,
    kind: input.kind,
    title: input.title,
    body: input.body.trim(),
    post_date: postDate,
    due_date: input.due_date ?? null,
    attachments: input.attachments,
    // Pinning is an office tool; a teacher's pin request is ignored.
    is_pinned: caller.kind === "staff" ? input.is_pinned ?? false : false,
    batch_id: batchId,
    created_by: caller.userId,
    author_name: caller.name,
  }));

  const { data, error } = await admin
    .from("class_diary_posts")
    .insert(rows)
    .select("id, class_id");
  if (error) {
    console.error("[class-diary.POST] insert:", error);
    return NextResponse.json({ error: "Failed to post" }, { status: 500 });
  }
  return NextResponse.json({ data, count: data?.length ?? 0 });
}
