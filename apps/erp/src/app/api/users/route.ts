import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { createUserSchema } from "@nkps/shared/lib/validations";
import { generateSecurePassword } from "@nkps/shared/lib/password";
import { rateLimit } from "@nkps/shared/lib/rate-limit";

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

    // M4 — defense-in-depth. The route already requires admin, but creating an
    // auth user + sending a welcome email is a costly side effect; a future
    // regression that lowers the gate would expose unbounded user creation.
    const limit = rateLimit({
      name: "erp-users-create",
      key: user.id,
      max: 30,
      windowSeconds: 3600,
    });
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: `Too many users created in the last hour. Try again in ${Math.ceil(
            limit.resetSeconds / 60
          )} minute(s).`,
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const result = createUserSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { full_name, email, phone, role } = result.data;

    // Generate a cryptographically secure default password
    const password = body.password || generateSecurePassword();

    const supabase = createAdminClient();

    const { data: newUser, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    });

    if (error) {
      console.error("Create user error:", error);
      return NextResponse.json(
        { error: "Failed to create user" },
        { status: 500 }
      );
    }

    // Update the profile: set phone and flag for forced password change
    if (newUser.user) {
      await supabase
        .from("profiles")
        .update({
          phone: phone || null,
          must_change_password: true,
        })
        .eq("id", newUser.user.id);
    }

    // For student role: create a students record and link it to the profile
    if (role === "student" && newUser.user) {
      const { data: studentRecord, error: studentError } = await supabase
        .from("students")
        .insert({
          admission_no: email.split("@")[0], // default admission_no from email prefix
          full_name,
          email,
          phone: phone || null,
        })
        .select("id")
        .single();

      if (!studentError && studentRecord) {
        // Link the profile to the student record
        await supabase
          .from("profiles")
          .update({ student_id: studentRecord.id })
          .eq("id", newUser.user.id);
      } else {
        console.error("Failed to create student record:", studentError);
      }
    }

    // For teacher role: create a teachers record and link it to the profile,
    // plus a matching staff_members row so the public staff listing is in
    // sync from day one (M23). Failures on either side are non-fatal — the
    // auth user + profile already exist and the admin can fix data later.
    if (role === "teacher" && newUser.user) {
      // Auto-generate employee_id: "TCH-" + timestamp suffix
      const employeeId = `TCH-${Date.now().toString(36).toUpperCase()}`;

      // Create the staff_members row first so we can link the teacher to it.
      // Default category 'tgt' is the most common ERP teacher slot — admin
      // can recategorize on the staff page afterwards.
      let staffMemberId: string | null = null;
      const { data: staffRecord, error: staffError } = await supabase
        .from("staff_members")
        .insert({
          name: full_name,
          subject: "—",
          category: "tgt",
          email: email || null,
          phone: phone || null,
        })
        .select("id")
        .single();
      if (!staffError && staffRecord) {
        staffMemberId = staffRecord.id as string;
      } else if (staffError) {
        console.error("Failed to create staff_members shadow:", staffError);
      }

      const { data: teacherRecord, error: teacherError } = await supabase
        .from("teachers")
        .insert({
          employee_id: employeeId,
          full_name,
          email,
          phone: phone || null,
          staff_member_id: staffMemberId,
        })
        .select("id")
        .single();

      if (!teacherError && teacherRecord) {
        await supabase
          .from("profiles")
          .update({ teacher_id: teacherRecord.id })
          .eq("id", newUser.user.id);
      } else {
        console.error("Failed to create teacher record:", teacherError);
      }
    }

    // For parent role: create a parents record and link it to the profile
    if (role === "parent" && newUser.user) {
      const { data: parentRecord, error: parentError } = await supabase
        .from("parents")
        .insert({
          full_name,
          email,
          phone: phone || "N/A",
          relationship: "guardian", // default; can be updated later
        })
        .select("id")
        .single();

      if (!parentError && parentRecord) {
        await supabase
          .from("profiles")
          .update({ parent_id: parentRecord.id })
          .eq("id", newUser.user.id);
      } else {
        console.error("Failed to create parent record:", parentError);
      }
    }

    // Send welcome email with credentials. We don't abort user creation if
    // this fails, but we DO surface the failure so the admin knows to share
    // the credentials manually (otherwise the new user can never log in).
    let emailWarning: string | null = null;
    try {
      const { sendEmail, buildWelcomeEmail } = await import("@nkps/shared/lib/email");
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
        "Welcome to NKPS Portal — Your Login Details Inside",
        html
      );
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
      emailWarning =
        emailError instanceof Error
          ? `Welcome email not sent: ${emailError.message}. Please share the temporary password with the user manually.`
          : "Welcome email not sent. Please share the temporary password with the user manually.";
    }

    // L16 — when we auto-create a teachers + staff_members shadow row, the
    // staff side defaults to category 'tgt' and subject '—'. Surface a
    // notice so the admin remembers to recategorize on /people/staff.
    const staffNotice =
      role === "teacher"
        ? "A staff_members entry was auto-created with default category 'tgt' and subject '—'. Visit /people/staff to recategorize."
        : null;

    return NextResponse.json({
      success: true,
      user: newUser.user,
      email_warning: emailWarning,
      staff_notice: staffNotice,
      ...(emailWarning ? { generated_password: password } : {}),
    });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
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

    const { id, role } = await request.json();

    if (!id || !role) {
      return NextResponse.json(
        { error: "User id and role are required" },
        { status: 400 }
      );
    }

    const validRoles = ["admin", "staff", "teacher", "student", "parent"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: "Invalid role" },
        { status: 400 }
      );
    }

    // Prevent changing own role
    if (id === user.id) {
      return NextResponse.json(
        { error: "You cannot change your own role" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { error } = await supabase
      .from("profiles")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Update role error:", error);
      return NextResponse.json(
        { error: "Failed to update role" },
        { status: 500 }
      );
    }

    // Editor capability is only valid for staff/teacher (and admin, which
    // bypasses the table). When the new role can't hold capability, drop any
    // stale grants so a future re-promotion doesn't reinstate the old set.
    if (role === "admin" || role === "student" || role === "parent") {
      await supabase
        .from("editor_permissions")
        .delete()
        .eq("editor_id", id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Update role error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
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

    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "User id required" }, { status: 400 });
    }

    // Prevent self-deletion
    if (id === user.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Check for linked entity records
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, student_id, teacher_id, parent_id")
      .eq("id", id)
      .single();

    // Delete linked students record if exists
    if (profile?.student_id) {
      await supabase.from("students").delete().eq("id", profile.student_id);
    }

    // Delete linked teachers record if exists. Cascade to the linked
    // staff_members row too so the public staff listing reflects the change
    // — if the admin wants to keep the public listing entry as a non-portal
    // staff record, they should unlink the teacher from staff first.
    if (profile?.teacher_id) {
      const { data: teacherRow } = await supabase
        .from("teachers")
        .select("staff_member_id")
        .eq("id", profile.teacher_id)
        .maybeSingle();
      await supabase.from("teachers").delete().eq("id", profile.teacher_id);
      if (teacherRow?.staff_member_id) {
        await supabase
          .from("staff_members")
          .delete()
          .eq("id", teacherRow.staff_member_id);
      }
    }

    // Delete linked parents record if exists
    if (profile?.parent_id) {
      await supabase.from("parents").delete().eq("id", profile.parent_id);
    }

    // Delete the auth user (this cascades to profiles via Supabase's built-in
    // trigger). If another table still has a NOT-NULL / RESTRICT FK to
    // profiles(id), Postgres aborts the cascade and the auth-user deletion
    // fails with a 23503 foreign_key_violation. Surface the actual message
    // so admins see what's blocking instead of a generic "Failed to delete".
    const { error } = await supabase.auth.admin.deleteUser(id);

    if (error) {
      console.error("Delete user error:", error);
      const raw = error.message ?? "";
      const isFkViolation =
        raw.toLowerCase().includes("foreign key") ||
        raw.toLowerCase().includes("violates");
      return NextResponse.json(
        {
          error: isFkViolation
            ? `Cannot delete user: this account is still referenced by other records (${raw}). Run migration 027 if you haven't already.`
            : raw || "Failed to delete user",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete user error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
