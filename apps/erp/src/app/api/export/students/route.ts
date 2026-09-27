// Server-side student export: the filtered roll, for any academic session.
//
// This is the route the students page's Export dialog always goes through.
// The page could build a CSV from what it already holds, and deliberately does
// not: student rows carry names, addresses and parent phone numbers, so every
// download of them is generated here where it can be logged (export_events)
// and where contact fields can be withheld from non-admins.
//
// It also answers what the page payload cannot — a past session's roll
// (including students who have since left) and "who is taking Mathematics",
// which needs a join the list does not carry.

import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import {
  fetchRosterByStudentIds,
  fetchSessionClasses,
  fetchSessionRoster,
  fetchStudentSubjects,
  type SessionRosterRow,
} from "@/lib/student-roster";
import {
  exportRequestSchema,
  runExport,
} from "@/lib/export-handler";
import { studentExportColumnMap } from "@/lib/student-export-columns";

export const runtime = "nodejs";

const studentFilterSchema = z
  .object({
    class_ids: z.array(z.string().uuid()).max(200).optional(),
    /** Class labels such as "XI" — every section of that class. */
    class_names: z.array(z.string().max(20)).max(40).optional(),
    sections: z.array(z.string().max(10)).max(40).optional(),
    stream_ids: z.array(z.string().uuid()).max(40).optional(),
    genders: z.array(z.enum(["male", "female", "other"])).max(3).optional(),
    statuses: z.array(z.string().max(20)).max(8).optional(),
    has_transport: z.boolean().nullish(),
    subject_ids: z.array(z.string().uuid()).max(40).optional(),
    subject_match: z.enum(["any", "all"]).default("any"),
    search: z.string().max(120).optional(),
  })
  .partial()
  .default({});

export async function POST(request: Request) {
  const caller = await verifyAdminOrEditorWithUser("students");
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = exportRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid export request", detail: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const filterParsed = studentFilterSchema.safeParse(body.filter ?? {});
  if (!filterParsed.success) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }
  const filter = filterParsed.data;

  try {
    // Resolve the session first: everything below is scoped to it, and a
    // roster with no year is the mixed-session bug this route exists to avoid.
    let yearId = body.academic_year_id ?? null;
    let yearName: string | null = null;
    const { data: years } = await caller.admin
      .from("academic_years")
      .select("id, name, is_current")
      .order("start_date", { ascending: false });
    const yearRows = (years ?? []) as {
      id: string;
      name: string;
      is_current: boolean;
    }[];
    const year =
      (yearId ? yearRows.find((y) => y.id === yearId) : null) ??
      yearRows.find((y) => y.is_current) ??
      yearRows[0] ??
      null;
    if (!year) {
      return NextResponse.json(
        { error: "No academic session is configured." },
        { status: 400 }
      );
    }
    yearId = year.id;
    yearName = year.name;

    // Narrow by class, which is bounded at roughly forty rows a year. Never by
    // student id: a few hundred UUIDs overrun PostgREST's URL and come back
    // empty rather than erroring.
    const classes = await fetchSessionClasses(caller.admin, yearId);
    const targetClasses = classes.filter((cls) => {
      if (filter.class_ids && !filter.class_ids.includes(cls.id)) return false;
      if (filter.class_names && !filter.class_names.includes(cls.name)) return false;
      if (filter.sections && !filter.sections.includes(cls.section)) return false;
      if (
        filter.stream_ids &&
        (!cls.stream_id || !filter.stream_ids.includes(cls.stream_id))
      ) {
        return false;
      }
      return true;
    });

    const narrowed =
      filter.class_ids || filter.class_names || filter.sections || filter.stream_ids;

    // Two ways in, and the difference matters.
    //
    // When the dialog names the rows, start from `students` so the file
    // contains exactly what the admin was looking at — including students
    // with no enrollment at all (the list's "Unassigned" tab). Starting from
    // enrollments, as the roster query does, would drop them silently.
    //
    // Otherwise — a session the browser never loaded — rebuild the roll from
    // its enrollments, narrowing by class rather than by student id.
    let rows =
      body.row_ids && body.row_ids.length > 0
        ? await fetchRosterByStudentIds(caller.admin, {
            academicYearId: yearId,
            studentIds: body.row_ids,
          })
        : await fetchSessionRoster(caller.admin, {
            academicYearId: yearId,
            classIds: narrowed ? targetClasses.map((c) => c.id) : undefined,
            statuses: filter.statuses,
          });

    if (filter.genders) {
      const wanted = new Set(filter.genders);
      rows = rows.filter((row) => wanted.has(String(row.gender) as never));
    }
    if (filter.has_transport !== null && filter.has_transport !== undefined) {
      rows = rows.filter((row) => Boolean(row.has_transport) === filter.has_transport);
    }
    if (filter.search) {
      const q = filter.search.trim().toLowerCase();
      rows = rows.filter((row) =>
        [row.full_name, row.admission_no, row.father_name].some((value) =>
          String(value ?? "").toLowerCase().includes(q)
        )
      );
    }

    // Subjects are fetched for the classes actually in play, and the join is
    // guarded so a link from an earlier class cannot answer for this one.
    const classIdsInPlay = narrowed
      ? targetClasses.map((c) => c.id)
      : classes.map((c) => c.id);
    const enrolledClassByStudent = new Map(
      rows.map((row) => [row.id, row.class_id])
    );
    const subjects = await fetchStudentSubjects(
      caller.admin,
      classIdsInPlay,
      enrolledClassByStudent
    );

    if (filter.subject_ids && filter.subject_ids.length > 0) {
      const wanted = filter.subject_ids;
      const matchAll = filter.subject_match === "all";
      rows = rows.filter((row) => {
        const held = subjects.idsByStudent.get(row.id);
        if (!held) return false;
        return matchAll
          ? wanted.every((id) => held.has(id))
          : wanted.some((id) => held.has(id));
      });
    }

    const streamNameById = new Map<string, string>();
    const { data: streams } = await caller.admin
      .from("streams")
      .select("id, name");
    for (const stream of (streams ?? []) as { id: string; name: string }[]) {
      streamNameById.set(stream.id, stream.name);
    }

    const busNameById = new Map<string, string>();
    const { data: buses } = await caller.admin
      .from("buses")
      .select("id, bus_number");
    for (const bus of (buses ?? []) as { id: string; bus_number: string }[]) {
      busNameById.set(bus.id, bus.bus_number);
    }

    const stopNameById = new Map<string, string>();
    const { data: stops } = await caller.admin
      .from("bus_stops")
      .select("id, name");
    for (const stop of (stops ?? []) as { id: string; name: string }[]) {
      stopNameById.set(stop.id, stop.name);
    }

    const { available, defaults } = studentExportColumnMap({
      subjectNames: subjects.namesByStudent,
      streamNameById,
      busNameById,
      stopNameById,
    });

    return await runExport<SessionRosterRow>({
      request: body,
      actor: {
        admin: caller.admin,
        user: caller.user,
        role: caller.role,
      },
      dataset: "students",
      featureKey: "students",
      available,
      defaultFields: defaults,
      rows,
      subtitle: `Academic session ${yearName}`,
    });
  } catch (error) {
    console.error("Student export failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
