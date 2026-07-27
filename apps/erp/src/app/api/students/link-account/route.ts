import { NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";
import { linkProfileToStudent, linkParentAccountToStudent } from "@/lib/identity/link";

// Admin repair tool: connect an existing student/parent login to a student
// record by admission number. Fixes accounts that were created without a link
// (or linked to the wrong id). Admin-only — account↔record links are a
// privilege boundary, same as /admin users management.

// GET ?admission_no=... → resolve a student for the "verify before link" step.
export async function GET(request: Request) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admissionNo = new URL(request.url).searchParams.get("admission_no")?.trim();
  if (!admissionNo) {
    return NextResponse.json({ error: "admission_no is required" }, { status: 400 });
  }

  const { data: student } = await admin
    .from("students")
    .select("id, full_name, admission_no, is_active, student_enrollments(status, classes(name, section))")
    .eq("admission_no", admissionNo)
    .maybeSingle();

  if (!student) {
    return NextResponse.json({ found: false });
  }

  const enrollments = (student.student_enrollments as unknown as
    | { status: string; classes: { name: string; section: string } | null }[]
    | null) ?? [];
  const active = enrollments.find((e) => e.status === "active") ?? enrollments[0];
  const cls = active?.classes ?? null;

  return NextResponse.json({
    found: true,
    student: {
      full_name: student.full_name,
      admission_no: student.admission_no,
      is_active: student.is_active,
      class_label: cls ? `${cls.name} — ${cls.section}` : null,
    },
  });
}

const linkAccountSchema = z.object({
  profile_id: z.string().uuid(),
  admission_no: z.string().trim().min(1),
  relationship: z.enum(["father", "mother", "guardian"]).optional(),
});

export async function POST(request: Request) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = linkAccountSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { profile_id, admission_no, relationship } = parsed.data;

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, student_id, parent_id, full_name, email, phone")
    .eq("id", profile_id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (profile.role !== "student" && profile.role !== "parent") {
    return NextResponse.json(
      { error: "Only student or parent accounts can be linked to a student record." },
      { status: 400 }
    );
  }

  const { data: student } = await admin
    .from("students")
    .select("id, full_name, admission_no")
    .eq("admission_no", admission_no.trim())
    .maybeSingle();
  if (!student) {
    return NextResponse.json(
      { error: `No student found with admission number "${admission_no}".` },
      { status: 404 }
    );
  }

  // All linking goes through the canonical identity service: it sets `role`
  // alongside the link (fixing accounts stranded at role='student'), enforces
  // 1:1, and is idempotent. (migration 068 / Phase 1)
  if (profile.role === "student") {
    const linked = await linkProfileToStudent(admin, profile_id, student.id);
    if (!linked.ok) return NextResponse.json({ error: linked.error }, { status: linked.status });
    return NextResponse.json({
      success: true,
      alreadyLinked: linked.alreadyLinked,
      linked: { student_name: student.full_name, admission_no: student.admission_no },
    });
  }

  // ---- Parent account ----
  const linked = await linkParentAccountToStudent(admin, {
    profileId: profile_id,
    profile: { email: profile.email, fullName: profile.full_name, phone: profile.phone },
    studentId: student.id,
    relationship: relationship || "guardian",
  });
  if (!linked.ok) return NextResponse.json({ error: linked.error }, { status: linked.status });
  return NextResponse.json({
    success: true,
    alreadyLinked: linked.alreadyLinked,
    linked: { student_name: student.full_name, admission_no: student.admission_no },
  });
}
