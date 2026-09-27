// Session-scoped student roster: "who was enrolled in this academic year".
//
// The students LIST deliberately does something different — it picks one
// representative enrollment per student by a heuristic and never hard-filters
// by year (see api/students/route.ts), because an admin looking for a name
// must find it whatever state that student is in. That is right for a working
// list and wrong for anything that has to be true of one session: a roster or
// an export labelled "Class XI, 2024-25" must contain exactly the students
// enrolled then — including the ones who have since left the school and been
// marked alumni, whom the working list excludes by design.
//
// Both the list's session view and the server-side export read this module,
// so the two can never disagree about who was in a class.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@nkps/shared/lib/fetch-all-rows";

/**
 * PostgREST puts `in.(…)` in the URL, and the platform caps a URL at 8KB.
 * At ~37 chars per UUID, 200 ids is ~7.4KB — comfortably under, with room for
 * the rest of the query string. Exceed it and the request does not error, it
 * silently returns nothing.
 */
const ID_CHUNK = 200;

// PostgREST caps a response at Supabase's db-max-rows (1000) and a `Range`
// header cannot lift that cap — it can only ask for less. So every read below
// pages until a short page comes back, and each carries an `.order()` on a
// unique column: LIMIT/OFFSET without a total order can repeat a row at one
// page boundary while dropping another. A roll that stops early is the exact
// failure this module exists to prevent, so a truncated read throws rather
// than answering with a short roster.
//
// `table` and `columns` are runtime strings in selectByIds, so postgrest-js
// cannot infer a row shape and falls back to its opaque error type; the cast
// names what the caller already declares through `Row`.
type PagedQuery<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    chunks.push(ids.slice(i, i + ID_CHUNK));
  }
  return chunks;
}

/**
 * `table.select(columns).in(column, ids)` without the URL blowup — the chunks
 * are independent, so they go out together rather than one after another.
 */
export async function selectByIds<Row>(
  admin: SupabaseClient,
  table: string,
  column: string,
  ids: readonly string[],
  columns: string
): Promise<Row[]> {
  if (ids.length === 0) return [];
  const results = await Promise.all(
    chunkIds(ids).map((chunk) =>
      // Each chunk is paged as well as chunked. 200 ids is a bound on the URL,
      // not on the reply: one `class_subject_id` matches every student taking
      // that subject, so a chunk can answer with thousands of rows and the
      // first thousand are all PostgREST will hand back.
      fetchAllRows<Row>(
        (from, to) =>
          admin
            .from(table)
            .select(columns)
            .in(column, chunk)
            .order("id", { ascending: true })
            .range(from, to) as unknown as PagedQuery<Row>
      )
    )
  );
  const rows: Row[] = [];
  for (const { data, error, truncated } of results) {
    if (error) throw new Error(`${table} lookup failed: ${error}`);
    if (truncated) {
      throw new Error(`${table} lookup stopped at the paging guard`);
    }
    rows.push(...data);
  }
  return rows;
}

export interface RosterClass {
  id: string;
  name: string;
  section: string;
  stream_id: string | null;
}

export interface RosterEnrollment {
  id: string;
  student_id: string;
  class_id: string | null;
  stream_id: string | null;
  roll_number: number | null;
  roll_number_manual: boolean | null;
  status: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  // The billing cutoff for a leaver (migration 123). Null while on the roll.
  exit_date: string | null;
  academic_year_id: string | null;
  updated_at: string | null;
  has_transport: boolean | null;
  bus_stop_id: string | null;
  bus_id: string | null;
  transport_direction: string | null;
}

const ENROLLMENT_COLUMNS =
  "id, student_id, class_id, stream_id, roll_number, roll_number_manual, status, status_reason, status_changed_at, exit_date, academic_year_id, updated_at, has_transport, bus_stop_id, bus_id, transport_direction";

export interface SessionRosterRow extends Record<string, unknown> {
  id: string;
  enrollment_id: string | null;
  class_id: string | null;
  class_name: string | null;
  class_section: string | null;
  stream_id: string | null;
  roll_number: number | null;
  enrollment_status: string | null;
  has_transport: boolean;
  bus_stop_id: string | null;
  bus_id: string | null;
  transport_direction: string | null;
}

export interface SessionRosterOptions {
  academicYearId: string;
  /** Restrict to these classes. Bounded (~40 per year), so safe to pass to `.in`. */
  classIds?: readonly string[];
  /** Enrollment statuses to keep. Omit for all of them. */
  statuses?: readonly string[];
  /** Columns to read off `students`. Defaults to everything. */
  studentColumns?: string;
}

export async function fetchSessionClasses(
  admin: SupabaseClient,
  academicYearId: string
): Promise<RosterClass[]> {
  const { data, error } = await admin
    .from("classes")
    .select("id, name, section, stream_id")
    .eq("academic_year_id", academicYearId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`classes lookup failed: ${error.message}`);
  return (data as RosterClass[]) ?? [];
}

/**
 * Every student enrolled in `academicYearId`, merged with their enrollment.
 *
 * Narrowing is done by `class_id` — bounded at roughly forty rows a year — and
 * never by `student_id`, which would be hundreds of UUIDs and overrun the URL.
 */
