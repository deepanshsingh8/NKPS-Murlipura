import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { generateSecurePassword } from "@nkps/shared/lib/password";

interface CreatePortalUserParams {
  email: string;
  fullName: string;
  role: "teacher" | "student" | "parent" | "staff";
  phone?: string | null;
  teacherId?: string | null;
  studentId?: string | null;
  parentId?: string | null;
}

interface CreatePortalUserResult {
  success: boolean;
  userId?: string;
  error?: string;
}

export async function createPortalUser({
  email,
  fullName,
  role,
  phone,
  teacherId,
  studentId,
  parentId,
}: CreatePortalUserParams): Promise<CreatePortalUserResult> {
  const supabase = createAdminClient();

  const { data: existingUsers } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (existingUsers && existingUsers.length > 0) {
    return { success: false, error: "User with this email already exists" };
  }

  // Validate the role↔link requirement BEFORE creating the auth user, so a
  // caller that asks for a linked role without supplying the link fails cleanly
  // instead of leaving an orphaned auth user or (as the old code did) silently
  // downgrading the account to 'student'. The migration-068 trigger requires
  // teacher_id for role='teacher' and parent_id for role='parent'; 'student'
  // may be unlinked and 'staff'/'admin' carry no domain link.
  if (role === "teacher" && !teacherId) {
    return {
      success: false,
      error: "A linked teacher record is required to create a teacher login.",
    };
  }
  if (role === "parent" && !parentId) {
    return {
      success: false,
      error: "A linked parent record is required to create a parent login.",
    };
  }

  const password = generateSecurePassword();

  const { data: newUser, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });

  if (error) {
    console.error(`Failed to create ${role} user for ${email}:`, error);
    return { success: false, error: error.message };
  }

  if (newUser.user) {
    // role + its matching link column go in ONE update to satisfy the
    // enforce_profile_role_link trigger (migration 068). The required links
    // were already validated above, so we can trust `role` here and write only
    // the link column that role is allowed to hold — every other link stays
    // null. (Previously this derived role from whichever link id was supplied
    // and fell through to 'student' when none was, which is exactly how a
    // staff-create with no teacher link produced a bogus student account.)
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        role,
        phone: phone || null,
        must_change_password: true,
        teacher_id: role === "teacher" ? teacherId || null : null,
        student_id: role === "student" ? studentId || null : null,
        parent_id: role === "parent" ? parentId || null : null,
      })
      .eq("id", newUser.user.id);

    if (updateError) {
      // Don't leave a half-provisioned account or report false success. The
      // welcome email hasn't been sent yet, so roll the auth user back (a
      // retry then re-creates cleanly instead of hitting "already exists").
      console.error(`Failed to set role/link for ${email}:`, updateError);
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return { success: false, error: "Failed to finalize the portal account." };
    }
  }

  try {
    const { sendEmail, buildWelcomeEmail } = await import("@nkps/shared/lib/email");
    const { getErpUrl } = await import("@nkps/shared/lib/cross-app");
    const loginUrl = getErpUrl("/portal/login");
    const html = buildWelcomeEmail({
      fullName,
      email,
      password,
      loginUrl,
      role,
    });
    await sendEmail(email, "Your NKPS Portal Account", html);
  } catch (emailError) {
    console.error(`Failed to send welcome email to ${email}:`, emailError);
  }

  return { success: true, userId: newUser.user?.id };
}
