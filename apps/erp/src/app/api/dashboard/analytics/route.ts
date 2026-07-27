import { NextResponse } from "next/server";
import { getCallerAccess } from "@nkps/shared/lib/verify-admin";
import {
  resolveEffectiveFeeStructures,
  sumAnnualized,
  annualizedAmount,
  resolveTransportLine,
  type StopFeeLookup,
} from "@/lib/fees";
import type { FeeStructure, TransportDirection } from "@nkps/shared/types";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

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
  const { data: currentYear } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  const currentYearId = currentYear?.id ?? null;

  // Date ranges
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthStartStr = monthStart.toISOString().split("T")[0];
  const monthEndStr = monthEnd.toISOString().split("T")[0];
  const sixMonthsAgoStr = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    .toISOString()
    .split("T")[0];

  const wantAttendance = can("attendance");
  const wantFees = can("fees");
  const wantStudents = can("students");

  const [
    attendanceRes,
    feePaymentsRes,
    feeStructuresRes,
    stopFeesRes,
    enrollmentRes,
    admissionsRes,
  ] = await Promise.all([
      wantAttendance
        ? admin
            .from("attendance")
            .select("status, date")
            .gte("date", monthStartStr)
            .lte("date", monthEndStr)
        : Promise.resolve({ data: null }),

      // Filter on fee_payments.academic_year_id directly — the previous
      // !inner join through fee_structures dropped transport-slab payments
      // (whose fee_structure_id is null) and waiver/historical payments
      // whose linked structure was deleted.
      wantFees && currentYearId
        ? admin
            .from("fee_payments")
            .select("amount_paid, status")
            .eq("academic_year_id", currentYearId)
            .in("status", ["paid", "partial"])
        : Promise.resolve({ data: null }),

      wantFees && currentYearId
        ? admin
            .from("fee_structures")
            .select(
              "id, academic_year_id, class_name, class_level, stream_id, fee_type, amount, due_date, frequency, is_active, description, created_at, updated_at"
            )
            .eq("academic_year_id", currentYearId)
            .eq("is_active", true)
        : Promise.resolve({ data: null }),

      // Stop-based transport pricing (migration 074): each opted-in student's
      // expected transport fee comes from their bus stop's per-year rate, so
      // the expected-total calc needs the active stop fees for the year.
      wantFees && currentYearId
        ? admin
            .from("bus_stop_fees")
            .select("bus_stop_id, amount, frequency, is_active, bus_stops(name)")
            .eq("academic_year_id", currentYearId)
            .eq("is_active", true)
        : Promise.resolve({ data: null }),

      // Enrollments are shared by fees (expected-total calc) and
      // enrollment-by-class — pull them when either block is visible.
      // streams(name) is joined so the senior-secondary breakdown can group
      // XI / XII by Science / Commerce / Arts rather than collapsing into one.
      (wantFees || wantStudents) && currentYearId
        ? admin
            .from("student_enrollments")
            .select(
              "class_id, stream_id, has_transport, bus_stop_id, transport_direction, transport_fee_override, status, classes!inner(name, section, academic_year_id), streams(name, code)"
            )
            .eq("classes.academic_year_id", currentYearId)
            .eq("status", "active")
        : Promise.resolve({ data: null }),

      wantStudents
        ? admin.from("students").select("created_at").gte("created_at", sixMonthsAgoStr)
        : Promise.resolve({ data: null }),
    ]);

  const response: Record<string, unknown> = {
    hasAcademicYear: !!currentYearId,
  };

  // ── Attendance: per-day stacked breakdown for current month ──
  // Replaces the useless "93% for the whole month" single-number view with a
  // per-day (present + absent + late) stacked bar the admin can actually read.
  if (wantAttendance) {
    const rows = (attendanceRes.data ?? []) as { status: string; date: string }[];
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
      const dt = new Date(now.getFullYear(), now.getMonth(), d)
        .toISOString()
        .split("T")[0];
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
  const enrollments = (enrollmentRes.data ?? []) as unknown as {
    class_id: string;
    stream_id: string | null;
    has_transport: boolean | null;
    bus_stop_id: string | null;
    transport_direction: TransportDirection | null;
    transport_fee_override: number | null;
    classes:
      | { name: string; section: string }
      | { name: string; section: string }[]
      | null;
    streams:
      | { name: string; code: string | null }
      | { name: string; code: string | null }[]
      | null;
  }[];

  if (wantFees) {
    const payments = (feePaymentsRes.data ?? []) as { amount_paid: number }[];
    const collected = payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);

    const structures = (feeStructuresRes.data ?? []) as FeeStructure[];
    const structuresByClass = new Map<string, FeeStructure[]>();
    for (const fs of structures) {
      const list = structuresByClass.get(fs.class_name) ?? [];
      list.push(fs);
      structuresByClass.set(fs.class_name, list);
    }

    // Stop-based transport fees: one active rate per stop per year. Shape the
    // rows into StopFeeLookup so resolveTransportLine can bill the stop rate
    // (or the per-student override for one-side riders).
    const stopFees: StopFeeLookup[] = (
      (stopFeesRes.data ?? []) as unknown as {
        bus_stop_id: string;
        amount: number | string;
        frequency: string;
        is_active: boolean;
        bus_stops: { name: string } | { name: string }[] | null;
      }[]
    ).map((f) => {
      const stop = Array.isArray(f.bus_stops) ? f.bus_stops[0] : f.bus_stops;
      return {
        bus_stop_id: f.bus_stop_id,
        stop_name: stop?.name ?? "",
        amount: f.amount,
        frequency: f.frequency,
        is_active: f.is_active,
      };
    });

    let totalExpected = 0;
    for (const e of enrollments) {
      const raw = e.classes;
      const cls = Array.isArray(raw) ? raw[0] : raw;
      if (!cls) continue;
      const classStructures = structuresByClass.get(cls.name);
      if (classStructures && classStructures.length > 0) {
        const effective = resolveEffectiveFeeStructures(classStructures, {
          studentStreamId: e.stream_id ?? null,
        });
        totalExpected += sumAnnualized(effective);
      }
      const transportLine = resolveTransportLine({
        hasTransport: !!e.has_transport,
        busStopId: e.bus_stop_id,
        direction: e.transport_direction ?? "both",
        feeOverride: e.transport_fee_override,
        stopFees,
      });
      if (transportLine) totalExpected += annualizedAmount(transportLine);
    }

    response.feeCollection = {
      collected,
      expected: totalExpected,
      percentage: totalExpected > 0 ? Math.round((collected / totalExpected) * 100) : 0,
    };
  }

  // ── Enrollment by class + Recent admissions (both gated on students) ──
  if (wantStudents) {
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

    const admissions = (admissionsRes.data ?? []) as { created_at: string }[];
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const admissionTrend: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const count = admissions.filter((a) => a.created_at.startsWith(monthKey)).length;
      admissionTrend.push({ month: monthNames[d.getMonth()], count });
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
