import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { studentSchema } from "@nkps/shared/lib/validations";
import {
  buildStudentRecord,
  studentsInsertKeys,
} from "@nkps/shared/lib/student-template";

export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const classId = request.nextUrl.searchParams.get("class_id");

    if (!classId) {
      // Fetch all students with their enrollment/class info.
      //
      // Gate on `is_alumni`, NOT `is_active`. `is_active` is flipped false when
      // an enrollment goes terminated/exited (see api/students/status), so
      // filtering on it silently hides those students from the listing — and
      // therefore from name/admission-no search, which runs client-side over
      // this list. Admins must be able to find a student regardless of status.
      // Alumni (is_alumni=true) stay excluded; they have a dedicated dialog and
      // number in the thousands. `IS NOT TRUE` keeps rows where is_alumni is
      // false OR null (the column is nullable with a false default).
      //
      // .range(0, 9999) pushes past PostgREST's 1000-row default cap so the now
      // larger list (active + passed/failed + terminated/exited) isn't silently
      // truncated.
      //
      // The three queries below are independent, so they are issued together.
      // Run sequentially they cost three round trips to Postgres before any
      // byte reaches the client, which dominated the wait on this endpoint.
      const [studentsRes, currentYearRes, enrollmentsRes] = await Promise.all([
        admin
          .from("students")
          .select("*")
          .not("is_alumni", "is", true)
          .order("full_name", { ascending: true })
          .range(0, 9999),
        admin
          .from("academic_years")
          .select("id")
          .eq("is_current", true)
          .maybeSingle(),
        admin
          .from("student_enrollments")
          .select(
            "student_id, roll_number, roll_number_manual, id, class_id, stream_id, status, academic_year_id, updated_at, has_transport, bus_stop_id, transport_direction, classes(name, section)"
          )
          .range(0, 9999),
      ]);

      const { data: allStudents, error } = studentsRes;

      if (error) {
        console.error("Fetch all students error:", error);
        return NextResponse.json({ error: "Failed to fetch students" }, { status: 500 });
      }

      if (!allStudents || allStudents.length === 0) {
        return NextResponse.json({ data: [] });
      }

      // Pick the "best" enrollment per student. Do NOT hard-filter by the
      // current academic year — enrollments can legitimately live in any year
      // (classes are year-scoped), and hard-filtering makes every student
      // render "Unassigned" the moment the year mismatches the is_current flag
      // (e.g., right after a year switch, or if the admin assigned classes
      // before flipping is_current).
      //
      // Do NOT pre-filter by student_id either: `.in("student_id", [...])`
      // with a few hundred UUIDs overruns PostgREST's URL length and silently
      // returns nothing.
      //
      // Explicit .range(0, 9999) pushes past PostgREST's default 1000-row cap
      // so schools with long enrollment history aren't silently truncated.
      const currentYearId = currentYearRes.data?.id ?? null;

      const { data: enrollments, error: enrollError } = enrollmentsRes;
      if (enrollError) {
        console.error("Fetch enrollments error:", enrollError);
        // Continue with empty merge rather than failing the whole list — the
        // students table still renders, just without class/roll data.
      }

      // Priority for picking a student's representative enrollment:
      //   1. Current-year row (if a current year is flagged) beats other years.
      //   2. status='active' beats past statuses (passed/failed/terminated/exited).
      //   3. More recently updated row beats older (proxy for "most recent
      //      enrollment activity"; the table doesn't carry created_at).
      type Enrollment = NonNullable<typeof enrollments>[number];
      const sorted = (enrollments ?? []).slice().sort((a: Enrollment, b: Enrollment) => {
        const aYear = currentYearId && a.academic_year_id === currentYearId ? 0 : 1;
        const bYear = currentYearId && b.academic_year_id === currentYearId ? 0 : 1;
        if (aYear !== bYear) return aYear - bYear;
        const aStatus = a.status === "active" ? 0 : 1;
        const bStatus = b.status === "active" ? 0 : 1;
        if (aStatus !== bStatus) return aStatus - bStatus;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });

      const byStudent = new Map<string, Enrollment>();
      for (const e of sorted) {
        if (!byStudent.has(e.student_id)) byStudent.set(e.student_id, e);
      }

      const merged = allStudents.map((s) => {
        const enrollment = byStudent.get(s.id);
        // Supabase returns nested relations as object or array depending on FK
        // inference — handle both shapes.
        const rawCls = enrollment?.classes as
          | { name: string; section: string }
          | { name: string; section: string }[]
          | null
          | undefined;
        const cls = Array.isArray(rawCls) ? (rawCls[0] ?? null) : (rawCls ?? null);
        const e = enrollment as
          | (typeof enrollment & {
              has_transport?: boolean | null;
              bus_stop_id?: string | null;
              transport_direction?: string | null;
              roll_number_manual?: boolean;
            })
          | undefined;
        return {
          ...s,
          roll_number: enrollment?.roll_number ?? null,
          roll_number_manual: e?.roll_number_manual ?? false,
          enrollment_id: enrollment?.id ?? null,
          class_id: enrollment?.class_id ?? null,
          stream_id: enrollment?.stream_id ?? null,
          enrollment_status: enrollment?.status ?? null,
          class_name: cls?.name ?? null,
          class_section: cls?.section ?? null,
          has_transport: e?.has_transport ?? false,
          bus_stop_id: e?.bus_stop_id ?? null,
          transport_direction: e?.transport_direction ?? null,
        };
      });

      return NextResponse.json({ data: merged });
    }

    // Get enrollments for the class
    const { data: enrollments, error: enrollError } = await admin
      .from("student_enrollments")
      .select(
        "id, student_id, roll_number, roll_number_manual, class_id, stream_id, status, has_transport, bus_stop_id, transport_direction"
      )
      .eq("class_id", classId);

    if (enrollError) {
      console.error("Fetch enrollments error:", enrollError);
      return NextResponse.json({ error: "Failed to fetch enrollments" }, { status: 500 });
    }

    if (!enrollments || enrollments.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const studentIds = enrollments.map((e) => e.student_id);

    // Chunk the student lookup to keep the PostgREST `id=in.(…)` URL parameter
    // well under the platform 8KB URL cap. ~36 chars/UUID → 200 ids fits in
    // ~7KB, leaving headroom for query string, host header etc.
    const STUDENT_CHUNK = 200;
    const studentChunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += STUDENT_CHUNK) {
      studentChunks.push(studentIds.slice(i, i + STUDENT_CHUNK));
    }
    type StudentRow = Record<string, unknown>;
    // Chunks are independent — fetch them concurrently rather than one after
    // another, so a large class costs one round trip instead of one per chunk.
    const chunkResults = await Promise.all(
      studentChunks.map((chunk) => admin.from("students").select("*").in("id", chunk))
    );
    const studentsAll: StudentRow[] = [];
    let studentError: { message: string } | null = null;
    for (const { data, error } of chunkResults) {
      if (error) {
        studentError = error;
        break;
      }
      if (data) studentsAll.push(...(data as StudentRow[]));
    }
    const students = studentsAll.sort((a, b) =>
      String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""))
    );

    if (studentError) {
      console.error("Fetch students by class error:", studentError);
      return NextResponse.json({ error: "Failed to fetch students" }, { status: 500 });
    }

    const enrollmentByStudent = new Map(enrollments.map((e) => [e.student_id, e]));

    const merged = (students ?? []).map((s) => {
      const enrollment = enrollmentByStudent.get(s.id as string);
      const e = enrollment as
        | (typeof enrollment & {
            has_transport?: boolean | null;
            bus_stop_id?: string | null;
            transport_direction?: string | null;
            roll_number_manual?: boolean;
          })
        | undefined;
      return {
        ...s,
        roll_number: enrollment?.roll_number ?? null,
        roll_number_manual: e?.roll_number_manual ?? false,
        enrollment_id: enrollment?.id ?? null,
        class_id: enrollment?.class_id ?? null,
        stream_id: enrollment?.stream_id ?? null,
        enrollment_status: enrollment?.status ?? null,
        has_transport: e?.has_transport ?? false,
        bus_stop_id: e?.bus_stop_id ?? null,
        transport_direction: e?.transport_direction ?? null,
      };
    });

    return NextResponse.json({ data: merged });
  } catch (err) {
    console.error("Fetch students error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    // stream_id is intentionally NOT taken from the client: a student's stream
    // is a property of their class (a stream-bound senior class carries its own
    // stream_id; lower classes have none). We derive it from the class below so
    // the enrollment can never hold a stream that contradicts the class. Any
    // client-sent stream_id falls into studentFields and is stripped by zod.
    const { class_id, roll_number, roll_number_manual, ...studentFields } = body;

    const result = studentSchema.safeParse(studentFields);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    // Insert student — every registry-declared column, blank → null.
    const insertRecord = buildStudentRecord(result.data as Record<string, unknown>, [
      ...studentsInsertKeys(),
      "indian_national",
    ]);
    // Blank admission date on create should fall back to the DB default
    // (CURRENT_DATE), not overwrite it with NULL.
    if (insertRecord.admission_date === null) {
      delete insertRecord.admission_date;
    }
    const { data: student, error: studentError } = await admin
      .from("students")
      .insert(insertRecord)
      .select("id")
      .single();

    if (studentError) {
      console.error("Create student error:", studentError);
      if (studentError.code === "23505") {
        return NextResponse.json(
          { error: "A student with this admission number already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Failed to create student" }, { status: 500 });
    }

    // Create enrollment if class_id provided
    if (class_id && student) {
      const { data: classRow, error: classLookupError } = await admin
        .from("classes")
        .select("academic_year_id, stream_id")
        .eq("id", class_id)
        .single();

      if (classLookupError || !classRow?.academic_year_id) {
        console.error("Class lookup failed:", classLookupError);
        return NextResponse.json(
          { error: "Selected class could not be resolved" },
          { status: 400 }
        );
      }

      const { error: enrollError } = await admin
        .from("student_enrollments")
        .insert({
          student_id: student.id,
          class_id,
          academic_year_id: classRow.academic_year_id,
          roll_number: roll_number ? parseInt(roll_number, 10) : null,
          roll_number_manual: roll_number_manual === true,
          // Stream follows the class, authoritatively (see destructure note).
          stream_id: classRow.stream_id ?? null,
        });

      if (enrollError) {
        console.error("Enrollment error:", enrollError);
        return NextResponse.json(
          { error: "Failed to enroll student in the selected class" },
          { status: 500 }
        );
      }

    }

    // Portal user creation is intentionally NOT triggered here. Admins create
    // logins explicitly via the "Create portal accounts" dialog on the students
    // page once they're ready to onboard the student.
    return NextResponse.json({ success: true, data: student });
  } catch (err) {
    console.error("Create student error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    // stream_id is derived from the class, never trusted from the client (see
    // the POST note) — a client-sent stream_id lands in `fields` and zod strips it.
    const { id, enrollment_id, roll_number, roll_number_manual, class_id, ...fields } = body;

    if (!id) {
      return NextResponse.json({ error: "Student id required" }, { status: 400 });
    }

    // The current row: used to (a) preserve a stored non-Indian nationality when
    // the Indian-National toggle says NO, and (b) tolerate unchanged legacy
    // values the strict schema would otherwise reject (below).
    const { data: current } = await admin
      .from("students")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    // Validate + whitelist: only registry-declared student columns may be
    // updated, and only the keys the caller actually sent (partial update).
    // Anything else (is_alumni, is_active, photo_url, …) has its own route.
    let effectiveFields = fields as Record<string, unknown>;
    let parsed = studentSchema.partial().safeParse(effectiveFields);
    if (!parsed.success && current) {
      // The edit form resends every field, so a single legacy value that
      // predates the strict schema (e.g. a bulk-imported non-10-digit mobile)
      // would otherwise block every unrelated edit. Drop the failing fields
      // that are UNCHANGED from what's stored, then re-validate. A genuinely
      // new invalid value differs from stored, so it stays rejected.
      const failedKeys = Object.keys(parsed.error.flatten().fieldErrors ?? {});
      const norm = (x: unknown) => (x === null || x === undefined ? "" : String(x).trim());
      const unchangedFailing = failedKeys.filter(
        (k) => norm(effectiveFields[k]) === norm((current as Record<string, unknown>)[k])
      );
      if (unchangedFailing.length > 0) {
        effectiveFields = Object.fromEntries(
          Object.entries(effectiveFields).filter(([k]) => !unchangedFailing.includes(k))
        );
        parsed = studentSchema.partial().safeParse(effectiveFields);
      }
    }
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const providedKeys = Object.keys(effectiveFields).filter((k) =>
      k === "indian_national" || studentsInsertKeys().includes(k)
    );
    const updateRecord = buildStudentRecord(
      parsed.data as Record<string, unknown>,
      providedKeys,
      (current as Record<string, unknown> | null) ?? undefined
    );

    const { error } = await admin
      .from("students")
      .update({ ...updateRecord, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Update student error:", error);
      return NextResponse.json({ error: "Failed to update student" }, { status: 500 });
    }

    // Update enrollment fields (roll_number, roll_number_manual, class_id, stream_id)
    if (enrollment_id) {
      const enrollmentUpdate: Record<string, unknown> = {};
      if (roll_number !== undefined) {
        enrollmentUpdate.roll_number = roll_number ? parseInt(roll_number, 10) : null;
      }
      if (roll_number_manual !== undefined) {
        enrollmentUpdate.roll_number_manual = roll_number_manual === true;
      }
      if (class_id) {
        enrollmentUpdate.class_id = class_id;

        const { data: classRow, error: classLookupError } = await admin
          .from("classes")
          .select("academic_year_id, stream_id")
          .eq("id", class_id)
          .single();

        if (classLookupError || !classRow?.academic_year_id) {
          console.error("Class lookup failed on update:", classLookupError);
          return NextResponse.json(
            { error: "Selected class could not be resolved" },
            { status: 400 }
          );
        }
        enrollmentUpdate.academic_year_id = classRow.academic_year_id;
        // Stream follows the (possibly changed) class. When class_id isn't part
        // of this edit the stream stays as-is — it can only change with the class.
        enrollmentUpdate.stream_id = classRow.stream_id ?? null;
      }

      if (Object.keys(enrollmentUpdate).length > 0) {
        const { error: enrollErr } = await admin
          .from("student_enrollments")
          .update(enrollmentUpdate)
          .eq("id", enrollment_id);

        if (enrollErr) {
          console.error("Update enrollment error:", enrollErr);
          return NextResponse.json({ error: "Student updated but enrollment change failed" }, { status: 500 });
        }
      }
    } else if (class_id) {
      // No prior current-year enrollment surfaced — recover on edit. A stale
      // enrollment for this (student_id, class_id) may still exist (same class
      // from a prior status like terminated/exited, or dropped from the list
      // GET due to PostgREST row caps), so reuse it if present to avoid
      // tripping the UNIQUE(student_id, class_id) constraint.
      const { data: classRow, error: classLookupError } = await admin
        .from("classes")
        .select("academic_year_id, stream_id")
        .eq("id", class_id)
        .single();

      if (classLookupError || !classRow?.academic_year_id) {
        console.error("Class lookup failed on recover:", classLookupError);
        return NextResponse.json(
          { error: "Selected class could not be resolved" },
          { status: 400 }
        );
      }

      const { data: existing, error: existingLookupError } = await admin
        .from("student_enrollments")
        .select("id")
        .eq("student_id", id)
        .eq("class_id", class_id)
        .maybeSingle();

      if (existingLookupError) {
        console.error("Existing enrollment lookup failed:", existingLookupError);
        return NextResponse.json(
          { error: "Student updated but enrollment lookup failed" },
          { status: 500 }
        );
      }

      const payload = {
        academic_year_id: classRow.academic_year_id,
        roll_number: roll_number ? parseInt(roll_number, 10) : null,
        roll_number_manual: roll_number_manual === true,
        // Stream follows the class, authoritatively (see the POST note).
        stream_id: classRow.stream_id ?? null,
        status: "active" as const,
      };

      const { error: enrollErr } = existing
        ? await admin
            .from("student_enrollments")
            .update(payload)
            .eq("id", existing.id)
        : await admin
            .from("student_enrollments")
            .insert({ student_id: id, class_id, ...payload });

      if (enrollErr) {
        console.error("Recover enrollment error:", enrollErr);
        return NextResponse.json(
          { error: "Student updated but enrollment creation failed" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Update student error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    let ids: string[] = [];
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      ids = body.ids.filter((x: unknown): x is string => typeof x === "string");
    } else if (typeof body.id === "string" && body.id) {
      ids = [body.id];
    }
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Student id(s) required" },
        { status: 400 }
      );
    }

    // 1. Find candidate parents linked to the targeted students. We'll later
    //    drop any parent that has no remaining links to other students *and*
    //    no auth profile pointing at it.
    const { data: studentParentRows } = await admin
      .from("student_parents")
      .select("parent_id")
      .in("student_id", ids);
    const candidateParentIds = Array.from(
      new Set((studentParentRows ?? []).map((r) => r.parent_id as string))
    );

    // 2. Wipe enrollments. They have ON DELETE CASCADE off the student row but
    //    older deployments may not have it, so we belt-and-brace.
    await admin.from("student_enrollments").delete().in("student_id", ids);

    // 3. Linked auth users (the students' own accounts). Deleting the auth
    //    user cascades into profiles via the FK on profiles.id.
    const { data: linkedProfiles } = await admin
      .from("profiles")
      .select("id")
      .in("student_id", ids);
    if (linkedProfiles?.length) {
      for (const p of linkedProfiles) {
        const { error: authErr } = await admin.auth.admin.deleteUser(p.id);
        if (authErr) {
          console.error(`[students.DELETE] auth delete ${p.id}:`, authErr);
        }
      }
    }

    // 4. Delete the students themselves. student_parents cascades with the
    //    student row, so the candidateParentIds above were captured before
    //    this step on purpose.
    const { error: delErr } = await admin
      .from("students")
      .delete()
      .in("id", ids);
    if (delErr) {
      console.error("Delete student error:", delErr);
      return NextResponse.json(
        { error: "Failed to delete student(s)" },
        { status: 500 }
      );
    }

    // 5. Garbage-collect parents that no longer have any student links and
    //    no auth profile pointing at them. A parent linked to a sibling or
    //    with an active portal account stays put.
    if (candidateParentIds.length > 0) {
      const { data: stillLinked } = await admin
        .from("student_parents")
        .select("parent_id")
        .in("parent_id", candidateParentIds);
      const stillLinkedSet = new Set(
        (stillLinked ?? []).map((r) => r.parent_id as string)
      );

      const { data: linkedParentProfiles } = await admin
        .from("profiles")
        .select("id, parent_id")
        .in("parent_id", candidateParentIds);
      const profileLinkedSet = new Set(
        (linkedParentProfiles ?? [])
          .map((r) => r.parent_id as string | null)
          .filter((x): x is string => Boolean(x))
      );

      const orphanParentIds = candidateParentIds.filter(
        (pid) => !stillLinkedSet.has(pid) && !profileLinkedSet.has(pid)
      );

      if (orphanParentIds.length > 0) {
        const { error: parentDelErr } = await admin
          .from("parents")
          .delete()
          .in("id", orphanParentIds);
        if (parentDelErr) {
          // Non-fatal — students are gone; parent rows just linger.
          console.error("[students.DELETE] orphan parents:", parentDelErr);
        }
      }
    }

    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (err) {
    console.error("Delete student error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
