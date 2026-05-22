import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { sendEmail, buildWelcomeEmail } from "@nkps/shared/lib/email";
import { generateSecurePassword } from "@nkps/shared/lib/password";
import { rateLimit } from "@nkps/shared/lib/rate-limit";

type AdminClient = ReturnType<typeof createAdminClient>;

async function isAdmissionNoTaken(
  supabase: AdminClient,
  candidate: string
): Promise<boolean> {
  const { data } = await supabase
    .from("students")
    .select("id")
    .eq("admission_no", candidate)
    .maybeSingle();
  return !!data;
}

// Pick a free admission number for a brand-new student approval. We try the
// email-localpart first (preserves the previous default for the common case)
// and fall back to a year-prefixed random tag if it's taken.
async function pickFreeAdmissionNo(
  supabase: AdminClient,
  email: string
): Promise<string> {
  const localPart = email.split("@")[0]?.replace(/[^A-Za-z0-9_-]/g, "") ?? "";
  if (localPart && !(await isAdmissionNoTaken(supabase, localPart))) {
    return localPart;
  }
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const candidate = `${year}-${suffix}`;
    if (!(await isAdmissionNoTaken(supabase, candidate))) return candidate;
  }
  // Extremely unlikely fallthrough — return a timestamp-based id which is
  // effectively unique and let the DB unique constraint be the final guard.
  return `${year}-${Date.now()}`;
}

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

    // For student role: create a students record and link it.
    // Admission numbers must be unique. The previous default of
    // `email.split("@")[0]` collides for any two `firstname@*` registrants —
    // try it first, then fall back to a year-prefixed timestamp+random suffix
    // until we find one nothing else is using.
    if (role === "student" && newUser.user) {
      const candidate = await pickFreeAdmissionNo(supabase, email);
      const { data: studentRecord, error: studentError } = await supabase
        .from("students")
        .insert({
          admission_no: candidate,
          full_name,
          email,
          phone: phone || null,
        })
        .select("id")
        .single();

      if (!studentError && studentRecord) {
        await supabase
          .from("profiles")
          .update({ student_id: studentRecord.id })
          .eq("id", newUser.user.id);
      } else {
        console.error("Failed to create student record:", studentError);
      }
    }

    // For parent role: create a parents record, link profile, and create student_parents junction
    if (role === "parent" && newUser.user) {
      const { data: parentRecord, error: parentError } = await supabase
        .from("parents")
        .insert({
          full_name,
          email,
          phone: phone || "",
          relationship: registration.relationship || "guardian",
        })
        .select("id")
        .single();

      if (!parentError && parentRecord) {
        await supabase
          .from("profiles")
          .update({ parent_id: parentRecord.id })
          .eq("id", newUser.user.id);

        // If student_admission_no was provided, look up the student and create the junction record
        if (registration.student_admission_no) {
          const { data: studentRecord } = await supabase
            .from("students")
            .select("id")
            .eq("admission_no", registration.student_admission_no)
            .single();

          if (studentRecord) {
            const { error: junctionError } = await supabase
              .from("student_parents")
              .insert({
                student_id: studentRecord.id,
                parent_id: parentRecord.id,
                relationship: registration.relationship || "guardian",
                is_primary_contact: true,
              });

            if (junctionError) {
              console.error("Failed to create student_parents link:", junctionError);
            }
          } else {
            console.error(
              "Student not found for admission_no:",
              registration.student_admission_no
            );
          }
        }
      } else {
        console.error("Failed to create parent record:", parentError);
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
    });
  } catch (err) {
    console.error("Approve registration error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
