"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckSquare,
  CreditCard,
  GraduationCap,
  UserPlus,
  Bus,
  ShieldAlert,
} from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { cn } from "@nkps/shared/lib/utils";

interface AttendanceDay {
  date: string;
  day: number;
  present: number;
  absent: number;
  late: number;
  total: number;
}

interface AttendanceData {
  daily: AttendanceDay[];
  totals: {
    present: number;
    absent: number;
    late: number;
    total: number;
    percentage: number;
  };
}

interface FeeCollection {
  /** Cash actually banked this session, net of refunds. */
  collected: number;
  /** The session's whole obligation across every enrolled student. */
  expected: number;
  /** The slice of `expected` whose due date has passed. */
  dueToDate: number;
  /** Outstanding as of today: dueToDate less cash and waivers. */
  dues: number;
  /** Collected as a share of dueToDate — progress against what's payable now. */
  percentage: number;
  /** Collected as a share of the whole session. */
  percentageOfYear: number;
  /** Students with nothing outstanding — paid in full, or waived. */
  studentsClear: number;
  /** Students still owing something as of today. */
  studentsWithDues: number;
  /** Active enrolments the figures above were computed over. */
  studentsTotal: number;
}

interface EnrollmentItem {
  name: string;
  count: number;
  // Optional — only present when the server can resolve the bucket to a
  // single class row (current schema guarantees this for every bucket, but
  // the field is optional so older payloads don't break the type).
  class_id?: string;
}

interface AdmissionTrend {
  month: string;
  /** Students whose admission date falls in this month. */
  admissions: number;
  /** Transfer certificates issued in this month — students who left. */
  exits: number;
  /** `admissions - exits`. Negative months are the ones worth noticing. */
  net: number;
}

interface TransportAudit {
  usingTransport: number;
  oneSide: number;
  unassignedBus: number;
  pendingChangeRequests: number;
}

// Every block is optional — the server omits blocks the caller can't see.
interface AnalyticsData {
  attendance?: AttendanceData;
  feeCollection?: FeeCollection;
  enrollmentByClass?: EnrollmentItem[];
  admissionTrend?: AdmissionTrend[];
  transportAudit?: TransportAudit;
  hasAcademicYear: boolean;
}

function formatCurrency(amount: number) {
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toLocaleString("en-IN");
}

/** One "students paid / remaining / total" tile on the Fee Collection card. */
function FeeHeadcount({
  href,
  label,
  value,
  className,
}: {
  href: string;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-lg border px-2 py-1.5 text-center transition-colors hover:brightness-95 dark:hover:brightness-110",
        className
      )}
    >
      <p className="text-lg font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider opacity-70">
        {label}
      </p>
    </Link>
  );
}

/** One half of a month column on the admissions/exits chart. */
function MovementBar({
  value,
  max,
  delay,
  className,
}: {
  value: number;
  max: number;
  delay: number;
  className: string;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-t transition-all duration-200 dash-grow-h",
        value > 0 ? className : "bg-gray-100 dark:bg-muted"
      )}
      style={{
        height: `${value > 0 ? Math.max((value / max) * 100, 10) : 5}%`,
        animationDelay: `${delay}ms`,
      }}
    />
  );
}

function SkeletonCard() {
  return (
    <div className="erp-stat-card animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-muted" />
        <div className="h-4 w-32 rounded bg-gray-100 dark:bg-muted" />
      </div>
      <div className="space-y-3">
        <div className="h-3 w-full rounded bg-gray-100 dark:bg-muted" />
        <div className="h-3 w-3/4 rounded bg-gray-100 dark:bg-muted" />
        <div className="h-3 w-1/2 rounded bg-gray-100 dark:bg-muted" />
      </div>
    </div>
  );
}

type AttendanceTone = "emerald" | "amber" | "rose";

const CHIP_TONES: Record<AttendanceTone, { wrap: string; dot: string; value: string }> = {
  emerald: {
    wrap: "bg-emerald-50/80 dark:bg-emerald-900/20 border-emerald-200/70 dark:border-emerald-800/40",
    dot: "bg-emerald-500",
    value: "text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    wrap: "bg-amber-50/80 dark:bg-amber-900/20 border-amber-200/70 dark:border-amber-800/40",
    dot: "bg-amber-400",
    value: "text-amber-700 dark:text-amber-300",
  },
  rose: {
    wrap: "bg-rose-50/80 dark:bg-rose-900/20 border-rose-200/70 dark:border-rose-800/40",
    dot: "bg-rose-400",
    value: "text-rose-700 dark:text-rose-300",
  },
};

