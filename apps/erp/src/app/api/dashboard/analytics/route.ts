import { NextResponse } from "next/server";
import { getCallerAccess } from "@nkps/shared/lib/verify-admin";
import {
  resolveStudentType,
  resolveEffectiveFeeLines,
  computeDuesBreakdown,
  summariseFeeCollection,
  type FeeCollectionEntry,
  type StopFeeLookup,
  type DuesPaymentRow,
} from "@/lib/fees";
import type { FeeStructure, TransportDirection } from "@nkps/shared/types";
import type { FeatureKey } from "@nkps/shared/lib/permissions";
import { todayISO, toISODate } from "@nkps/shared/lib/date";
import { fetchAllRows, type PagedResult } from "@nkps/shared/lib/fetch-all-rows";

// Each analytics block maps to the permission that gates privileged access to
// the underlying data. Blocks the caller can't see are simply absent from the
// response (the frontend hides whatever isn't present), so nothing leaks to
// an editor without the grant.

export async function GET() {
  const access = await getCallerAccess();
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, isAdmin, permissions } = access;
  const can = (key: FeatureKey) => isAdmin || permissions.has(key);

  // Current academic year (cheap; used by fee + enrollment blocks)
  // start_date/end_date drive two things in the fee block: classifying a
  // student as new vs returning (admission-fee eligibility), and anchoring
  // recurring fees that carry no due date of their own.
  const { data: currentYear } = await admin
    .from("academic_years")
    .select("id, start_date, end_date")
    .eq("is_current", true)
    .maybeSingle();
  const currentYearId = currentYear?.id ?? null;
  const currentYearRange = currentYear
    ? {
        start_date: (currentYear.start_date as string | null) ?? null,
        end_date: (currentYear.end_date as string | null) ?? null,
      }
    : null;

  // Date ranges. Anchored on the school's civil date, not the server clock:
  // this runs in UTC on Vercel, so `new Date().getMonth()` before 05:30 IST
  // still reports the previous month and every range below shifts with it.
  const [todayYear, todayMonth] = todayISO().split("-").map(Number);
  // Month index is 0-based for the Date constructor; todayMonth is 1-based.
  const monthStart = new Date(Date.UTC(todayYear, todayMonth - 1, 1));
  const monthEnd = new Date(Date.UTC(todayYear, todayMonth, 0));
  const monthStartStr = toISODate(monthStart, "UTC");
  const monthEndStr = toISODate(monthEnd, "UTC");
  const sixMonthsAgoStr = toISODate(
    new Date(Date.UTC(todayYear, todayMonth - 6, 1)),
    "UTC"
  );

  const wantAttendance = can("attendance");
  const wantFees = can("fees");
  const wantStudents = can("students");

  // ── Reads ──────────────────────────────────────────────────────────────
  //
  // Every list read below is paged through fetchAllRows(). PostgREST caps a
  // response at Supabase's db-max-rows (1000); `.range(0, 9999)` asks for more
  // and is handed 1000 rows with a 200 — no error, no partial-content signal
  // the caller checks. That is how this endpoint came to publish a fraction of
  // a session's receipts as the whole of it: 1,994 payments sat in the table,
  // 1,000 were read, and the difference was reported to the office as unpaid.
  //
  // Each read carries an .order() on the primary key. Paging with LIMIT/OFFSET
  // and no ORDER BY has no stable row order, so a page boundary can repeat one
  // row while dropping another — on fee_payments that double-counts a receipt.
  type AttendanceRow = { status: string; date: string };
  type PaymentRow = DuesPaymentRow & { student_id: string };
  type StopFeeRow = {
    bus_stop_id: string;
    amount: number | string;
    frequency: string;
    is_active: boolean;
    bus_stops: { name: string } | { name: string }[] | null;
  };
  type EnrollmentRow = {
    student_id: string;
    class_id: string;
    stream_id: string | null;
    has_transport: boolean | null;
    bus_stop_id: string | null;
    transport_direction: TransportDirection | null;
    transport_fee_override: number | null;
    students:
      | { admission_date: string | null }
      | { admission_date: string | null }[]
      | null;
    classes:
      | { name: string; section: string }
      | { name: string; section: string }[]
      | null;
    streams:
      | { name: string; code: string | null }
      | { name: string; code: string | null }[]
      | null;
  };
  type AdmissionRow = { admission_date: string | null; created_at: string };
  type ExitRow = {
    issue_date: string | null;
    upload_date: string | null;
    created_at: string;
  };

  const emptyPage = <T>(): PagedResult<T> => ({
    data: [],
    error: null,
    truncated: false,
  });

  const [
    attendanceRes,
    feePaymentsRes,
    feeStructuresRes,
    stopFeesRes,
    enrollmentRes,
    admissionsRes,
    exitsRes,
  ] = await Promise.all([
      // A month of whole-school attendance is tens of thousands of rows, so
      // this is the one read that genuinely pages several times. Two narrow
      // columns per row keep each page cheap.
      wantAttendance
        ? fetchAllRows<AttendanceRow>((from, to) =>
            admin
              .from("attendance")
              .select("status, date")
              .gte("date", monthStartStr)
              .lte("date", monthEndStr)
              .order("id")
              .range(from, to)
          )
        : emptyPage<AttendanceRow>(),

      // Filter on fee_payments.academic_year_id directly — the previous
      // !inner join through fee_structures dropped transport-slab payments
      // (whose fee_structure_id is null) and waiver/historical payments
      // whose linked structure was deleted.
      // 'refunded' rows are pulled too: a partial refund flips the status
      // while amount_paid stays put, so filtering them out erased the whole
      // receipt from collections. Each row's net cash is settled below.
      // waiver_amount rides along because a waived fee is settled for dues
      // purposes even though no cash was collected.
      wantFees && currentYearId
        ? fetchAllRows<PaymentRow>((from, to) =>
            admin
              .from("fee_payments")
              .select(
                "student_id, fee_structure_id, amount_paid, refund_amount, waiver_amount, status"
              )
              .eq("academic_year_id", currentYearId)
              .in("status", ["paid", "partial", "refunded"])
              .order("id")
              .range(from, to)
          )
        : emptyPage<PaymentRow>(),

      // select("*") rather than a column list: the dues maths reads the
      // late-fee rule off these rows, and an enumerated list that forgot
      // late_fee_percent / late_fee_per_day silently priced every surcharge at
      // zero here while the dues register — which selects "*" — charged it.
      // The two screens then disagreed about what the same student owed.
      wantFees && currentYearId
        ? fetchAllRows<FeeStructure>((from, to) =>
            admin
              .from("fee_structures")
              .select("*")
              .eq("academic_year_id", currentYearId)
              .eq("is_active", true)
              .order("id")
              .range(from, to)
          )
        : emptyPage<FeeStructure>(),

      // Stop-based transport pricing (migration 074): each opted-in student's
      // expected transport fee comes from their bus stop's per-year rate, so
      // the expected-total calc needs the active stop fees for the year.
      wantFees && currentYearId
        ? fetchAllRows<StopFeeRow>((from, to) =>
            admin
              .from("bus_stop_fees")
              .select("bus_stop_id, amount, frequency, is_active, bus_stops(name)")
              .eq("academic_year_id", currentYearId)
              .eq("is_active", true)
              .order("id")
              .range(from, to)
          )
        : emptyPage<StopFeeRow>(),

      // Enrollments are shared by fees (expected-total calc) and
      // enrollment-by-class — pull them when either block is visible.
      // streams(name) is joined so the senior-secondary breakdown can group
      // XI / XII by Science / Commerce / Arts rather than collapsing into one.
      (wantFees || wantStudents) && currentYearId
        ? fetchAllRows<EnrollmentRow>((from, to) =>
            admin
              .from("student_enrollments")
              .select(
                "student_id, class_id, stream_id, has_transport, bus_stop_id, transport_direction, transport_fee_override, status, classes!inner(name, section, academic_year_id), streams(name, code), students(admission_date)"
              )
              .eq("classes.academic_year_id", currentYearId)
              .eq("status", "active")
              .order("id")
              .range(from, to)
          )
        : emptyPage<EnrollmentRow>(),

      // Intake, dated by when the student actually joined rather than when
      // the record happened to be typed in — a bulk import in August would
      // otherwise report the whole session's April intake as August.
      wantStudents
        ? fetchAllRows<AdmissionRow>((from, to) =>
            admin
              .from("students")
              .select("admission_date, created_at")
              .gte("admission_date", sixMonthsAgoStr)
              .order("id")
              .range(from, to)
          )
        : emptyPage<AdmissionRow>(),

      // Exits. A transfer certificate is the record of a student leaving, so
      // it is the only dependable outward signal — `student_enrollments`
      // carries an 'exited' status but no date to bucket it by.
      //
      // Only the last six months are charted and the table keeps every TC the
      // school has ever issued, so the window is pushed into the query. It has
      // to be an OR across all three dates: the bucketing below falls back
      // issue_date -> upload_date -> created_at, so filtering on any one of
      // them alone would drop a TC that only carries the others.
      wantStudents
        ? fetchAllRows<ExitRow>((from, to) =>
            admin
              .from("transfer_certificates")
              .select("issue_date, upload_date, created_at")
              .or(
                `issue_date.gte.${sixMonthsAgoStr},upload_date.gte.${sixMonthsAgoStr},created_at.gte.${sixMonthsAgoStr}`
              )
              .order("id")
              .range(from, to)
          )
        : emptyPage<ExitRow>(),
    ]);

  const response: Record<string, unknown> = {
    hasAcademicYear: !!currentYearId,
  };

  // ── Attendance: per-day stacked breakdown for current month ──
  // Replaces the useless "93% for the whole month" single-number view with a
  // per-day (present + absent + late) stacked bar the admin can actually read.
  //
  // A failed or short read is left out rather than charted: half a month's
  // rows draw a plausible picture of a school that stopped marking attendance.
  if (wantAttendance && !attendanceRes.error && !attendanceRes.truncated) {
    const rows = attendanceRes.data;
    const daysInMonth = monthEnd.getDate();
    const buckets: {
      date: string;
      day: number;
      present: number;
      absent: number;
      late: number;
      total: number;
    }[] = [];
    const byDate = new Map<string, { present: number; absent: number; late: number }>();
    for (const r of rows) {
      const slot = byDate.get(r.date) ?? { present: 0, absent: 0, late: 0 };
      if (r.status === "present") slot.present++;
      else if (r.status === "absent") slot.absent++;
      else if (r.status === "late") slot.late++;
      else if (r.status === "half_day") slot.present += 0.5; // count half-day as half present
      byDate.set(r.date, slot);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = toISODate(new Date(Date.UTC(todayYear, todayMonth - 1, d)), "UTC");
      const slot = byDate.get(dt) ?? { present: 0, absent: 0, late: 0 };
      const total = slot.present + slot.absent + slot.late;
      buckets.push({
        date: dt,
        day: d,
        present: slot.present,
        absent: slot.absent,
        late: slot.late,
        total,
      });
    }
    const totalPresent = buckets.reduce((s, b) => s + b.present, 0);
    const totalAbsent = buckets.reduce((s, b) => s + b.absent, 0);
    const totalLate = buckets.reduce((s, b) => s + b.late, 0);
    const totalRecords = totalPresent + totalAbsent + totalLate;
    response.attendance = {
      daily: buckets,
      totals: {
        present: totalPresent,
        absent: totalAbsent,
        late: totalLate,
        total: totalRecords,
        percentage:
          totalRecords > 0
            ? Math.round(((totalPresent + totalLate) / totalRecords) * 100)
            : 0,
      },
    };
  }

  // ── Fee collection ──
  const enrollments = enrollmentRes.data;

  // A money figure computed from a short read is worse than no figure at all:
  // it carries the same authority and is quietly wrong. If anything behind
  // this card failed to read, or stopped at the paging guard, the card says so
  // rather than publishing a total it knows is incomplete.
  const feeReadFailure =
    feePaymentsRes.error ??
    feeStructuresRes.error ??
    stopFeesRes.error ??
    enrollmentRes.error ??
    (feePaymentsRes.truncated ||
    feeStructuresRes.truncated ||
    stopFeesRes.truncated ||
    enrollmentRes.truncated
      ? "the read stopped before the end of the table"
      : null);

  if (wantFees && feeReadFailure) {
    response.feeCollectionError = feeReadFailure;
  } else if (wantFees) {
    const payments = feePaymentsRes.data;

    const paymentsByStudent = new Map<string, PaymentRow[]>();
    for (const p of payments) {
      const list = paymentsByStudent.get(p.student_id);
      if (list) list.push(p);
      else paymentsByStudent.set(p.student_id, [p]);
    }

    const structures = feeStructuresRes.data;
    const structuresByClass = new Map<string, FeeStructure[]>();
    for (const fs of structures) {
      const list = structuresByClass.get(fs.class_name) ?? [];
      list.push(fs);
      structuresByClass.set(fs.class_name, list);
    }

    // Stop-based transport fees: one active rate per stop per year. Shape the
    // rows into StopFeeLookup so resolveTransportLine can bill the stop rate
    // (or the per-student override for one-side riders).
    const stopFees: StopFeeLookup[] = stopFeesRes.data.map((f) => {
      const stop = Array.isArray(f.bus_stops) ? f.bus_stops[0] : f.bus_stops;
      return {
        bus_stop_id: f.bus_stop_id,
        stop_name: stop?.name ?? "",
        amount: f.amount,
        frequency: f.frequency,
        is_active: f.is_active,
      };
    });

    // One "today" for the whole pass so two students evaluated either side of
    // midnight can't disagree about whether an instalment has fallen due.
    const today = todayISO();
    const yearStartDate = currentYearRange?.start_date ?? null;

    // Priced student by student through the same computeDuesBreakdown() the
    // Dues / No-Dues register uses, rather than as one school-wide sum. Two
    // reasons: the headcounts below need a per-student verdict at all, and
    // summing per-student dues is what the register totals — a school-wide
    // subtraction would let one family's advance payment cancel out another
    // family's arrears and quietly under-report what is owed.
    //
    // Every money total is then rolled up from these same students, inside
    // summariseFeeCollection(). Summing receipts separately — over the whole
    // year's fee_payments — put money from students who have since left the
    // roll into a numerator whose denominator excluded them, so the card
    // compared two different schools.
    const entries: FeeCollectionEntry[] = [];
    for (const e of enrollments) {
      const raw = e.classes;
      const cls = Array.isArray(raw) ? raw[0] : raw;
      if (!cls) continue;
      const studentRaw = e.students;
      const student = Array.isArray(studentRaw) ? studentRaw[0] : studentRaw;
      const lines = resolveEffectiveFeeLines({
        structures: structuresByClass.get(cls.name) ?? [],
        studentStreamId: e.stream_id ?? null,
        // Admission/registration rows bill this year's intake only.
        studentType: resolveStudentType(
          student?.admission_date,
          currentYearRange
        ),
        hasTransport: !!e.has_transport,
        busStopId: e.bus_stop_id,
        direction: e.transport_direction ?? "both",
        feeOverride: e.transport_fee_override,
        stopFees,
      });
      const receipts = paymentsByStudent.get(e.student_id) ?? [];
      entries.push({
        breakdown: computeDuesBreakdown({
          lines,
          payments: receipts,
          today,
          yearStartDate,
        }),
        // The waived slice of what the breakdown counts as paid, so the card
        // can report cash banked without a write-off inflating it.
        waived: receipts.reduce(
          (sum, p) => sum + Number(p.waiver_amount ?? 0),
          0
        ),
      });
    }

    // `studentsClear` counts those whose fees were waived rather than paid,
    // which is the same rule the No-Dues list applies.
    response.feeCollection = summariseFeeCollection(entries);
  }

  // ── Enrollment by class + Recent admissions (both gated on students) ──
  // Same rule as above: a roll call built from a short read is worse than no
  // roll call, because nothing on screen says which classes are missing.
  if (
    wantStudents &&
    !enrollmentRes.error &&
    !enrollmentRes.truncated &&
    !admissionsRes.error &&
    !admissionsRes.truncated &&
    !exitsRes.error &&
    !exitsRes.truncated
  ) {
    // Senior-secondary sections house multiple streams (Science / Commerce /
    // Arts) on the same class+section row, so the key must include the
    // stream short-code for XI / XII or every stream collapses into one bar.
    // Schema enforces UNIQUE(name, section, academic_year_id, stream_id), so
    // every bucket (name + section [+ stream]) maps to a single class_id —
    // captured here so the dashboard can deep-link each bar to the students
    // page filtered to that class.
    const STREAMED_CLASSES = new Set(["XI", "XII"]);
    const classCountMap: Record<
      string,
      { name: string; count: number; class_id: string }
    > = {};
    for (const e of enrollments) {
      const raw = e.classes;
      if (!raw) continue;
      const cls = Array.isArray(raw) ? raw[0] : raw;
      if (!cls) continue;
      const rawStream = e.streams;
      const streamRow = Array.isArray(rawStream) ? rawStream[0] : rawStream;
      const baseKey = `${cls.name}-${cls.section}`;
      const key =
        STREAMED_CLASSES.has(cls.name) && streamRow?.name
          ? `${baseKey} · ${streamRow.code ?? streamRow.name}`
          : baseKey;
      if (!classCountMap[key])
        classCountMap[key] = { name: key, count: 0, class_id: e.class_id };
      classCountMap[key].count++;
    }
    const enrollmentByClass = Object.values(classCountMap).sort((a, b) => {
      const order = [
        "Nursery", "LKG", "UKG", "I", "II", "III", "IV", "V",
        "VI", "VII", "VIII", "IX", "X", "XI", "XII",
      ];
      const aIdx = order.findIndex((o) => a.name.startsWith(o));
      const bIdx = order.findIndex((o) => b.name.startsWith(o));
      if (aIdx !== bIdx) return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      // Within the same class, sort by full key so XII-A · Sci comes before
      // XII-A · Com etc. — deterministic order across renders.
      return a.name.localeCompare(b.name);
    });
    response.enrollmentByClass = enrollmentByClass;

    const admissions = admissionsRes.data;
    const exits = exitsRes.data;
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    // A TC's issue date is when the student actually left; upload_date is
    // when the office filed the paperwork. Prefer the former, fall back in
    // order so a partially-filled record still lands in some month.
    const exitMonths = exits.map((t) =>
      (t.issue_date ?? t.upload_date ?? t.created_at).slice(0, 7)
    );
    const admissionMonths = admissions.map((a) =>
      (a.admission_date ?? a.created_at).slice(0, 7)
    );

    // Joined vs left, month by month. One number without the other says
    // nothing about whether the roll is growing — 31 admissions reads as a
    // good April until you see the 28 who left in the same month.
    const admissionTrend: {
      month: string;
      admissions: number;
      exits: number;
      net: number;
    }[] = [];
    for (let i = 5; i >= 0; i--) {
      // Constructed with Date.UTC, so read back with the UTC getters — the
      // local-time getters would re-introduce a zone shift on the boundary.
      const d = new Date(Date.UTC(todayYear, todayMonth - 1 - i, 1));
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const joined = admissionMonths.filter((m) => m === monthKey).length;
      const left = exitMonths.filter((m) => m === monthKey).length;
      admissionTrend.push({
        month: monthNames[d.getUTCMonth()],
        admissions: joined,
        exits: left,
        net: joined - left,
      });
    }
    response.admissionTrend = admissionTrend;
  }

  // ── Transport overview (gated on fees) ──
  // Stop-based model (migration 074): the operational signals worth surfacing
  // are adoption (opted in), one-side riders, opted-in students still without
  // a bus assigned, and change requests awaiting office review.
  if (wantFees && currentYearId) {
    const activeYearTransport = () =>
      admin
        .from("student_enrollments")
        .select("id, classes!inner(academic_year_id)", {
          count: "exact",
          head: true,
        })
        .eq("classes.academic_year_id", currentYearId)
        .eq("status", "active");

    const [usingRes, oneSideRes, unassignedRes, pendingRes] = await Promise.all([
      activeYearTransport().eq("has_transport", true),
      activeYearTransport()
        .eq("has_transport", true)
        .neq("transport_direction", "both"),
      activeYearTransport().eq("has_transport", true).is("bus_id", null),
      admin
        .from("transport_change_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);

    response.transportAudit = {
      usingTransport: usingRes.count ?? 0,
      oneSide: oneSideRes.count ?? 0,
      unassignedBus: unassignedRes.count ?? 0,
      pendingChangeRequests: pendingRes.count ?? 0,
    };
  }

  return NextResponse.json(response);
}