export async function fetchSessionRoster(
  admin: SupabaseClient,
  {
    academicYearId,
    classIds,
    statuses,
    studentColumns = "*",
  }: SessionRosterOptions
): Promise<SessionRosterRow[]> {
  const enrollmentPage = (from: number, to: number) => {
    let query = admin
      .from("student_enrollments")
      .select(ENROLLMENT_COLUMNS)
      .eq("academic_year_id", academicYearId);
    if (classIds) query = query.in("class_id", [...classIds]);
    if (statuses && statuses.length > 0) {
      query = query.in("status", [...statuses]);
    }
    return query.order("id", { ascending: true }).range(from, to);
  };

  if (classIds && classIds.length === 0) return [];

  const [enrollmentsRes, classes] = await Promise.all([
    fetchAllRows<RosterEnrollment>(enrollmentPage),
    fetchSessionClasses(admin, academicYearId),
  ]);

  if (enrollmentsRes.error) {
    throw new Error(`enrollments lookup failed: ${enrollmentsRes.error}`);
  }
  if (enrollmentsRes.truncated) {
    throw new Error("enrollments lookup stopped at the paging guard");
  }
  const enrollments = enrollmentsRes.data;
  if (enrollments.length === 0) return [];

  // A student can hold more than one enrollment in a year (the uniqueness
  // constraint is per class, not per year), so pick one: active beats a closed
  // status, then the most recently touched row.
  const byStudent = new Map<string, RosterEnrollment>();
  for (const enrollment of enrollments) {
    const held = byStudent.get(enrollment.student_id);
    if (!held) {
      byStudent.set(enrollment.student_id, enrollment);
      continue;
    }
    const rank = (e: RosterEnrollment) => (e.status === "active" ? 0 : 1);
    if (rank(enrollment) < rank(held)) {
      byStudent.set(enrollment.student_id, enrollment);
      continue;
    }
    if (rank(enrollment) === rank(held)) {
      const a = new Date(enrollment.updated_at ?? 0).getTime();
      const b = new Date(held.updated_at ?? 0).getTime();
      if (a > b) byStudent.set(enrollment.student_id, enrollment);
    }
  }

  // No `is_alumni` filter here, deliberately: a student who has since
  // graduated or left was still on this session's roll, and omitting them is
  // exactly the silent wrongness this module exists to prevent.
  const students = await selectByIds<Record<string, unknown>>(
    admin,
    "students",
    "id",
    [...byStudent.keys()],
    studentColumns
  );

  const classById = new Map(classes.map((c) => [c.id, c]));

  return students
    .map((student): SessionRosterRow => {
      const enrollment = byStudent.get(student.id as string);
      const cls = enrollment?.class_id
        ? (classById.get(enrollment.class_id) ?? null)
        : null;
      return {
        ...student,
        id: student.id as string,
        enrollment_id: enrollment?.id ?? null,
        class_id: enrollment?.class_id ?? null,
        class_name: cls?.name ?? null,
        class_section: cls?.section ?? null,
        stream_id: enrollment?.stream_id ?? null,
        roll_number: enrollment?.roll_number ?? null,
        roll_number_manual: enrollment?.roll_number_manual ?? false,
        enrollment_status: enrollment?.status ?? null,
        enrollment_academic_year_id: academicYearId,
        status_reason: enrollment?.status_reason ?? null,
        status_changed_at: enrollment?.status_changed_at ?? null,
        exit_date: enrollment?.exit_date ?? null,
        has_transport: enrollment?.has_transport ?? false,
        bus_stop_id: enrollment?.bus_stop_id ?? null,
        bus_id: enrollment?.bus_id ?? null,
        transport_direction: enrollment?.transport_direction ?? null,
      };
    })
    .sort((a, b) =>
      String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""))
    );
}

// ── Subjects ────────────────────────────────────────────────────────────────

export interface StudentSubjects {
  /** Subject names per student, sorted, for display. */
  namesByStudent: Map<string, string[]>;
  /** Subject ids per student, for filtering. */
  idsByStudent: Map<string, Set<string>>;
}

/**
 * Which subjects each student in these classes is taking.
 *
 * Two hops — `student_subjects → class_subjects → subjects` — and both the
 * direction and the guard matter:
 *
 *  - Narrowed by `class_id` (bounded, ~40 a year), never by `student_id`,
 *    which would be hundreds of UUIDs and silently overrun the URL.
 *  - `student_subjects` carries NO academic year: it links a student to a
 *    `class_subjects` row and nothing else. So a link is only counted when its
 *    class matches the class the student is actually enrolled in for this
 *    session — otherwise a student who took Maths in class IX would answer
 *    "class XI students taking Maths". The same guard exists in the
 *    single-student export at api/students/[id]/export.
 */