function AttendanceChip({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: number;
  pct: number;
  tone: AttendanceTone;
}) {
  const t = CHIP_TONES[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2", t.wrap)}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn("h-2 w-2 rounded-sm", t.dot)} />
        <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn("text-lg font-bold tabular-nums leading-none", t.value)}>
          {value.toLocaleString("en-IN")}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}

function DetailStat({ tone, label, value }: { tone: AttendanceTone; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-sm", CHIP_TONES[tone].dot)} />
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold text-navy-900 dark:text-white tabular-nums">{value}</span>
    </div>
  );
}

function AttendanceBlock({ data }: { data: AttendanceData }) {
  const { daily, totals } = data;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Default focus: today if it has records, else the most recent day with data.
  const initialIdx = (() => {
    const todayIdx = daily.findIndex((d) => d.date === todayStr);
    if (todayIdx >= 0 && daily[todayIdx].total > 0) return todayIdx;
    for (let i = daily.length - 1; i >= 0; i--) {
      if (daily[i].total > 0) return i;
    }
    return -1;
  })();

  const [selectedIdx, setSelectedIdx] = useState<number>(initialIdx);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const activeIdx = hoverIdx ?? selectedIdx;
  const activeDay = activeIdx >= 0 ? daily[activeIdx] : null;

  const maxTotal = Math.max(...daily.map((d) => d.total), 1);
  const monthLabel = new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const totalPct = (n: number) =>
    totals.total > 0 ? Math.round((n / totals.total) * 100) : 0;

  const formatActiveDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  };

  return (
    <div className="erp-stat-card md:col-span-2">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <CheckSquare className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
              Attendance — {monthLabel}
            </h3>
            <p className="text-[11px] text-gray-400">
              {totals.total > 0
                ? `${totals.total.toLocaleString("en-IN")} records this month`
                : "No records yet"}
            </p>
          </div>
        </div>
        {totals.total > 0 && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums leading-none">
              {totals.percentage}%
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-400">
              on time
            </span>
          </div>
        )}
      </div>

      {totals.total === 0 ? (
        <p className="text-xs text-gray-400 text-center py-10">
          No attendance recorded this month yet.
        </p>
      ) : (
        <>
          {/* Summary chips */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            <AttendanceChip
              label="Present"
              value={totals.present}
              pct={totalPct(totals.present)}
              tone="emerald"
            />
            <AttendanceChip
              label="Late"
              value={totals.late}
              pct={totalPct(totals.late)}
              tone="amber"
            />
            <AttendanceChip
              label="Absent"
              value={totals.absent}
              pct={totalPct(totals.absent)}
              tone="rose"
            />
          </div>

          {/* Chart area */}
          <div
            className="flex items-end gap-[3px] h-40"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {daily.map((d, i) => {
              const hPresent = (d.present / maxTotal) * 100;
              const hLate = (d.late / maxTotal) * 100;
              const hAbsent = (d.absent / maxTotal) * 100;
              const hasData = d.total > 0;
              const isActive = i === activeIdx;
              const isToday = d.date === todayStr;
              const dimmed = activeIdx >= 0 && !isActive;

              return (
                <button
                  key={d.date}
                  type="button"
                  onMouseEnter={() => setHoverIdx(i)}
                  onClick={() => setSelectedIdx(i)}
                  aria-label={`Day ${d.day}${hasData ? ` — ${d.present} present, ${d.late} late, ${d.absent} absent` : " — no records"}`}
                  className={cn(
                    "flex-1 flex flex-col justify-end h-full rounded-t-md cursor-pointer outline-none transition-opacity duration-150",
                    "focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                    dimmed ? "opacity-40 hover:opacity-100" : "opacity-100",
                    isToday && "ring-1 ring-emerald-400/40 ring-offset-1 ring-offset-white dark:ring-offset-card"
                  )}
                >
                  {/* Stacked: absent (top) → late → present (bottom). */}
                  <div
                    className="w-full bg-rose-400 rounded-t-sm dash-grow-h"
                    style={{
                      height: `${hAbsent}%`,
                      animationDelay: `${i * 12}ms`,
                    }}
                  />
                  <div
                    className={cn(
                      "w-full bg-amber-400 dash-grow-h",
                      hAbsent === 0 && "rounded-t-sm"
                    )}
                    style={{
                      height: `${hLate}%`,
                      animationDelay: `${i * 12}ms`,
                    }}
                  />
                  <div
                    className={cn(
                      "w-full bg-emerald-500 dash-grow-h",
                      hAbsent === 0 && hLate === 0 && "rounded-t-sm"
                    )}
                    style={{
                      height: `${hPresent}%`,
                      animationDelay: `${i * 12}ms`,
                    }}
                  />
                  {!hasData && (
                    <div className="w-full h-1 bg-gray-100 dark:bg-muted/40 rounded-t-sm" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Day axis — labels on 1, every 5th, today, and the active day. */}
          <div className="flex gap-[3px] mt-1.5">
            {daily.map((d, i) => {
              const isToday = d.date === todayStr;
              const isActive = i === activeIdx;
              const showLabel =
                d.day === 1 || d.day % 5 === 0 || isToday || isActive;
              return (
                <div key={d.date} className="flex-1 text-center">
                  {showLabel && (
                    <span
                      className={cn(
                        "text-[9px] tabular-nums",
                        isActive
                          ? "font-bold text-navy-900 dark:text-white"
                          : isToday
                            ? "font-bold text-emerald-600"
                            : "text-gray-400"
                      )}
                    >
                      {d.day}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detail strip — updates with hover, persists with click. */}
          {activeDay && (
            <div className="mt-4 rounded-xl bg-gray-50/80 dark:bg-muted/30 border border-gray-100 dark:border-border/60 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-navy-900 dark:text-white flex items-center gap-1.5">
                    {formatActiveDate(activeDay.date)}
                    {activeDay.date === todayStr && (
                      <span className="text-[9px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded uppercase tracking-wide">
                        Today
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {activeDay.total > 0
                      ? `${Math.round(((activeDay.present + activeDay.late) / activeDay.total) * 100)}% on time · ${activeDay.total} record${activeDay.total === 1 ? "" : "s"}`
                      : "No records recorded"}
                  </p>
                </div>
                {activeDay.total > 0 && (
                  <div className="flex items-center gap-3 text-[11px]">
                    <DetailStat tone="emerald" label="Present" value={activeDay.present} />
                    <DetailStat tone="amber" label="Late" value={activeDay.late} />
                    <DetailStat tone="rose" label="Absent" value={activeDay.absent} />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function DashboardAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await adminFetch("/api/dashboard/analytics");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!data) return null;

  // Caller sees nothing? Render nothing — prevents an empty gray band.
  const hasAnyBlock =
    data.attendance ||
    data.feeCollection ||
    data.enrollmentByClass ||
    data.admissionTrend;
  if (!hasAnyBlock) return null;

  const maxEnrollment = Math.max(
    ...(data.enrollmentByClass ?? []).map((e) => e.count),
    1
  );
  // One scale for both series so the two bars in a month are comparable.
  const maxMovement = Math.max(
    ...(data.admissionTrend ?? []).flatMap((a) => [a.admissions, a.exits]),
    1
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Fee Collection */}
      {data.feeCollection && (
        <div className="erp-stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Fee Collection
              </h3>
              <p className="text-[11px] text-gray-400">
                Against fees due so far this session
              </p>
            </div>
          </div>
          {!data.hasAcademicYear ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No active academic year set
            </p>
          ) : (
            <>
              {/* Progress is measured against fees that have actually fallen
                  due, not the whole session — otherwise the bar reads near
                  zero every April however punctually families pay. */}
              <div className="flex items-end justify-between mb-2">
                <span className="text-2xl font-bold text-navy-900 dark:text-white">
                  {data.feeCollection.percentage}%
                </span>
                <span className="text-xs text-gray-400">
                  {formatCurrency(data.feeCollection.collected)} /{" "}
                  {formatCurrency(data.feeCollection.dueToDate)}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-gray-100 dark:bg-muted overflow-hidden mb-3">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500 dash-grow-w"
                  style={{
                    width: `${Math.min(data.feeCollection.percentage, 100)}%`,
                  }}
                />
              </div>
              {/* The number the office acts on: what is owed right now. */}
              <div className="flex items-baseline justify-between rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2 mb-3">
                <span className="text-xs font-medium text-red-700 dark:text-red-400">
                  Outstanding dues
                </span>
                <span className="text-base font-bold text-red-600 dark:text-red-400">
                  {formatCurrency(data.feeCollection.dues)}
                </span>
              </div>

              {/* Money answers "how much"; these answer "how many families",
                  which is what actually gets chased. Each tile opens the
                  register already filtered to the group it counts. */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <FeeHeadcount
                  href="/fees/dues?dues_tab=clear-list"
                  label="Paid"
                  value={data.feeCollection.studentsClear}
                  className="border-green-200 bg-green-50/60 text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-400"
                />
                <FeeHeadcount
                  href="/fees/dues?dues_tab=dues-list"
                  label="Remaining"
                  value={data.feeCollection.studentsWithDues}
                  className="border-red-200 bg-red-50/60 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
                />
                <FeeHeadcount
                  href="/fees/dues"
                  label="Total"
                  value={data.feeCollection.studentsTotal}
                  className="border-gray-200 bg-gray-50/60 text-navy-900 dark:border-border dark:bg-muted/40 dark:text-white"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="text-gray-500 dark:text-gray-400">
                    Collected
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-gray-200 dark:bg-muted" />
                  <span className="text-gray-500 dark:text-gray-400">
                    Due, unpaid
                  </span>
                </div>
              </div>
              {/* Session context, so nobody reads the figures above as the
                  year's total and under-budgets what is still to come. */}
              <p className="mt-2 text-[11px] text-gray-400">
                Full session: {formatCurrency(data.feeCollection.expected)} (
                {data.feeCollection.percentageOfYear}% collected)
              </p>
            </>
          )}
        </div>
      )}

      {/* Enrollment by Class */}
      {data.enrollmentByClass && (
        <div className="erp-stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Enrollment by Class
              </h3>
              <p className="text-[11px] text-gray-400">Current academic year</p>
            </div>
          </div>
          {data.enrollmentByClass.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No enrollment data
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {data.enrollmentByClass.map((item, i) => {
                const totalEnrollment = data.enrollmentByClass!.reduce(
                  (s, it) => s + it.count,
                  0
                );
                const sharePct =
                  totalEnrollment > 0
                    ? Math.round((item.count / totalEnrollment) * 100)
                    : 0;
                const rowContent = (
                  <>
                    <span className="text-xs text-gray-600 dark:text-gray-400 w-20 shrink-0 truncate group-hover:text-navy-900 dark:group-hover:text-white transition-colors">
                      {item.name}
                    </span>
                    <div className="flex-1 h-5 rounded bg-gray-100 dark:bg-muted overflow-hidden">
                      <div
                        className="h-full rounded bg-gradient-to-r from-violet-500 to-violet-400 transition-all duration-300 group-hover:from-violet-600 group-hover:to-violet-500 flex items-center justify-end pr-1.5 dash-grow-w"
                        style={{
                          width: `${Math.max((item.count / maxEnrollment) * 100, 8)}%`,
                          animationDelay: `${i * 35}ms`,
                        }}
                      >
                        <span className="text-[10px] font-semibold text-white tabular-nums">
                          {item.count}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                      {sharePct}%
                    </span>
                  </>
                );
                const tooltip = `${item.name} — ${item.count} students (${sharePct}% of total)${item.class_id ? " · click to view students" : ""}`;

                return item.class_id ? (
                  <Link
                    key={item.name}
                    href={`/people/students?class_id=${item.class_id}`}
                    className="flex items-center gap-2 group rounded-md -mx-1 px-1 py-0.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                    title={tooltip}
                  >
                    {rowContent}
                  </Link>
                ) : (
                  <div
                    key={item.name}
                    className="flex items-center gap-2 group"
                    title={tooltip}
                  >
                    {rowContent}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Attendance sits below fees and enrollment: it is a month-to-date
          read rather than something acted on, and it spans a full row, so
          leading with it pushed the two cards the office opens this page
          for below the fold. */}
      {data.attendance && <AttendanceBlock data={data.attendance} />}

      {/* Roll movement — intake against exits. Admissions alone can't say
          whether the school is growing: a strong April reads very differently
          once the same month's leavers are next to it. */}
      {data.admissionTrend && (
        <div className="erp-stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <UserPlus className="h-5 w-5 text-amber-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Admissions &amp; Exits
              </h3>
              <p className="text-[11px] text-gray-400">
                Last 6 months · exits counted from transfer certificates
              </p>
            </div>
            {(() => {
              const joined = data.admissionTrend.reduce(
                (t, m) => t + m.admissions,
                0
              );
              const left = data.admissionTrend.reduce((t, m) => t + m.exits, 0);
              const net = joined - left;
              if (joined === 0 && left === 0) return null;
              return (
                <span
                  className={cn(
                    "ml-auto shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums",
                    net > 0
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                      : net < 0
                        ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400"
                        : "bg-gray-100 text-gray-600 dark:bg-muted dark:text-gray-300"
                  )}
                  title={`${joined} joined, ${left} left over the last 6 months`}
                >
                  {net > 0 ? `+${net}` : net} net
                </span>
              );
            })()}
          </div>
          {data.admissionTrend.every((m) => m.admissions === 0 && m.exits === 0) ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No admissions or exits in the last 6 months
            </p>
          ) : (
            <>
              <div className="flex items-end gap-2">
                {data.admissionTrend.map((item, i) => (
                  <div
                    key={item.month}
                    className="flex-1 flex flex-col items-center gap-1 group"
                    title={`${item.month}: ${item.admissions} joined, ${item.exits} left (net ${item.net > 0 ? "+" : ""}${item.net})`}
                  >
                    <span className="text-[10px] font-semibold tabular-nums text-navy-900 dark:text-white">
                      {item.admissions > 0 || item.exits > 0
                        ? `${item.admissions}/${item.exits}`
                        : ""}
                    </span>
                    {/* Two bars, not a net one: a quiet month and a month
                        where 30 arrived and 30 left are not the same thing,
                        and a single net bar would draw them identically.
                        The height here has to be a fixed h-20 rather than a
                        flex-1 share of the row: the bars size themselves as a
                        percentage of this box, and a percentage of an
                        auto-height parent resolves to nothing — which is why
                        the old single-series chart drew no bars at all. */}
                    <div className="flex h-20 w-full items-end justify-center gap-[3px]">
                      <MovementBar
                        value={item.admissions}
                        max={maxMovement}
                        delay={i * 70}
                        className="bg-gradient-to-t from-emerald-500 to-emerald-300 group-hover:from-emerald-600"
                      />
                      <MovementBar
                        value={item.exits}
                        max={maxMovement}
                        delay={i * 70 + 35}
                        className="bg-gradient-to-t from-rose-500 to-rose-300 group-hover:from-rose-600"
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 group-hover:text-navy-900 dark:group-hover:text-white transition-colors">
                      {item.month}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-gray-500 dark:text-gray-400">Joined</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span className="text-gray-500 dark:text-gray-400">Left</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Transport overview — stop-based model (migration 074): adoption,
          one-side riders, opted-in students still missing a bus, and change
          requests awaiting office review. */}
      {data.transportAudit && (
        <div className="erp-stat-card md:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Bus className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Transport
              </h3>
              <p className="text-[11px] text-gray-400">
                Stop assignments + change requests for the current year
              </p>
            </div>
            {(data.transportAudit.unassignedBus > 0 ||
              data.transportAudit.pendingChangeRequests > 0) && (
              <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2 py-1 rounded">
                <ShieldAlert className="h-3 w-3" />
                Review
              </span>
            )}
          </div>
          {data.transportAudit.usingTransport === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No students opted in to transport yet
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Link
                href="/transport/assignments?audit=using"
                className="rounded-lg border border-gray-200 dark:border-border p-3 hover:bg-gray-50 dark:hover:bg-muted/40 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  Using transport
                </p>
                <p className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
                  {data.transportAudit.usingTransport}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  opted in this year
                </p>
              </Link>
              <Link
                href="/transport/assignments?audit=one_side"
                className="rounded-lg border border-gray-200 dark:border-border p-3 hover:bg-gray-50 dark:hover:bg-muted/40 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  One-side
                </p>
                <p className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
                  {data.transportAudit.oneSide}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  pickup or drop only
                </p>
              </Link>
              <Link
                href="/transport/assignments?audit=no_bus"
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  data.transportAudit.unassignedBus > 0
                    ? "border-amber-200 bg-amber-50/50 hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20"
                    : "border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted/40"
                )}
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  No bus assigned
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    data.transportAudit.unassignedBus > 0
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-navy-900 dark:text-white"
                  )}
                >
                  {data.transportAudit.unassignedBus}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  opted in, awaiting bus
                </p>
              </Link>
              <Link
                href="/transport/changes"
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  data.transportAudit.pendingChangeRequests > 0
                    ? "border-violet-200 bg-violet-50/50 hover:bg-violet-50 dark:border-violet-900/40 dark:bg-violet-900/20"
                    : "border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted/40"
                )}
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  Pending change requests
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    data.transportAudit.pendingChangeRequests > 0
                      ? "text-violet-700 dark:text-violet-400"
                      : "text-navy-900 dark:text-white"
                  )}
                >
                  {data.transportAudit.pendingChangeRequests}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  awaiting office review
                </p>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
