import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("transfer_certificates");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { url, studentName, academicYear, admissionNo, studentId } =
      await request.json();

    if (!url || !studentName || !academicYear || !admissionNo || !studentId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (typeof studentId !== "string" || !UUID_RE.test(studentId)) {
      return NextResponse.json(
        { error: "A linked student is required" },
        { status: 400 }
      );
    }

    // Match the TC against the live student record before persisting it.
    // We require a linked student so the public lookup (admission_no + DOB)
    // is always answerable from authoritative data, and so a typo at upload
    // can never quietly issue a TC under the wrong identity.
    const { data: student, error: studentErr } = await admin
      .from("students")
      .select("id, full_name, admission_no, date_of_birth")
      .eq("id", studentId)
      .maybeSingle();

    if (studentErr || !student) {
      return NextResponse.json(
        { error: "Linked student not found" },
        { status: 400 }
      );
    }

    if (!student.date_of_birth) {
      return NextResponse.json(
        {
          error:
            "Student has no date of birth on file. Update the student record before uploading the TC.",
        },
        { status: 400 }
      );
    }

    if (
      String(admissionNo).trim() !== String(student.admission_no).trim()
    ) {
      return NextResponse.json(
        { error: "Admission number does not match the linked student" },
        { status: 400 }
      );
    }

    if (normalizeName(String(studentName)) !== normalizeName(student.full_name)) {
      return NextResponse.json(
        { error: "Student name does not match the linked student" },
        { status: 400 }
      );
    }

    // Resolve the student's most recent active enrollment so we can both
    // record the class on the TC (used by the public lookup card) and
    // terminate the enrollment after a successful insert.
    const { data: enrollment } = await admin
      .from("student_enrollments")
      .select("id, status, class_id, classes(name, section)")
      .eq("student_id", studentId)
      .eq("status", "active")
      .order("enrollment_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const activeEnrollmentId: string | null = enrollment?.id ?? null;
    const enrollmentClass = enrollment?.classes as
      | { name: string; section: string }
      | { name: string; section: string }[]
      | null
      | undefined;
    const classRecord = Array.isArray(enrollmentClass)
      ? enrollmentClass[0] ?? null
      : enrollmentClass ?? null;
    const classLastAttended = classRecord
      ? `${classRecord.name}${classRecord.section ? ` ${classRecord.section}` : ""}`
      : null;

    const { error: insertError } = await admin
      .from("transfer_certificates")
      .insert({
        student_id: studentId,
        student_name: student.full_name,
        admission_no: student.admission_no,
        student_dob: student.date_of_birth,
        class_last_attended: classLastAttended,
        file_url: url,
        academic_year: academicYear,
        upload_date: new Date().toISOString().split("T")[0],
      });

    if (insertError) {
      console.error("TC DB insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to save certificate record" },
        { status: 500 }
      );
    }

    // TC saved. Close the student record: mark inactive + terminate the
    // active enrollment. Failures here are logged but don't fail the
    // request — admin can re-run status update from the students page.
    let studentClosed = false;
    const { error: studentUpdateErr } = await admin
      .from("students")
      .update({ is_active: false })
      .eq("id", studentId);

    if (studentUpdateErr) {
      console.error("TC: failed to mark student inactive:", studentUpdateErr);
    } else if (activeEnrollmentId) {
      const { error: enrollmentErr } = await admin
        .from("student_enrollments")
        .update({ status: "terminated" })
        .eq("id", activeEnrollmentId);
      if (enrollmentErr) {
        console.error("TC: failed to terminate enrollment:", enrollmentErr);
      } else {
        studentClosed = true;
      }
    } else {
      studentClosed = true;
    }

    return NextResponse.json({ success: true, studentClosed });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await verifyAdminOrEditor("transfer_certificates");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, fileUrl } = await request.json();

    const urlParts = (fileUrl as string).split("/");
    const fileName = urlParts[urlParts.length - 1];

    await admin.storage.from("transfer-certificates").remove([fileName]);

    const { error } = await admin
      .from("transfer_certificates")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("TC delete DB error:", error);
      return NextResponse.json({ error: "Failed to delete certificate" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
