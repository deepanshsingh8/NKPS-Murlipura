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
  collected: number;
  expected: number;
  percentage: number;
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
  count: number;
}

interface TransportAudit {
  total: number;
  unverified: number;
  overridden: number;
  mismatch: number;
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
  const maxAdmission = Math.max(
    ...(data.admissionTrend ?? []).map((a) => a.count),
    1
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Attendance spans full row when present for readability */}
      {data.attendance && <AttendanceBlock data={data.attendance} />}

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
              <p className="text-[11px] text-gray-400">Current academic year</p>
            </div>
          </div>
          {!data.hasAcademicYear ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No active academic year set
            </p>
          ) : (
            <>
              <div className="flex items-end justify-between mb-2">
                <span className="text-2xl font-bold text-navy-900 dark:text-white">
                  {data.feeCollection.percentage}%
                </span>
                <span className="text-xs text-gray-400">
                  {formatCurrency(data.feeCollection.collected)} /{" "}
                  {formatCurrency(data.feeCollection.expected)}
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
              <div className="flex gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="text-gray-500 dark:text-gray-400">
                    Collected
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-gray-200 dark:bg-muted" />
                  <span className="text-gray-500 dark:text-gray-400">
                    Pending
                  </span>
                </div>
              </div>
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

      {/* Recent Admissions Trend */}
      {data.admissionTrend && (
        <div className="erp-stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <UserPlus className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Recent Admissions
              </h3>
              <p className="text-[11px] text-gray-400">Last 6 months</p>
            </div>
          </div>
          {data.admissionTrend.every((m) => m.count === 0) ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No admissions in the last 6 months
            </p>
          ) : (
            <div className="flex items-end gap-2 h-28">
              {data.admissionTrend.map((item, i) => (
                <div
                  key={item.month}
                  className="flex-1 flex flex-col items-center gap-1 group"
                  title={`${item.month}: ${item.count} admission${item.count === 1 ? "" : "s"}`}
                >
                  <span className="text-[10px] font-semibold text-navy-900 dark:text-white tabular-nums">
                    {item.count > 0 ? item.count : ""}
                  </span>
                  <div
                    className={cn(
                      "w-full rounded-t transition-all duration-200 dash-grow-h",
                      item.count > 0
                        ? "bg-gradient-to-t from-amber-500 to-amber-300 group-hover:from-amber-600 group-hover:to-amber-400"
                        : "bg-gray-100 dark:bg-muted"
                    )}
                    style={{
                      height: `${item.count > 0 ? Math.max((item.count / maxAdmission) * 100, 10) : 5}%`,
                      animationDelay: `${i * 70}ms`,
                    }}
                  />
                  <span className="text-[10px] text-gray-400 group-hover:text-navy-900 dark:group-hover:text-white transition-colors">
                    {item.month}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transport audit — surfaces unverified + overridden + mismatch
          counts so admin can spot cheating without digging through rows. */}
      {data.transportAudit && (
        <div className="erp-stat-card md:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Bus className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Transport Audit
              </h3>
              <p className="text-[11px] text-gray-400">
                Pickup verifications + slab overrides for the current year
              </p>
            </div>
            {(data.transportAudit.mismatch > 0 ||
              data.transportAudit.overridden > 0) && (
              <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2 py-1 rounded">
                <ShieldAlert className="h-3 w-3" />
                Review
              </span>
            )}
          </div>
          {data.transportAudit.total === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No students opted in to transport yet
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Link
                href="/fees/transport"
                className="rounded-lg border border-gray-200 dark:border-border p-3 hover:bg-gray-50 dark:hover:bg-muted/40 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  Total
                </p>
                <p className="text-2xl font-bold tabular-nums text-navy-900 dark:text-white">
                  {data.transportAudit.total}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  using transport
                </p>
              </Link>
              <Link
                href="/people/students?has_transport=1&verified=0"
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  data.transportAudit.unverified > 0
                    ? "border-amber-200 bg-amber-50/50 hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20"
                    : "border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted/40"
                )}
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  Unverified
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    data.transportAudit.unverified > 0
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-navy-900 dark:text-white"
                  )}
                >
                  {data.transportAudit.unverified}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  awaiting pickup confirm
                </p>
              </Link>
              <Link
                href="/people/students?slab_overridden=1"
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  data.transportAudit.overridden > 0
                    ? "border-violet-200 bg-violet-50/50 hover:bg-violet-50 dark:border-violet-900/40 dark:bg-violet-900/20"
                    : "border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted/40"
                )}
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  Slab overridden
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    data.transportAudit.overridden > 0
                      ? "text-violet-700 dark:text-violet-400"
                      : "text-navy-900 dark:text-white"
                  )}
                >
                  {data.transportAudit.overridden}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  manual reassignment
                </p>
              </Link>
              <Link
                href="/people/students?pickup_mismatch=1"
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  data.transportAudit.mismatch > 0
                    ? "border-rose-200 bg-rose-50/50 hover:bg-rose-50 dark:border-rose-900/40 dark:bg-rose-900/20"
                    : "border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted/40"
                )}
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  Pickup mismatch
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    data.transportAudit.mismatch > 0
                      ? "text-rose-700 dark:text-rose-400"
                      : "text-navy-900 dark:text-white"
                  )}
                >
                  {data.transportAudit.mismatch}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  &gt; 1 km drift from address
                </p>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
