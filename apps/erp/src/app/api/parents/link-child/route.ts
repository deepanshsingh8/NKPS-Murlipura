import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { linkChildSchema } from "@nkps/shared/lib/validations";
import { rateLimit, clientIp } from "@nkps/shared/lib/rate-limit";
import {
  ensureParentRecord,
  linkProfileToParent,
  linkParentToStudentRecord,
} from "@/lib/identity/link";
import {
  findStudentByAdmissionNo,
  isSameDateOfBirth,
  normalizeAdmissionNo,
} from "@/lib/identity/student-lookup";

const MAX_CHILDREN_PER_PARENT = 10;

export async function POST(request: Request) {
  try {
    // Authenticate the caller
    const serverSupabase = await createClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify caller is a parent with a linked parent record
    const { data: profile } = await serverSupabase
      .from("profiles")
      .select("role, parent_id, full_name, email, phone")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "parent") {
      return NextResponse.json(
        { error: "Forbidden: parent access required" },
        { status: 403 }
      );
    }

    // A verified parent should already have a linked `parents` row — migration
    // 068 prevents creating role='parent' without parent_id. Defensive fallback
    // for any pre-068 account that slipped through: provision + link via the
    // canonical service (find-or-create by email handles the duplicate-email
    // case that used to fail silently). The per-child relationship is captured
    // below in student_parents.
    let parentId = profile.parent_id as string | null;
    if (!parentId) {
      const heal = createAdminClient();
      const parent = await ensureParentRecord(heal, {
        email: profile.email,
        fullName: profile.full_name,
        phone: profile.phone,
      });
      if ("error" in parent) {
        return NextResponse.json(
          { error: "Parent profile not set up. Please contact the school administration." },
          { status: 403 }
        );
      }
      const linked = await linkProfileToParent(heal, user.id, parent.parentId);
      if (!linked.ok) {
        return NextResponse.json(
          { error: "Parent profile not set up. Please contact the school administration." },
          { status: 403 }
        );
      }
      parentId = parent.parentId;
    }

    // Provisioning above either resolved a parent id or returned; this guard
    // makes that invariant explicit (and narrows the type for the rest).
    if (!parentId) {
      return NextResponse.json(
        {
          error:
            "Parent profile not set up. Please contact the school administration.",
        },
        { status: 403 }
      );
    }

    // Validate the body BEFORE spending rate-limit budget. A malformed or
    // half-filled form never reached the student directory, so counting it as
    // an attempt only locked out parents who fumbled the form — the attacker
    // this limit exists for always sends a well-formed payload.
    const body = await request.json();
    const result = linkChildSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { admission_no, date_of_birth, relationship } = result.data;

    // Two-tier rate limit on the verification itself:
    //  - Per-parent: stops a stolen account from sweeping the directory.
    //  - Per-IP: stops account-rotation attempts from the same machine.
    // A family linking several siblings, with a typo or two along the way,
    // stays well inside it; guessing a date of birth does not.
    const parentLimit = rateLimit({
      name: "link-child:parent",
      key: parentId,
      max: 10,
      windowSeconds: 30 * 60,
    });
    if (!parentLimit.ok) {
      return NextResponse.json(
        {
          error: `Too many attempts. Please wait ${Math.ceil(
            parentLimit.resetSeconds / 60
          )} minute(s) before trying again, or contact the school office.`,
        },
        { status: 429 }
      );
    }
    const ipLimit = rateLimit({
      name: "link-child:ip",
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

    const supabase = createAdminClient();

    // Matched case-insensitively and whitespace-tolerantly: the admission
    // number is an identifier people retype off a diary or a fee slip, not the
    // secret. The date of birth below is the secret.
    const student = await findStudentByAdmissionNo<{
      id: string;
      date_of_birth: string | null;
      full_name: string;
      admission_no: string;
      photo_url: string | null;
      is_active: boolean | null;
    }>(
      supabase,
      admission_no,
      "id, date_of_birth, full_name, admission_no, photo_url, is_active"
    );

    // Audit H4: collapse "no such admission no" and "DOB mismatch" into a
    // single generic message so an attacker can't enumerate which
    // admission_nos exist by submitting a known-bad DOB. The "DOB missing"
    // branch stays distinct because that's genuinely a school-side data
    // gap the parent needs to be told about.
    //
    // Every branch that returns it logs which gate it was, because the parent
    // is told the same thing either way and the school otherwise has no way to
    // tell a wrong date of birth from a missing student.
    const verifyFailed = NextResponse.json(
      {
        error:
          "We couldn't verify a child with those details. Double-check the admission number and date of birth, then try again.",
      },
      { status: 400 }
    );
    if (!student) {
      console.warn(
        `[link-child] no student matches admission_no=${normalizeAdmissionNo(admission_no)}`
      );
      return verifyFailed;
    }
    if (!student.date_of_birth) {
      return NextResponse.json(
        {
          error:
            "This student's date of birth has not been recorded in the system. Please contact the school administration.",
        },
        { status: 422 }
      );
    }
    if (!isSameDateOfBirth(student.date_of_birth, date_of_birth)) {
      console.warn(
        `[link-child] date of birth does not match for admission_no=${student.admission_no}`
      );
      return verifyFailed;
    }

    // Checked only AFTER the date of birth matched. At that point the caller
    // has proved they know this child, so naming the real obstacle tells them
    // nothing they hadn't already established — and "we couldn't verify those
    // details" would have sent them round in circles re-typing correct ones.
    if (student.is_active === false) {
      console.warn(
        `[link-child] admission_no=${student.admission_no} verified but the student record is inactive`
      );
      return NextResponse.json(
        {
          error:
            "This student's record is no longer active at the school. Please contact the school office to have it reopened or linked for you.",
        },
        { status: 409 }
      );
    }

    // Already-linked is a no-op that must be reported as such — check it BEFORE
    // the cap, otherwise a parent at the cap re-submitting a child they've
    // already linked gets the misleading "maximum number of children" error
    // (the cap count includes that existing link). linkParentToStudentRecord is
    // idempotent, but its alreadyLinked signal only surfaces after the cap gate.
    const { data: existingLink } = await supabase
      .from("student_parents")
      .select("id")
      .eq("student_id", student.id)
      .eq("parent_id", parentId)
      .maybeSingle();
    if (existingLink) {
      return NextResponse.json(
        { error: "This child is already linked to your account" },
        { status: 409 }
      );
    }

    // Cap children per parent. Real families don't have ten children at the
    // school; if they do, an admin can lift the cap manually. This stops a
    // compromised parent account from sweeping the whole student directory.
    const { count: ownChildrenCount } = await supabase
      .from("student_parents")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", parentId);
    if ((ownChildrenCount ?? 0) >= MAX_CHILDREN_PER_PARENT) {
      return NextResponse.json(
        {
          error:
            "You've linked the maximum number of children to this account. Please contact the school administration to add more.",
        },
        { status: 409 }
      );
    }

    // Create the junction via the canonical service (computes primary-contact,
    // idempotent on the unique constraint / race).
    const linked = await linkParentToStudentRecord(supabase, {
      studentId: student.id,
      parentId,
      relationship,
    });
    if (!linked.ok) {
      return NextResponse.json({ error: linked.error }, { status: linked.status });
    }
    if (linked.alreadyLinked) {
      return NextResponse.json(
        { error: "This child is already linked to your account" },
        { status: 409 }
      );
    }
    const isPrimary = linked.isPrimaryContact ?? false;

    // Enrollment info for the card we hand back. Newest first, to match what
    // the dashboard shows on reload — an unordered `limit(1)` could hand back
    // last year's class and make the fresh card disagree with the page behind
    // it. maybeSingle(), because a student between sessions has no enrollment
    // and that is not an error.
    const { data: enrollment } = await supabase
      .from("student_enrollments")
      .select("class_id, roll_number, classes(name, section)")
      .eq("student_id", student.id)
      .order("enrollment_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const classInfo = enrollment?.classes as unknown as {
      name: string;
      section: string;
    } | null;

    return NextResponse.json({
      success: true,
      child: {
        student_id: student.id,
        relationship,
        is_primary_contact: isPrimary,
        student: {
          id: student.id,
          admission_no: student.admission_no,
          full_name: student.full_name,
          photo_url: student.photo_url,
        },
        class_name: classInfo?.name ?? null,
        section: classInfo?.section ?? null,
        roll_number: enrollment?.roll_number ?? null,
      },
    });
  } catch (err) {
    console.error("Link child error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
