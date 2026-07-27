import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { sendEmail, buildWelcomeEmail } from "@nkps/shared/lib/email";
import { generateSecurePassword } from "@nkps/shared/lib/password";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import {
  linkProfileToStudent,
  linkProfileToTeacher,
  linkProfileToParent,
  linkParentAccountToStudent,
  ensureParentRecord,
} from "@/lib/identity/link";
import { pickFreeAdmissionNo } from "@/lib/admission-no";

export async function POST(request: Request) {
  try {
    // Verify the caller is an admin
    const serverSupabase = await createClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!callerProfile || callerProfile.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: admin access required" },
        { status: 403 }
      );
    }

    // M4 — defense-in-depth (auth user creation + welcome email side effect).
    const limit = rateLimit({
      name: "registrations-approve",
      key: user.id,
      max: 30,
      windowSeconds: 3600,
    });
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: `Too many approvals in the last hour. Try again in ${Math.ceil(
            limit.resetSeconds / 60
          )} minute(s).`,
        },
        { status: 429 }
      );
    }

    const { id } = await request.json();
    if (!id) {
      return NextResponse.json(
        { error: "Registration request ID is required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Atomic claim: flip pending → approved in a single statement and use
    // the row that was actually returned. If two admins click "approve" at
    // the same time, only one gets a row back; the other returns null and
    // we bail out before any auth-user is created.
    const { data: claimed, error: claimError } = await supabase
      .from("registration_requests")
      .update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (claimError) {
      console.error("Approve claim error:", claimError);
      return NextResponse.json(
        { error: "Failed to claim registration request" },
        { status: 500 }
      );
    }
    if (!claimed) {
      // Either the id is unknown or another admin already claimed it.
      // Determine which so the UI can show a useful message.
      const { data: existing } = await supabase
        .from("registration_requests")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json(
          { error: "Registration request not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `This request has already been ${existing.status}` },
        { status: 409 }
      );
    }
    const registration = claimed;

    // Generate a cryptographically secure temporary password
    const password = generateSecurePassword();
    const { full_name, email, phone, role } = registration;

    // Create the Supabase auth user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    });

    if (createError) {
      console.error("Create user error:", createError);
      // Auth creation failed but we already claimed the row above. Revert
      // it to "pending" so an admin can retry — otherwise the request is
      // stranded in "approved" state with no auth user behind it.
      await supabase
        .from("registration_requests")
        .update({ status: "pending", reviewed_by: null, reviewed_at: null })
        .eq("id", id);
      return NextResponse.json(
        { error: "Failed to create user account" },
        { status: 500 }
      );
    }

    // Update profile with phone and forced password change
    if (newUser.user) {
      await supabase
        .from("profiles")
        .update({
          phone: phone || null,
          must_change_password: true,
        })
        .eq("id", newUser.user.id);
    }

    // Surfaced to the admin UI when a record link couldn't be fully made, so
    // they know to finish it via the "Link record" tool rather than assuming
    // the account is fully set up.
    let linkWarning: string | null = null;
    const userId = newUser.user?.id ?? null;

    // Role + domain-record wiring goes through the canonical identity service,
    // which ALWAYS sets `role` alongside the link in one update (handle_new_user
    // left it as 'student'), enforces 1:1, and is idempotent. (migration 068)
    if (userId && role === "student") {
      // Admission numbers must be unique. The previous default of
      // `email.split("@")[0]` collides for any two `firstname@*` registrants —
      // try it first, then fall back to a year-prefixed random suffix.
      const candidate = await pickFreeAdmissionNo(supabase, email);
      const { data: studentRecord, error: studentError } = await supabase
        .from("students")
        .insert({ admission_no: candidate, full_name, email, phone: phone || null })
        .select("id")
        .single();
      if (!studentError && studentRecord) {
        const linked = await linkProfileToStudent(supabase, userId, studentRecord.id);
        if (!linked.ok) linkWarning = `Account created, but linking the student record failed: ${linked.error}`;
      } else {
        console.error("Failed to create student record:", studentError);
        linkWarning = "Account created, but the student record could not be created. Use the \"Link record\" tool.";
      }
    } else if (userId && role === "teacher") {
      // Self-registered teacher: provision a teachers record, then link.
      const { randomBytes } = await import("crypto");
      const employeeId = `TCH-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
      const { data: teacherRecord, error: teacherError } = await supabase
        .from("teachers")
        .insert({ employee_id: employeeId, full_name, email, phone: phone || null })
        .select("id")
        .single();
      if (!teacherError && teacherRecord) {
        const linked = await linkProfileToTeacher(supabase, userId, teacherRecord.id);
        if (!linked.ok) linkWarning = `Account created, but linking the teacher record failed: ${linked.error}`;
      } else {
        console.error("Failed to create teacher record:", teacherError);
        linkWarning = "Account created, but the teacher record could not be created. Use the \"Link record\" tool.";
      }
    } else if (userId && role === "parent") {
      const relationship = (registration.relationship || "guardian") as
        | "father"
        | "mother"
        | "guardian";
      const profileInfo = { email, fullName: full_name, phone };

      // Resolve the child (if an admission number was given) up front.
      let studentId: string | null = null;
      if (registration.student_admission_no) {
        const { data: studentRecord } = await supabase
          .from("students")
          .select("id")
          .eq("admission_no", registration.student_admission_no)
          .maybeSingle();
        studentId = studentRecord?.id ?? null;
      }

      if (studentId) {
        const linked = await linkParentAccountToStudent(supabase, {
          profileId: userId,
          profile: profileInfo,
          studentId,
          relationship,
        });
        if (!linked.ok) {
          linkWarning = `Account created, but linking to the child failed: ${linked.error} Use the "Link record" tool.`;
        }
      } else {
        // No / unknown admission number: STILL set up the parent record and
        // role so the account lands on the parent dashboard and can "Add Child"
        // itself. (Previously the role was never set and the parent was stranded
        // on the student dashboard — the root cause of the linking failure.)
        const parent = await ensureParentRecord(supabase, profileInfo);
        if ("error" in parent) {
          linkWarning = "Account created, but the parent record could not be set up. Use the \"Link record\" tool.";
        } else {
          const linked = await linkProfileToParent(supabase, userId, parent.parentId);
          linkWarning = !linked.ok
            ? `Account created, but setting up the parent profile failed: ${linked.error}`
            : registration.student_admission_no
              ? `Account created, but no student matches admission no "${registration.student_admission_no}". ${full_name} can add the child from their dashboard, or link it via the "Link record" tool.`
              : `Account created without a child link (no admission number was provided). ${full_name} can add a child from their dashboard.`;
        }
      }
    }

    // (status already flipped at the top atomically; nothing else to do here.)

    // Send welcome email with credentials. Only fall back to returning the
    // password to the admin UI if email delivery failed — otherwise credentials
    // travel through the controlled email channel, not the API response.
    let emailDelivered = false;
    try {
      const { getErpUrl } = await import("@nkps/shared/lib/cross-app");
      const loginUrl = getErpUrl("/portal/login");
      const html = buildWelcomeEmail({
        fullName: full_name,
        email,
        password,
        loginUrl,
        role,
      });
      await sendEmail(
        email,
        "Your NKPS Portal Account is Approved — Login Details Inside",
        html
      );
      emailDelivered = true;
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
    }

    return NextResponse.json({
      success: true,
      user_id: newUser.user?.id ?? null,
      email,
      email_delivered: emailDelivered,
      ...(emailDelivered ? {} : { generated_password: password }),
      ...(linkWarning ? { link_warning: linkWarning } : {}),
    });
  } catch (err) {
    console.error("Approve registration error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
