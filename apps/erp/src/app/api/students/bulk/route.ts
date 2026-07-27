import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { studentBulkUploadSchema } from "@nkps/shared/lib/validations";
import {
  buildStudentRecord,
  normalizeToken,
  studentsInsertKeys,
} from "@nkps/shared/lib/student-template";

export const maxDuration = 120; // Allow up to 2 minutes for large uploads

export async function POST(request: Request) {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = studentBulkUploadSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { students } = result.data;

    // Column projection: only columns that were actually present in the
    // uploaded sheet get written. A blank cell in a present column clears the
    // value; a column absent from the sheet leaves existing data untouched,
    // so a sparse re-upload can't null out previously filled fields. The
    // client sends the mapped keys; fall back to the union of row keys.
    const studentColumnSet = new Set(studentsInsertKeys());
    const rawProvided: string[] = Array.isArray(body.provided_keys)
      ? body.provided_keys.filter((k: unknown): k is string => typeof k === "string")
      : Array.from(
          new Set(
            students.flatMap((s) =>
              Object.keys(s).filter((k) => (s as Record<string, unknown>)[k] !== undefined)
            )
          )
        );
    const recordKeys = Array.from(
      new Set(["admission_no", "full_name", ...rawProvided])
    ).filter((k) => k === "indian_national" || studentColumnSet.has(k));
    const subjectsProvided = rawProvided.includes("subjects");

    // Fetch current academic year
    const { data: currentYear } = await admin
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .single();

    if (!currentYear) {
      return NextResponse.json(
        { error: "No current academic year is set. Please set one first." },
        { status: 400 }
      );
    }

    // Fetch streams for stream_id lookup (Science, Commerce, etc.)
    const { data: allStreams } = await admin
      .from("streams")
      .select("id, name");

    const streamMap = new Map<string, string>();
    // Common aliases for stream names
    const STREAM_ALIASES: Record<string, string[]> = {
      humanities: ["arts", "humanities stream", "arts stream"],
      science: ["sci", "science stream"],
      commerce: ["comm", "commerce stream"],
    };
    for (const s of allStreams || []) {
      const key = s.name.trim().toLowerCase();
      streamMap.set(key, s.id);
      // Also register common aliases
      const aliases = STREAM_ALIASES[key];
      if (aliases) {
        for (const alias of aliases) {
          streamMap.set(alias, s.id);
        }
      }
    }

    // Fetch all classes for the current academic year
    const { data: allClasses } = await admin
      .from("classes")
      .select("id, name, section, stream_id")
      .eq("academic_year_id", currentYear.id);

    // Key format: "name|section|streamId" — streamId is empty string for non-senior classes
    const SENIOR_CLASSES = ["XI", "XII"];
    const classMap = new Map<string, string>();
    for (const c of allClasses || []) {
      const streamPart = c.stream_id || "";
      const key = `${c.name.trim().toLowerCase()}|${c.section.trim().toLowerCase()}|${streamPart}`;
      classMap.set(key, c.id);
    }

    function classKey(name: string, section: string, streamId: string | null): string {
      return `${name.toLowerCase()}|${section.toLowerCase()}|${streamId || ""}`;
    }

    // Sort order helper
    const CLASS_ORDER = [
      "Nursery", "LKG", "UKG", "I", "II", "III", "IV", "V",
      "VI", "VII", "VIII", "IX", "X", "XI", "XII",
    ];
    const SECTION_ORDER = ["A", "B", "C", "D", "E"];

    function getSortOrder(name: string, section: string): number {
      const classIdx = CLASS_ORDER.findIndex(
        (c) => c.toLowerCase() === name.toLowerCase()
      );
      const secIdx = SECTION_ORDER.findIndex(
        (s) => s.toLowerCase() === section.toLowerCase()
      );
      return (classIdx === -1 ? 99 : classIdx) * 10 + (secIdx === -1 ? 0 : secIdx);
    }

    // Auto-create missing classes from student data
    const neededClasses = new Set<string>();
    for (const s of students) {
      const name = s.class_name.trim();
      const section = (s.section || "A").trim();
      const stream = s.stream?.trim().toLowerCase() || "";
      const sId = SENIOR_CLASSES.includes(name) && stream ? (streamMap.get(stream) || null) : null;
      const key = classKey(name, section, sId);
      if (!classMap.has(key)) {
        neededClasses.add(`${name}|||${section}|||${sId || ""}`);
      }
    }

    let classesCreated = 0;
    for (const entry of neededClasses) {
      const [name, section, sId] = entry.split("|||");
      const insertData: Record<string, unknown> = {
        name,
        section,
        academic_year_id: currentYear.id,
        stream_id: sId || null,
        sort_order: getSortOrder(name, section),
      };

      const { data: created, error: createErr } = await admin
        .from("classes")
        .insert(insertData)
        .select("id")
        .single();

      if (createErr) {
        let query = admin
          .from("classes")
          .select("id")
          .eq("name", name)
          .eq("section", section)
          .eq("academic_year_id", currentYear.id);
        if (sId) {
          query = query.eq("stream_id", sId);
        } else {
          query = query.is("stream_id", null);
        }
        const { data: existing } = await query.single();
        if (existing) {
          classMap.set(classKey(name, section, sId || null), existing.id);
        }
      } else if (created) {
        classMap.set(classKey(name, section, sId || null), created.id);
        classesCreated++;
      }
    }

    const errors: { admission_no: string; full_name?: string; class_name?: string; section?: string; error: string }[] = [];
    const warnings: { admission_no: string; full_name?: string; warning: string }[] = [];

    // ── Phase 1: Resolve classes and prepare student records ──
    interface PreparedStudent {
      record: Record<string, unknown>;
      classId: string;
      streamId: string | null;
      rollNumber: number | string | null;
      admissionNo: string;
      fullName: string;
      className: string;
      section: string;
      subjectsRaw: string | null;
    }

    const prepared: PreparedStudent[] = [];

    // When the sheet carries the derived "Indian National?" column, a "No"
    // answer must not clobber an already-stored specific nationality (e.g.
    // "American"). buildStudentRecord needs the current row to make that call,
    // so pre-load nationality for the admission numbers in this upload.
    const nationalityRelevant = recordKeys.includes("indian_national");
    const existingByAdmNo = new Map<string, Record<string, unknown>>();
    if (nationalityRelevant) {
      const admissionNos = students
        .map((s) => s.admission_no?.trim())
        .filter((n): n is string => Boolean(n));
      for (let i = 0; i < admissionNos.length; i += 200) {
        const chunk = admissionNos.slice(i, i + 200);
        const { data: existingNat } = await admin
          .from("students")
          .select("admission_no, nationality")
          .in("admission_no", chunk);
        for (const row of existingNat ?? []) {
          existingByAdmNo.set(String(row.admission_no).trim(), row);
        }
      }
    }

    for (const s of students) {
      const name = s.class_name.trim();
      const section = (s.section || "A").trim();
      const stream = s.stream?.trim().toLowerCase() || "";
      const resolvedStreamId = SENIOR_CLASSES.includes(name) && stream ? (streamMap.get(stream) || null) : null;
      const key = classKey(name, section, resolvedStreamId);
      const classId = classMap.get(key);

      if (!classId) {
        const label = resolvedStreamId ? `${name} - ${section} (${s.stream?.trim()})` : `${name} - ${section}`;
        errors.push({
          admission_no: s.admission_no,
          full_name: s.full_name,
          class_name: s.class_name,
          section: s.section || "A",
          error: `Class "${label}" not found.`,
        });
        continue;
      }

      // Only sheet-provided columns are written (column projection above).
      const record = buildStudentRecord(
        s as Record<string, unknown>,
        recordKeys,
        existingByAdmNo.get(s.admission_no.trim())
      );
      // Defensive: a malformed date must never fail a whole upsert batch.
      for (const dateKey of ["date_of_birth", "admission_date"] as const) {
        if (
          dateKey in record &&
          record[dateKey] !== null &&
          !/^\d{4}-\d{2}-\d{2}$/.test(String(record[dateKey]))
        ) {
          record[dateKey] = null;
        }
      }

      prepared.push({
        record,
        classId,
        streamId: resolvedStreamId,
        rollNumber: s.roll_number || null,
        admissionNo: s.admission_no.trim(),
        fullName: s.full_name.trim(),
        className: s.class_name,
        section,
        subjectsRaw: subjectsProvided ? (s.subjects?.trim() || null) : null,
      });
    }

    // ── Phase 2: Bulk upsert students in batches ──
    let inserted = 0;
    let created = 0;
    let updated = 0;
    const BATCH_SIZE = 100;
    // class_id → its class_subjects (id + matchable subject tokens), cached
    // across batches for the Subjects column resolution.
    const classSubjectsCache = new Map<
      string,
      { id: string; tokens: string[]; name: string }[]
    >();

    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
      const batch = prepared.slice(i, i + BATCH_SIZE);
      const records = batch.map((p) => p.record);

      // Split the batch into creates vs updates for accurate result counts
      // (upsert alone can't tell us which rows already existed).
      const { data: existingRows } = await admin
        .from("students")
        .select("admission_no")
        .in("admission_no", batch.map((p) => p.admissionNo));
      const existingAdmNos = new Set(
        (existingRows || []).map((r) => String(r.admission_no).trim())
      );

      const { data: upsertedRows, error: batchError } = await admin
        .from("students")
        .upsert(records, { onConflict: "admission_no" })
        .select("id, admission_no");

      if (batchError) {
        console.error("[students.bulk.POST] batch upsert:", batchError);
        // If the whole batch fails, record errors for all students in the batch
        for (const p of batch) {
          errors.push({
            admission_no: p.admissionNo,
            full_name: p.fullName,
            class_name: p.className,
            section: p.section,
            error:
              batchError.code === "23505"
                ? "Duplicate admission number"
                : "Student upsert failed",
          });
        }
        continue;
      }

      if (!upsertedRows || upsertedRows.length === 0) {
        for (const p of batch) {
          errors.push({
            admission_no: p.admissionNo,
            full_name: p.fullName,
            class_name: p.className,
            section: p.section,
            error: "Student upsert returned no data",
          });
        }
        continue;
      }

      // Map admission_no -> student id for enrollment
      const admToId = new Map<string, string>();
      for (const row of upsertedRows) {
        admToId.set(String(row.admission_no).trim(), row.id);
        if (existingAdmNos.has(String(row.admission_no).trim())) updated++;
        else created++;
      }

      // Build enrollment records for successfully upserted students
      const enrollmentRecords: Record<string, unknown>[] = [];
      const enrollmentStudents: PreparedStudent[] = [];

      for (const p of batch) {
        const studentId = admToId.get(p.admissionNo);
        if (!studentId) {
          errors.push({
            admission_no: p.admissionNo,
            full_name: p.fullName,
            class_name: p.className,
            section: p.section,
            error: "Student record not found after upsert",
          });
          continue;
        }

        enrollmentRecords.push({
          student_id: studentId,
          class_id: p.classId,
          academic_year_id: currentYear.id,
          stream_id: p.streamId || null,
          roll_number: p.rollNumber,
        });
        enrollmentStudents.push(p);
      }

      // Bulk upsert enrollments
      if (enrollmentRecords.length > 0) {
        const { error: enrollError } = await admin
          .from("student_enrollments")
          .upsert(enrollmentRecords, { onConflict: "student_id,class_id" });

        if (enrollError) {
          // Batch enrollment failed — fall back to one-at-a-time to identify which ones fail
          for (let j = 0; j < enrollmentRecords.length; j++) {
            const { error: singleError } = await admin
              .from("student_enrollments")
              .upsert(enrollmentRecords[j], { onConflict: "student_id,class_id" });

            if (singleError) {
              console.error("[students.bulk.POST] enrollment upsert:", singleError);
              errors.push({
                admission_no: enrollmentStudents[j].admissionNo,
                full_name: enrollmentStudents[j].fullName,
                class_name: enrollmentStudents[j].className,
                section: enrollmentStudents[j].section,
                error: "Enrollment failed",
              });
            } else {
              inserted++;
            }
          }
        } else {
          inserted += enrollmentRecords.length;
        }
      }

      // ── Subjects column resolution (replace semantics) ──
      // A non-blank Subjects cell is authoritative for that student: their
      // student_subjects set is replaced with the matched class subjects.
      // A blank or absent cell leaves existing subject links untouched.
      const withSubjects = batch.filter(
        (p) => p.subjectsRaw && admToId.has(p.admissionNo)
      );
      if (withSubjects.length > 0) {
        // Load class_subjects for classes we haven't seen yet.
        const neededClassIds = Array.from(
          new Set(withSubjects.map((p) => p.classId))
        ).filter((id) => !classSubjectsCache.has(id));
        if (neededClassIds.length > 0) {
          const { data: csRows, error: csError } = await admin
            .from("class_subjects")
            .select("id, class_id, subjects:subject_id(name, nickname)")
            .in("class_id", neededClassIds);
          if (csError) {
            console.error("[students.bulk.POST] class_subjects load:", csError);
          }
          for (const id of neededClassIds) classSubjectsCache.set(id, []);
          for (const row of csRows || []) {
            const subject = row.subjects as unknown as {
              name: string;
              nickname: string | null;
            } | null;
            if (!subject) continue;
            const tokens = [normalizeToken(subject.name)];
            if (subject.nickname) tokens.push(normalizeToken(subject.nickname));
            classSubjectsCache
              .get(row.class_id as string)!
              .push({ id: row.id as string, tokens, name: subject.name });
          }
        }

        // Match every student's Subjects cell first (pure, no I/O), then apply
        // the replacements in TWO batched queries — one delete + one insert per
        // 100-row batch — instead of a delete+insert pair per student, which on
        // a 500-row chunk was ~1000 sequential roundtrips and could blow the
        // route's 120s budget. Per-student error attribution on the write is
        // traded for the batching; the matching warnings below stay per-student.
        const toReplace: { p: PreparedStudent; studentId: string; matchedIds: string[] }[] = [];
        for (const p of withSubjects) {
          const studentId = admToId.get(p.admissionNo)!;
          const available = classSubjectsCache.get(p.classId) || [];
          const requested = (p.subjectsRaw as string)
            .split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean);
          const matchedIds: string[] = [];
          const unmatched: string[] = [];
          for (const token of requested) {
            const norm = normalizeToken(token);
            const hit = available.find((cs) => cs.tokens.includes(norm));
            if (hit) {
              if (!matchedIds.includes(hit.id)) matchedIds.push(hit.id);
            } else {
              unmatched.push(token);
            }
          }
          if (unmatched.length > 0) {
            warnings.push({
              admission_no: p.admissionNo,
              full_name: p.fullName,
              warning:
                available.length === 0
                  ? `Class ${p.className}-${p.section} has no subjects assigned yet — assign class subjects, then re-upload the Subjects column.`
                  : `Subject${unmatched.length === 1 ? "" : "s"} not found for ${p.className}-${p.section}: ${unmatched.join(", ")}`,
            });
          }
          if (matchedIds.length === 0) continue;
          toReplace.push({ p, studentId, matchedIds });
        }

        let replacedStudentIds: string[] = [];
        if (toReplace.length > 0) {
          const targetIds = toReplace.map((t) => t.studentId);
          const { error: delError } = await admin
            .from("student_subjects")
            .delete()
            .in("student_id", targetIds);
          if (delError) {
            console.error("[students.bulk.POST] student_subjects delete:", delError);
            for (const t of toReplace) {
              warnings.push({
                admission_no: t.p.admissionNo,
                full_name: t.p.fullName,
                warning: "Failed to update subject links",
              });
            }
          } else {
            const insertRows = toReplace.flatMap((t) =>
              t.matchedIds.map((id) => ({ student_id: t.studentId, class_subject_id: id }))
            );
            const { error: insError } = await admin
              .from("student_subjects")
              .insert(insertRows);
            if (insError) {
              console.error("[students.bulk.POST] student_subjects insert:", insError);
              for (const t of toReplace) {
                warnings.push({
                  admission_no: t.p.admissionNo,
                  full_name: t.p.fullName,
                  warning: "Failed to save subject links",
                });
              }
            } else {
              replacedStudentIds = targetIds;
            }
          }
        }

        // The sheet wins over in-app elective picks — surface when a replaced
        // student had picks so admins know to reconcile. The picks table may
        // not exist in every environment; ignore lookup failures.
        if (replacedStudentIds.length > 0) {
          const { data: picks } = await admin
            .from("student_elective_picks")
            .select("student_id")
            .in("student_id", replacedStudentIds);
          if (picks && picks.length > 0) {
            const pickIds = new Set(picks.map((r) => r.student_id as string));
            for (const p of withSubjects) {
              const sid = admToId.get(p.admissionNo);
              if (sid && pickIds.has(sid)) {
                warnings.push({
                  admission_no: p.admissionNo,
                  full_name: p.fullName,
                  warning:
                    "Subjects replaced from the sheet, but this student also has in-app elective picks — review their electives.",
                });
              }
            }
          }
        }
      }
    }

    // Nothing inserted + at least one error = total failure; don't let a caller
    // that only checks res.ok mistake it for success.
    const allFailed = inserted === 0 && errors.length > 0;
    return NextResponse.json(
      {
        success: !allFailed,
        ...(allFailed ? { error: "No students were imported — every row failed." } : {}),
        inserted,
        created,
        updated,
        classesCreated,
        errors,
        warnings,
        total: students.length,
      },
      { status: allFailed ? 400 : 200 }
    );
  } catch (err) {
    console.error("Bulk student upload error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
