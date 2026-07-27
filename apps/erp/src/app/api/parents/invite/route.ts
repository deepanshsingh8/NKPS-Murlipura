import { NextResponse } from "next/server";
import { verifyAdminWithUser } from "@nkps/shared/lib/verify-admin";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { createPortalUser } from "@nkps/shared/lib/create-portal-user";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import { ensureParentRecord, linkParentToStudentRecord } from "@/lib/identity/link";
import { z } from "zod";

// Admin-initiated "invite a guardian for THIS student" — the guaranteed-link
// path. Unlike self-registration (which can dead-end with an unlinked parent),
// this creates the parent portal account AND the student_parents link in one
// shot, so the parent can never land unlinked.
const inviteSchema = z.object({
  student_id: z.string().uuid(),
  full_name: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().optional().or(z.literal("")),
  relationship: z.enum(["father", "mother", "guardian"]),
});

export async function POST(request: Request) {
  const auth = await verifyAdminWithUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user } = auth;

  const limit = rateLimit({
    name: "parent-invite",
    key: user.id,
    max: 30,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many invites this hour. Try again in ${Math.ceil(limit.resetSeconds / 60)} minute(s).` },
      { status: 429 }
    );
  }

  const parsed = inviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { student_id, full_name, email, phone, relationship } = parsed.data;

  const admin = createAdminClient();

  // Confirm the student exists before creating an account for nothing.
  const { data: student } = await admin
    .from("students")
    .select("id, full_name, admission_no")
    .eq("id", student_id)
    .maybeSingle();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Provision the parents record FIRST, so the portal account can be created
  // with role='parent' + parent_id set atomically. Doing it in this order means
  // the account is a fully-formed parent before the welcome email goes out —
  // it can never be stranded at the role='student' signup default if a later
  // step fails.
  const parent = await ensureParentRecord(admin, {
    email,
    fullName: full_name,
    phone,
  });
  if ("error" in parent) {
    return NextResponse.json({ error: parent.error }, { status: parent.status });
  }

  // Create the parent portal account already linked to the parents row, so
  // createPortalUser sets role='parent' (not the 'student' fallback it uses
  // when no link id is supplied).
  const created = await createPortalUser({
    email,
    fullName: full_name,
    role: "parent",
    phone: phone || null,
    parentId: parent.parentId,
  });
  if (!created.success || !created.userId) {
    return NextResponse.json(
      { error: created.error || "Failed to create the parent account." },
      { status: 400 }
    );
  }

  // Only the student_parents junction remains — idempotent, low-risk.
  const linked = await linkParentToStudentRecord(admin, {
    studentId: student_id,
    parentId: parent.parentId,
    relationship,
  });
  if (!linked.ok) {
    // The account is a valid parent (role + parent_id set); only the ward link
    // failed. Surface so the admin can finish it via the "Link record" tool.
    return NextResponse.json(
      {
        success: true,
        user_id: created.userId,
        link_warning: `Account created, but linking to ${student.full_name} failed: ${linked.error} Use the "Link record" tool.`,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    success: true,
    user_id: created.userId,
    linked: { student_name: student.full_name, admission_no: student.admission_no, relationship },
  });
}