export async function fetchStudentSubjects(
  admin: SupabaseClient,
  classIds: readonly string[],
  enrolledClassByStudent: Map<string, string | null>
): Promise<StudentSubjects> {
  const empty: StudentSubjects = {
    namesByStudent: new Map(),
    idsByStudent: new Map(),
  };
  if (classIds.length === 0) return empty;

  const {
    data: rows,
    error,
    truncated,
  } = await fetchAllRows<{
    id: string;
    class_id: string;
    subject_id: string;
    subjects: { name: string } | { name: string }[] | null;
  }>((from, to) =>
    admin
      .from("class_subjects")
      .select("id, class_id, subject_id, subjects(name)")
      .in("class_id", [...classIds])
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (error) throw new Error(`class_subjects lookup failed: ${error}`);
  if (truncated) {
    throw new Error("class_subjects lookup stopped at the paging guard");
  }
  if (rows.length === 0) return empty;

  const byClassSubjectId = new Map(
    rows.map((row) => {
      const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
      return [
        row.id,
        {
          class_id: row.class_id,
          subject_id: row.subject_id,
          name: subject?.name ?? "",
        },
      ];
    })
  );

  const links = await selectByIds<{ student_id: string; class_subject_id: string }>(
    admin,
    "student_subjects",
    "class_subject_id",
    [...byClassSubjectId.keys()],
    "student_id, class_subject_id"
  );

  const namesByStudent = new Map<string, string[]>();
  const idsByStudent = new Map<string, Set<string>>();

  for (const link of links) {
    const cs = byClassSubjectId.get(link.class_subject_id);
    if (!cs) continue;
    // The year guard described above.
    if (enrolledClassByStudent.get(link.student_id) !== cs.class_id) continue;

    if (!namesByStudent.has(link.student_id)) {
      namesByStudent.set(link.student_id, []);
      idsByStudent.set(link.student_id, new Set());
    }
    if (cs.name) namesByStudent.get(link.student_id)!.push(cs.name);
    idsByStudent.get(link.student_id)!.add(cs.subject_id);
  }

  for (const names of namesByStudent.values()) {
    names.sort((a, b) => a.localeCompare(b));
  }

  return { namesByStudent, idsByStudent };
}

/**
 * Exactly these students, annotated with their enrollment for this session.
 *
 * Starts from `students`, not from `student_enrollments`, and that is the
 * whole point: a student with no enrollment row — the list's "Unassigned" tab,
 * every newly admitted child before a class is assigned — has no enrollment to
 * be found by, so a roster-first query would silently drop them from an export
 * the admin explicitly asked for. They come back here with empty class and
 * roll fields, which is the truth about them.
 *
 * Used whenever the caller already knows which rows it wants (the export
 * dialog names them), so that the file matches the table exactly rather than
 * depending on the server re-deriving the same set.
 */
export async function fetchRosterByStudentIds(
  admin: SupabaseClient,
  {
    academicYearId,
    studentIds,
    studentColumns = "*",
  }: {
    academicYearId: string;
    studentIds: readonly string[];
    studentColumns?: string;
  }
): Promise<SessionRosterRow[]> {
  if (studentIds.length === 0) return [];

  const [students, enrollments, classes] = await Promise.all([
    selectByIds<Record<string, unknown>>(
      admin,
      "students",
      "id",
      studentIds,
      studentColumns
    ),
    selectByIds<RosterEnrollment>(
      admin,
      "student_enrollments",
      "student_id",
      studentIds,
      ENROLLMENT_COLUMNS
    ),
    fetchSessionClasses(admin, academicYearId),
  ]);

  const classById = new Map(classes.map((c) => [c.id, c]));

  // Only this session's enrollments count; a student may hold several across
  // years, and picking any of them would reintroduce the mixed-session bug.
  const byStudent = new Map<string, RosterEnrollment>();
  for (const enrollment of enrollments) {
    if (enrollment.academic_year_id !== academicYearId) continue;
    const held = byStudent.get(enrollment.student_id);
    if (!held || (held.status !== "active" && enrollment.status === "active")) {
      byStudent.set(enrollment.student_id, enrollment);
    }
  }

  return students
    .map((student): SessionRosterRow => {
      const enrollment = byStudent.get(student.id as string);
      const cls = enrollment?.class_id
        ? (classById.get(enrollment.class_id) ?? null)
        : null;
      return {
        ...student,
        id: student.id as string,
        enrollment_id: enrollment?.id ?? null,
        class_id: enrollment?.class_id ?? null,
        class_name: cls?.name ?? null,
        class_section: cls?.section ?? null,
        stream_id: enrollment?.stream_id ?? null,
        roll_number: enrollment?.roll_number ?? null,
        roll_number_manual: enrollment?.roll_number_manual ?? false,
        enrollment_status: enrollment?.status ?? null,
        enrollment_academic_year_id: academicYearId,
        status_reason: enrollment?.status_reason ?? null,
        status_changed_at: enrollment?.status_changed_at ?? null,
        exit_date: enrollment?.exit_date ?? null,
        has_transport: enrollment?.has_transport ?? false,
        bus_stop_id: enrollment?.bus_stop_id ?? null,
        bus_id: enrollment?.bus_id ?? null,
        transport_direction: enrollment?.transport_direction ?? null,
      };
    })
    .sort((a, b) =>
      String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""))
    );
}
