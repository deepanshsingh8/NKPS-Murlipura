import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import {
  connectCall,
  isTelephonyConfigured,
  mapExotelStatus,
  normalizeIndianMobile,
} from "@nkps/shared/lib/telephony/exotel";

// Which student column holds each contact's number. The client only sends the
// contact *type* — never a raw number — so a caller can't dial an arbitrary
// number through our Exotel account.
const CONTACT_COLUMN: Record<string, string> = {
  student: "phone",
  father: "father_mobile",
  mother: "mother_mobile",
  guardian: "guardian_mobile",
};

// Cheap abuse guard: every click is billable, so cap bursts per staff member.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CALLS = 5;

export async function POST(request: NextRequest) {
  try {
    const gate = await verifyAdminOrEditorWithUser("students");
    if (!gate) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { admin, user } = gate;

    if (!isTelephonyConfigured()) {
      return NextResponse.json(
        { error: "Calling is not configured yet.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const studentId = typeof body.studentId === "string" ? body.studentId : "";
    const contact = typeof body.contact === "string" ? body.contact : "";

    if (!studentId || !Object.prototype.hasOwnProperty.call(CONTACT_COLUMN, contact)) {
      return NextResponse.json(
        { error: "studentId and a valid contact are required." },
        { status: 400 }
      );
    }

    // Rate-limit per actor over the recent window.
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count: recentCount } = await admin
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", user.id)
      .gte("created_at", since);
    if ((recentCount ?? 0) >= RATE_MAX_CALLS) {
      return NextResponse.json(
        { error: "Too many calls in a short time. Please wait a moment.", code: "RATE_LIMITED" },
        { status: 429 }
      );
    }

    // Resolve the target (parent/student) number server-side. Select the
    // contact columns statically (a dynamic select string defeats Supabase's
    // typed parser) and index into the one we need.
    const column = CONTACT_COLUMN[contact];
    const { data: student, error: studentErr } = await admin
      .from("students")
      .select("id, phone, father_mobile, mother_mobile, guardian_mobile")
      .eq("id", studentId)
      .maybeSingle();
    if (studentErr || !student) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }
    const rawTarget = (student as Record<string, unknown>)[column] as string | null;
    const customerPhone = normalizeIndianMobile(rawTarget);
    if (!customerPhone) {
      return NextResponse.json(
        {
          error: "No valid phone number on file for this contact.",
          code: "NO_CONTACT_NUMBER",
        },
        { status: 400 }
      );
    }

    // Resolve the caller's own number (the leg Exotel rings first).
    const { data: profile } = await admin
      .from("profiles")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle();
    const agentPhone = normalizeIndianMobile(profile?.phone);
    if (!agentPhone) {
      return NextResponse.json(
        {
          error: "Set your own calling number before placing calls.",
          code: "NO_CALLER_NUMBER",
        },
        { status: 400 }
      );
    }

    // Write the audit row up front (pre-dispatch) so a call is always traceable
    // even if the Exotel request then fails. No raw numbers stored.
    const { data: logRow, error: logErr } = await admin
      .from("call_logs")
      .insert({
        actor_id: user.id,
        student_id: studentId,
        contact_type: contact,
        status: "initiated",
      })
      .select("id")
      .single();
    if (logErr || !logRow) {
      console.error("call_logs insert error:", logErr);
      return NextResponse.json({ error: "Failed to start call." }, { status: 500 });
    }

    // Exotel posts status updates here. Token in the query gates the public
    // webhook. Base URL must be publicly reachable (won't fire against
    // localhost in dev — that's expected).
    const base = process.env.NEXT_PUBLIC_ERP_URL || "";
    const token = process.env.EXOTEL_CALLBACK_TOKEN || "";
    const statusCallbackUrl = `${base}/api/telephony/exotel-callback?token=${encodeURIComponent(token)}`;

    try {
      const result = await connectCall({
        agentPhone,
        customerPhone,
        statusCallbackUrl,
        customField: logRow.id,
      });
      await admin
        .from("call_logs")
        .update({
          exotel_sid: result.sid,
          status: mapExotelStatus(result.status),
          updated_at: new Date().toISOString(),
        })
        .eq("id", logRow.id);

      return NextResponse.json({ ok: true, callId: logRow.id });
    } catch (err) {
      console.error("Exotel connect error:", err);
      await admin
        .from("call_logs")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", logRow.id);
      return NextResponse.json(
        { error: "Could not place the call. Please try again.", code: "DISPATCH_FAILED" },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("Click-to-call error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
