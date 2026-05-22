import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { generateSecurePassword } from "@nkps/shared/lib/password";

interface CreatePortalUserParams {
  email: string;
  fullName: string;
  role: "teacher" | "student" | "parent";
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
    await supabase
      .from("profiles")
      .update({
        phone: phone || null,
        must_change_password: true,
        teacher_id: teacherId || null,
        student_id: studentId || null,
        parent_id: parentId || null,
      })
      .eq("id", newUser.user.id);
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
