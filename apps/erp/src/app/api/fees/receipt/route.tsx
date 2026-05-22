import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { FeeReceiptPDF } from "@/components/pdf/FeeReceiptPDF";
import { SCHOOL } from "@nkps/shared/lib/constants";

export const runtime = "nodejs";

let cachedLogo: Buffer | null = null;
async function loadLogo(): Promise<Buffer | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const logoPath = path.join(process.cwd(), "public", "images", "logo.png");
    cachedLogo = await fs.readFile(logoPath);
    return cachedLogo;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get("payment_id");
    if (!paymentId) {
      return NextResponse.json(
        { error: "payment_id is required" },
        { status: 400 }
      );
    }

    // Use admin client so we can always fetch the full joined payload, then
    // enforce authorization ourselves below.
    const admin = createAdminClient();

    const { data: payment, error: payErr } = await admin
      .from("fee_payments")
      .select(
        "id, student_id, amount_paid, payment_date, payment_method, receipt_number, month, status, remarks, cheque_number, cheque_date, bank_name, payer_name, transaction_ref, payment_provider, fee_structure:fee_structures(fee_type, academic_year_id, academic_years(name)), transport_slab:transport_fare_slabs(name, academic_year_id, academic_years(name))"
      )
      .eq("id", paymentId)
      .single();

    if (payErr || !payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    // Authorization
    const { data: profile } = await admin
      .from("profiles")
      .select("role, student_id, parent_id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // "Office bucket": admin always, plus staff (replaces the old editor role)
    // and any teacher granted the `fees` capability. Students/parents follow
    // the owner-student / linked-parent paths below.
    let isAdmin = profile.role === "admin" || profile.role === "staff";
    if (!isAdmin && profile.role === "teacher") {
      const { data: perm } = await admin
        .from("editor_permissions")
        .select("feature_key")
        .eq("editor_id", user.id)
        .eq("feature_key", "fees")
        .maybeSingle();
      if (perm) isAdmin = true;
    }
    const isOwnerStudent =
      profile.role === "student" && profile.student_id === payment.student_id;

    let isLinkedParent = false;
    if (profile.role === "parent" && profile.parent_id) {
      const { data: link } = await admin
        .from("student_parents")
        .select("student_id")
        .eq("parent_id", profile.parent_id)
        .eq("student_id", payment.student_id)
        .maybeSingle();
      isLinkedParent = !!link;
    }

    if (!isAdmin && !isOwnerStudent && !isLinkedParent) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Load student
    const { data: student } = await admin
      .from("students")
      .select("full_name, admission_no, father_name")
      .eq("id", payment.student_id)
      .single();

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Resolve class (most recent enrollment)
    const { data: enrollment } = await admin
      .from("student_enrollments")
      .select("roll_number, classes(name, section), academic_years(name)")
      .eq("student_id", payment.student_id)
      .order("enrollment_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const classInfo =
      (enrollment?.classes as unknown as { name: string; section: string } | null) ?? null;
    const classLabel = classInfo
      ? `${classInfo.name}${classInfo.section ? " - " + classInfo.section : ""}`
      : "—";

    const feeStructure = payment.fee_structure as unknown as {
      fee_type: string;
      academic_years: { name: string } | null;
    } | null;

    const transportSlab = payment.transport_slab as unknown as {
      name: string;
      academic_years: { name: string } | null;
    } | null;

    // Transport receipts use the slab name as the line description so
    // parents see "0–5 km" rather than a generic "Transport".
    const feeTypeLabel = transportSlab
      ? `Transport — ${transportSlab.name}`
      : feeStructure?.fee_type ?? "Fee";

    const academicYearName =
      transportSlab?.academic_years?.name ??
      feeStructure?.academic_years?.name ??
      (enrollment?.academic_years as unknown as { name: string } | null)?.name ??
      "";

    const logoData = await loadLogo();

    const buffer = await renderToBuffer(
      <FeeReceiptPDF
        school={{
          name: SCHOOL.name,
          addressLine: SCHOOL.address.full,
          affiliation: SCHOOL.affiliation,
          affiliationNumber: SCHOOL.affiliationNumber,
          phone: SCHOOL.phone[0],
          email: SCHOOL.email[0],
        }}
        logoData={logoData ?? undefined}
        data={{
          receipt_number: payment.receipt_number ?? payment.id.slice(0, 8).toUpperCase(),
          payment_date: payment.payment_date,
          fee_type: feeTypeLabel,
          amount: Number(payment.amount_paid),
          payment_method: payment.payment_method,
          month: payment.month,
          academic_year: academicYearName,
          remarks: payment.remarks,
          cheque_number: payment.cheque_number ?? null,
          cheque_date: payment.cheque_date ?? null,
          bank_name: payment.bank_name ?? null,
          payer_name: payment.payer_name ?? null,
          transaction_ref: payment.transaction_ref ?? null,
          payment_provider: payment.payment_provider ?? null,
          student: {
            full_name: student.full_name,
            admission_no: student.admission_no,
            father_name: student.father_name,
            class_label: classLabel,
            roll_number: enrollment?.roll_number ?? null,
          },
        }}
      />
    );

    const safeName = student.full_name.replace(/[^\w\-]+/g, "_");
    const filename = `fee-receipt_${payment.receipt_number ?? paymentId}_${safeName}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("Receipt PDF error:", err);
    return NextResponse.json(
      { error: "Failed to generate receipt" },
      { status: 500 }
    );
  }
}
