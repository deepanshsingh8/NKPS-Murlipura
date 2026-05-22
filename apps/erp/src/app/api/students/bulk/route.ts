import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { studentBulkUploadSchema } from "@nkps/shared/lib/validations";

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
    }

    const prepared: PreparedStudent[] = [];

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

      let dob: string | null = s.date_of_birth?.trim() || null;
      if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        dob = null;
      }

      prepared.push({
        record: {
          admission_no: s.admission_no.trim(),
          full_name: s.full_name.trim(),
          father_name: s.father_name?.trim() || null,
          mother_name: s.mother_name?.trim() || null,
          date_of_birth: dob,
          gender: s.gender || null,
          phone: s.phone?.trim() || null,
          address: s.address?.trim() || null,
          email: s.email?.trim() || null,
          blood_group: s.blood_group?.trim() || null,
          category: s.category?.trim() || null,
          aadhar_number: s.aadhar_number?.trim() || null,
          previous_school: s.previous_school?.trim() || null,
        },
        classId,
        streamId: resolvedStreamId,
        rollNumber: s.roll_number || null,
        admissionNo: s.admission_no.trim(),
        fullName: s.full_name.trim(),
        className: s.class_name,
        section,
      });
    }

    // ── Phase 2: Bulk upsert students in batches ──
    let inserted = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
      const batch = prepared.slice(i, i + BATCH_SIZE);
      const records = batch.map((p) => p.record);

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
    }

    return NextResponse.json({
      success: true,
      inserted,
      classesCreated,
      errors,
      total: students.length,
    });
  } catch (err) {
    console.error("Bulk student upload error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
