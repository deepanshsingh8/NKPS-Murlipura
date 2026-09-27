"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@nkps/shared/lib/admin-api";

// The analytics payload, and the one fetch of it.
//
// The types and the fetch used to live inside DashboardAnalytics, which meant
// the only way for the dashboard above it to show an attendance percentage or a
// collection rate was to ask the same endpoint a second time. Both now read one
// result: the hook fetches, DashboardView passes the data down.

export interface AttendanceDay {
  date: string;
  day: number;
  present: number;
  absent: number;
  late: number;
  total: number;
}

export interface AttendanceData {
  daily: AttendanceDay[];
  totals: {
    present: number;
    absent: number;
    late: number;
    total: number;
    percentage: number;
  };
}

export interface FeeCollection {
  /** Cash banked this session from these students, net of refunds. */
  collected: number;
  /** Fees written off — settled for dues, but never money in the bank. */
  waived: number;
  /** Cash held against instalments that have not fallen due yet. */
  advance: number;
  /**
   * The settled slice of `dueToDate` (cash + waivers, capped per student).
   * `settled + dues - lateFee === dueToDate`, so the bar and the outstanding
   * figure below it reconcile on screen.
   */
  settled: number;
  /** The session's whole obligation across every enrolled student. */
  expected: number;
  /** The slice of `expected` whose due date has passed. */
  dueToDate: number;
  /** Outstanding as of today, late fee included — what the office chases. */
  dues: number;
  /** The late-fee part of `dues`. */
  lateFee: number;
  /** `settled` as a share of dueToDate — progress against what's payable now. */
  percentage: number;
  /** The same measure taken over the whole session. */
  percentageOfYear: number;
  /** Students with nothing outstanding — paid in full, or waived. */
  studentsClear: number;
  /** Students still owing something as of today. */
  studentsWithDues: number;
  /** Active enrolments the figures above were computed over. */
  studentsTotal: number;
}

export interface EnrollmentItem {
  name: string;
  count: number;
  // Optional — only present when the server can resolve the bucket to a
  // single class row (current schema guarantees this for every bucket, but
  // the field is optional so older payloads don't break the type).
  class_id?: string;
}

export interface AdmissionTrend {
  month: string;
  /** Students whose admission date falls in this month. */
  admissions: number;
  /** Transfer certificates issued in this month — students who left. */
  exits: number;
  /** `admissions - exits`. Negative months are the ones worth noticing. */
  net: number;
}

export interface TransportAudit {
  usingTransport: number;
  oneSide: number;
  unassignedBus: number;
  pendingChangeRequests: number;
}

// Every block is optional — the server omits blocks the caller can't see.
export interface AnalyticsData {
  attendance?: AttendanceData;
  feeCollection?: FeeCollection;
  /**
   * Set instead of `feeCollection` when a read behind the card came up short.
   * A money total built on a partial read looks exactly like a correct one, so
   * the card reports the failure rather than a figure it knows is wrong.
   */
  feeCollectionError?: string;
  enrollmentByClass?: EnrollmentItem[];
  admissionTrend?: AdmissionTrend[];
  transportAudit?: TransportAudit;
  hasAcademicYear: boolean;
}

export function useDashboardAnalytics(enabled: boolean) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    (async () => {
      try {
        const res = await adminFetch("/api/dashboard/analytics");
        if (!active) return;
        if (res.ok) setData(await res.json());
      } catch {
        // Silent: the dashboard degrades to the blocks it does have rather
        // than replacing the page with an error.
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [enabled]);

  return { data, loading };
}
