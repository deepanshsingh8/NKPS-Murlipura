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

    // Two-tier rate limit:
    //  - Per-parent: stops a stolen account from sweeping the directory.
    //  - Per-IP: stops account-rotation attempts from the same machine.
    // Generous enough that a parent linking a few siblings will never hit it.
    const parentLimit = rateLimit({
      name: "link-child:parent",
      key: parentId,
      max: 5,
      windowSeconds: 30 * 60,
    });
    if (!parentLimit.ok) {
      return NextResponse.json(
        {
          error:
            "Too many attempts. Please wait a few minutes before trying again.",
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

    // Validate request body
    const body = await request.json();
    const result = linkChildSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { admission_no, date_of_birth, relationship } = result.data;
    const supabase = createAdminClient();

    // Look up student by admission number
    const { data: student } = await supabase
      .from("students")
      .select("id, date_of_birth, full_name, admission_no, photo_url, is_active")
      .eq("admission_no", admission_no)
      .single();

    // Audit H4: collapse "no such admission no" and "DOB mismatch" into a
    // single generic message so an attacker can't enumerate which
    // admission_nos exist by submitting a known-bad DOB. The "DOB missing"
    // branch stays distinct because that's genuinely a school-side data
    // gap the parent needs to be told about.
    const verifyFailed = NextResponse.json(
      {
        error:
          "We couldn't verify a child with those details. Double-check the admission number and date of birth, then try again.",
      },
      { status: 400 }
    );
    if (!student || !student.is_active) return verifyFailed;
    if (!student.date_of_birth) {
      return NextResponse.json(
        {
          error:
            "This student's date of birth has not been recorded in the system. Please contact the school administration.",
        },
        { status: 422 }
      );
    }
    if (student.date_of_birth !== date_of_birth) return verifyFailed;

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

    // Fetch enrollment info to return full child data
    const { data: enrollment } = await supabase
      .from("student_enrollments")
      .select("class_id, roll_number, classes(name, section)")
      .eq("student_id", student.id)
      .limit(1)
      .single();

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
