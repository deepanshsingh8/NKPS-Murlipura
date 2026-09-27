import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { linkSelfStudentSchema } from "@nkps/shared/lib/validations";
import { rateLimit, clientIp } from "@nkps/shared/lib/rate-limit";
import { linkProfileToStudent } from "@/lib/identity/link";
import {
  findStudentByAdmissionNo,
  isSameDateOfBirth,
  normalizeAdmissionNo,
} from "@/lib/identity/student-lookup";

// A student claiming their own record at first login. Mirrors the parent
// link-child verification (admission number + date of birth) but writes
// profiles.student_id. Only links when the account isn't already linked, so a
// student can't repoint their login at another student's record.
export async function POST(request: Request) {
  try {
    const serverSupabase = await createClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await serverSupabase
      .from("profiles")
      .select("role, student_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "student") {
      return NextResponse.json(
        { error: "Forbidden: student access required" },
        { status: 403 }
      );
    }
    if (profile.student_id) {
      return NextResponse.json(
        { error: "Your account is already linked to a student record." },
        { status: 409 }
      );
    }

    // Validated first, so a half-filled form never spends rate-limit budget
    // (see link-child — same reasoning, same flow).
    const body = await request.json();
    const result = linkSelfStudentSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { admission_no, date_of_birth } = result.data;

    // Rate-limit by user and IP to stop a stolen account from brute-forcing
    // admission_no/DOB pairs against the directory.
    const userLimit = rateLimit({
      name: "link-self:user",
      key: user.id,
      max: 10,
      windowSeconds: 30 * 60,
    });
    if (!userLimit.ok) {
      return NextResponse.json(
        {
          error: `Too many attempts. Please wait ${Math.ceil(
            userLimit.resetSeconds / 60
          )} minute(s) and try again, or contact the school office.`,
        },
        { status: 429 }
      );
    }
    const ipLimit = rateLimit({
      name: "link-self:ip",
      key: clientIp(request),
      max: 20,
      windowSeconds: 30 * 60,
    });
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }

    const admin = createAdminClient();

    const student = await findStudentByAdmissionNo<{
      id: string;
      date_of_birth: string | null;
      full_name: string;
      admission_no: string;
      is_active: boolean | null;
    }>(admin, admission_no, "id, date_of_birth, full_name, admission_no, is_active");

    // Collapse "no such admission no" and "DOB mismatch" into one generic
    // message so the admission_no space can't be enumerated. Each branch logs
    // the real reason, which the student never sees.
    const verifyFailed = NextResponse.json(
      {
        error:
          "We couldn't verify a student with those details. Double-check the admission number and date of birth, then try again.",
      },
      { status: 400 }
    );
    if (!student) {
      console.warn(
        `[link-self] no student matches admission_no=${normalizeAdmissionNo(admission_no)}`
      );
      return verifyFailed;
    }
    if (!student.date_of_birth) {
      return NextResponse.json(
        {
          error:
            "This student's date of birth has not been recorded yet. Please contact the school administration.",
        },
        { status: 422 }
      );
    }
    if (!isSameDateOfBirth(student.date_of_birth, date_of_birth)) {
      console.warn(
        `[link-self] date of birth does not match for admission_no=${student.admission_no}`
      );
      return verifyFailed;
    }
    // Only after the date of birth matched — see link-child.
    if (student.is_active === false) {
      return NextResponse.json(
        {
          error:
            "This student record is no longer active at the school. Please contact the school office.",
        },
        { status: 409 }
      );
    }

    // Canonical service: claim-checks 1:1, sets role+student_id, idempotent.
    const linked = await linkProfileToStudent(admin, user.id, student.id);
    if (!linked.ok) {
      // Re-map the generic conflict to the student-facing "contact admin" copy.
      const message =
        linked.status === 409
          ? "This student record is already connected to another account. Please contact the school administration."
          : "Failed to connect your account. Please try again.";
      return NextResponse.json({ error: message }, { status: linked.status });
    }

    return NextResponse.json({
      success: true,
      student: { full_name: student.full_name, admission_no: student.admission_no },
    });
  } catch (err) {
    console.error("link-self error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
