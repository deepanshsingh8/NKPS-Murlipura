"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { todayISO } from "@nkps/shared/lib/date";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Button } from "@nkps/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { CreditCard, CheckCircle, AlertCircle, Loader2, Users, Wallet, Download } from "lucide-react";
import { toast } from "sonner";
import {
  computeDuesBreakdown,
  resolveBillingCutoff,
  resolveEffectiveFeeLines,
  resolveStudentType,
} from "@/lib/fees";
import type { StopFeeLookup } from "@/lib/fees";
import type {
  FeeStructure,
  FeePayment,
  BusStop,
  TransportDirection,
  EffectiveFeeLine,
} from "@nkps/shared/types";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";

interface ChildOption {
  student_id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
}

// The enrollment row drives both halves of this page — the class label in the
// child selector and every fee figure below it — so it is read once per parent
// and shared, rather than once for the label and again for the fees.
interface WardEnrollment {
  student_id: string;
  class_id: string | null;
  stream_id: string | null;
  academic_year_id: string | null;
  has_transport: boolean | null;
  bus_stop_id: string | null;
  transport_direction: TransportDirection | null;
  transport_fee_override: number | null;
  // The three fields resolveBillingCutoff() reads. A ward who has left stops
  // being billed on their leaving date instead of accruing the rest of the
  // session's instalments.
  status: string | null;
  exit_date: string | null;
  status_changed_at: string | null;
  classes: { name: string; section: string } | null;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

export default function ParentFeesPage() {
  const searchParams = useSearchParams();
  const preselectedChild = searchParams.get("child");

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [enrollments, setEnrollments] = useState<Map<string, WardEnrollment>>(
    () => new Map()
  );
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingFees, setLoadingFees] = useState(false);
  const [feeLines, setFeeLines] = useState<EffectiveFeeLine[]>([]);
  // A failed fee read must not pass for "this child owes less". RLS filtering
  // returns an empty set with no error and is indistinguishable from a genuine
  // nil, but an actual transport error is catchable — so catch it and say so
  // rather than rendering a confidently smaller balance. lib/student-dues.ts
  // takes the same position for the download gate ("never swallow a DB error
  // here"); this is that rule applied to what the family reads.
  const [feeLoadError, setFeeLoadError] = useState<string | null>(null);
  // The year's start anchors recurring fees that carry no due date of their
  // own (transport stop fees, legacy monthly/quarterly rows).
  const [academicYear, setAcademicYear] = useState<{
    start_date: string | null;
  } | null>(null);
  const [payments, setPayments] = useState<
    (FeePayment & {
      fee_structure?: FeeStructure;
      bus_stop?: Pick<BusStop, "name"> | null;
    })[]
  >([]);

  // Fetch children on mount
  useEffect(() => {
    async function fetchChildren() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("parent_id")
        .eq("id", user.id)
        .single();

      const parentId = profile?.parent_id;
      if (!parentId) {
        setLoading(false);
        return;
      }

      const { data: studentParents } = await supabase
        .from("student_parents")
        .select("student_id, students(id, full_name)")
        .eq("parent_id", parentId);

      if (!studentParents || studentParents.length === 0) {
        setLoading(false);
        return;
      }

      // One enrollment read for every child, carrying the class + stream +
      // transport columns the fee maths needs as well as the label. PostgREST
      // rejects an empty `.in()` list, so skip the query when no link row
      // carries a student.
      const studentIds = studentParents
        .map((sp) => (sp.students as unknown as { id: string } | null)?.id)
        .filter((id): id is string => Boolean(id));

      // Newest enrollment wins, as the fee read has always done: rows arrive
      // newest-first, so keep the first one seen for each student.
      const enrollmentByStudent = new Map<string, WardEnrollment>();
      if (studentIds.length > 0) {
        const { data: enrollmentRows } = await supabase
          .from("student_enrollments")
          .select(
            "student_id, class_id, stream_id, academic_year_id, has_transport, bus_stop_id, transport_direction, transport_fee_override, status, exit_date, status_changed_at, classes(name, section)"
          )
          .in("student_id", studentIds)
          .order("enrollment_date", { ascending: false });

        for (const row of (enrollmentRows ?? []) as unknown as WardEnrollment[]) {
          if (!enrollmentByStudent.has(row.student_id)) {
            enrollmentByStudent.set(row.student_id, row);
          }
        }
      }

      const childOptions: ChildOption[] = [];
      for (const sp of studentParents) {
        const student = sp.students as unknown as {
          id: string;
          full_name: string;
        };
        if (!student) continue;

        const classInfo = enrollmentByStudent.get(student.id)?.classes ?? null;

        childOptions.push({
          student_id: student.id,
          full_name: student.full_name,
          class_name: classInfo?.name ?? null,
          section: classInfo?.section ?? null,
        });
      }

      setEnrollments(enrollmentByStudent);
      setChildren(childOptions);

      const initial = preselectedChild && childOptions.some((c) => c.student_id === preselectedChild)
        ? preselectedChild
        : childOptions[0]?.student_id ?? "";
      setSelectedChild(initial);
      setLoading(false);
    }

    fetchChildren();
  }, [preselectedChild]);

  // Fetch fees when selected child changes
  useEffect(() => {
    if (!selectedChild) return;

    async function fetchFees() {
      setLoadingFees(true);
      setFeeLoadError(null);
      const supabase = createClient();

      // Class + stream + transport opt-in come from the enrollment already
      // read for the child selector.
      const enrollment = enrollments.get(selectedChild);

      const className = enrollment?.classes?.name ?? "";
      const streamId = enrollment?.stream_id ?? null;
      const hasTransport = Boolean(enrollment?.has_transport);
      const busStopId = enrollment?.bus_stop_id ?? null;
      const direction = enrollment?.transport_direction ?? "both";
      const feeOverride = enrollment?.transport_fee_override ?? null;
      const academicYearId = enrollment?.academic_year_id ?? null;

      // A schedule row can bill newly-admitted or returning students only
      // (the admission fee applies to this year's intake), so resolve which
      // side of that line this child falls on before listing their fees.
      const [{ data: studentRow }, { data: yearRow }] = await Promise.all([
        supabase
          .from("students")
          .select("admission_date")
          .eq("id", selectedChild)
          .maybeSingle(),
        academicYearId
          ? supabase
              .from("academic_years")
              .select("start_date, end_date")
              .eq("id", academicYearId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const year =
        (yearRow as {
          start_date: string | null;
          end_date: string | null;
        } | null) ?? null;
      setAcademicYear(year);
      const studentType = resolveStudentType(
        (studentRow?.admission_date as string | null) ?? null,
        year
      );

      // Fetch fee structures for the class + per-stop fees for the year,
      // then resolve unified fee lines (academic + the assigned stop's fee).
      let lines: EffectiveFeeLine[] = [];
      if (className) {
        // Scope fee structures to the enrollment's academic year and active
        // rows only. Without the year filter a class name reused across years
        // would stack multiple years' fees into one total; `is_active` also
        // excludes the amount=0 "Historical" buckets created by bulk import.
        let structuresQuery = supabase
          .from("fee_structures")
          .select("*")
          .eq("class_name", className)
          .eq("is_active", true);
        if (academicYearId) {
          structuresQuery = structuresQuery.eq("academic_year_id", academicYearId);
        }
        const [
          { data: structuresData, error: structuresError },
          { data: stopFeesData, error: stopFeesError },
        ] = await Promise.all([
          structuresQuery,
          academicYearId
            ? supabase
                .from("bus_stop_fees")
                .select("bus_stop_id, amount, frequency, is_active, bus_stops(name)")
                .eq("academic_year_id", academicYearId)
            : Promise.resolve({ data: [], error: null }),
        ]);
        // Name which half failed: a missing transport line and a missing
        // academic line are different amounts of wrong, and the parent is the
        // one placed to notice which of the two they were expecting.
        setFeeLoadError(
          structuresError
            ? "Couldn't load the fee structure for this class, so the figures below are incomplete. Please refresh, or contact the school office."
            : stopFeesError
              ? "Couldn't load transport fees, so any bus fee is missing from the figures below. Please refresh, or contact the school office."
              : null
        );
        const stopFees: StopFeeLookup[] = (
          (stopFeesData as
            | {
                bus_stop_id: string;
                amount: number | string;
                frequency: string;
                is_active: boolean;
                bus_stops?: { name: string } | null;
              }[]
            | null) ?? []
        ).map((row) => ({
          bus_stop_id: row.bus_stop_id,
          stop_name: row.bus_stops?.name ?? "",
          amount: row.amount,
          frequency: row.frequency,
          is_active: row.is_active,
        }));
        lines = resolveEffectiveFeeLines({
          structures: (structuresData as FeeStructure[]) ?? [],
          studentStreamId: streamId,
          studentType,
          hasTransport,
          busStopId,
          direction,
          feeOverride,
          stopFees,
        });
      }
      setFeeLines(lines);

      // Fetch payments — also pull the stop name for transport receipts so
      // the history table doesn't fall back to "--" for stop-driven rows.
      // Scope to the current academic year so prior-year receipts aren't
      // subtracted from this year's fees (fee structures are year-scoped).
      let paymentsQuery = supabase
        .from("fee_payments")
        .select(
          "*, fee_structure:fee_structures(*), bus_stop:bus_stops(name)"
        )
        .eq("student_id", selectedChild);
      if (academicYearId) {
        paymentsQuery = paymentsQuery.eq("academic_year_id", academicYearId);
      }
      const { data: paymentData } = await paymentsQuery.order(
        "payment_date",
        { ascending: false }
      );

      setPayments(
        (paymentData as (FeePayment & {
          fee_structure?: FeeStructure;
          bus_stop?: Pick<BusStop, "name"> | null;
        })[]) ?? []
      );
      setLoadingFees(false);
    }

    fetchFees();
  }, [selectedChild, enrollments]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
      </div>
    );
  }

  // Compute summary — annualize each line so quarterly/monthly fees are
  // counted correctly for the whole academic year.
  // Two different questions, so two different totals:
  //   totalFees    — the whole session's obligation (annualized).
  //   billedToDate — the slice of it that has actually fallen due.
  // "Payable Now" is measured against the second, because a January instalment
  // isn't an arrear in August.
  //
  // This delegates to computeDuesBreakdown — the same function the office's
  // dues register runs (AdminFeesContent) — so the number a parent reads here
  // is the number the school will quote back when they ring up about it. This
  // page used to do the arithmetic inline and omit the late fee, which showed
  // families a smaller balance than /fees/dues showed the office.
  //
  // It is deliberately NOT the figure the download gate uses: student-dues.ts
  // carries no late-fee term, so the gate stays the more lenient of the two. A
  // parent can therefore owe a late fee here and still pull an admit card.
  const today = todayISO();
  // computeDuesBreakdown requires payments pre-scoped to the billed year (done
  // in the query above) and to receipt-bearing statuses. 'refunded' belongs in
  // that set: a partially-refunded payment keeps status 'refunded' with
  // amount_paid intact, and settledAmount() nets out refund_amount per row —
  // dropping those rows would make the whole receipt vanish and overstate dues.
  const dues = computeDuesBreakdown({
    lines: feeLines,
    payments: payments.filter(
      (p) =>
        p.status === "paid" ||
        p.status === "partial" ||
        p.status === "refunded"
    ),
    today,
    yearStartDate: academicYear?.start_date,
    // Priced to the ward's leaving date once they have left, so a family that
    // settled up and moved on is not shown a balance that keeps growing
    // behind them.
    billingCutoff: resolveBillingCutoff(enrollments.get(selectedChild)),
  });
  const totalFees = dues.expected;
  const billedToDate = dues.billedToDate;
  const totalPaid = dues.paid;
  // Already floored at 0 and inclusive of any late fee.
  const pending = dues.dues;

  // Lines marked paid: match by fee_structure_id (academic) or
  // bus_stop_id (transport). Both keys live in the EffectiveFeeLine.id
  // by construction, so a single Set covers both flavours.
  const paidLineIds = new Set(
    payments
      .filter((p) => p.status === "paid")
      .map((p) => p.fee_structure_id ?? p.bus_stop_id)
      .filter((id): id is string => Boolean(id))
  );

  const selectedChildInfo = children.find((c) => c.student_id === selectedChild);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Fees
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            View fee structure and payment history for your child.
          </p>
        </div>

        {/* Child Selector */}
        {children.length > 1 && (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            <NativeSelect
              value={selectedChild}
              onChange={(e) => setSelectedChild(e.target.value)}
            >
              {children.map((child) => (
                <option key={child.student_id} value={child.student_id}>
                  {child.full_name}
                  {child.class_name ? ` (${child.class_name} - ${child.section})` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {selectedChildInfo && children.length <= 1 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Showing fees for <span className="font-medium text-navy-900 dark:text-white">{selectedChildInfo.full_name}</span>
          {selectedChildInfo.class_name && ` | ${selectedChildInfo.class_name} - ${selectedChildInfo.section}`}
        </p>
      )}

      {loadingFees ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white" />
        </div>
      ) : (
        <>
          {feeLoadError && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{feeLoadError}</p>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="erp-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
                  <CreditCard className="h-5 w-5 text-gold-500" />
                  Total Fees
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-navy-900 dark:text-white">
                  {formatCurrency(totalFees)}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  For the full session
                </p>
              </CardContent>
            </Card>

            <Card className="erp-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  Paid
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(totalPaid)}
                </p>
              </CardContent>
            </Card>

            <Card className="erp-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  Payable Now
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-red-600 dark:text-red-400">
                  {formatCurrency(pending)}
                </p>
                {/* Name the surcharge rather than letting it inflate the
                    headline unexplained — a parent comparing this against
                    their own sum should be able to see where it came from. */}
                {dues.lateFee > 0 && (
                  <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    Includes a late fee of {formatCurrency(dues.lateFee)} on
                    overdue instalments.
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {billedToDate < totalFees
                    ? `Instalments due so far: ${formatCurrency(billedToDate)}. The rest falls due later in the session.`
                    : "All instalments for the session have fallen due."}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Pay Now Button */}
          {pending > 0 && (
            <Card className="erp-card border-gold-200 dark:border-gold-800/30">
              <CardContent className="p-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center">
                    <Wallet className="h-5 w-5 text-gold-600 dark:text-gold-400" />
                  </div>
                  <div>
                    <p className="font-medium text-navy-900 dark:text-white">
                      Payable Now: {formatCurrency(pending)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Pay online for faster processing
                    </p>
                  </div>
                </div>
                <Button
                  className="bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold"
                  onClick={() => toast.info("Online payment coming soon")}
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Pay Now
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Fee Breakdown */}
          <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-navy-900 dark:text-white">Fee Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {feeLines.length === 0 ? (
                <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                  No fee structures found for this class.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fee Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feeLines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">
                          {line.kind === "transport_stop"
                            ? `Transport — ${line.stop_name}`
                            : line.fee_type}
                        </TableCell>
                        <TableCell>{formatCurrency(line.amount)}</TableCell>
                        <TableCell className="capitalize">
                          {line.frequency.replace("_", " ")}
                        </TableCell>
                        <TableCell>
                          {paidLineIds.has(line.id) ? (
                            <Badge className="bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                              Paid
                            </Badge>
                          ) : (
                            <Badge variant="destructive">Due</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Payment History */}
          <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-navy-900 dark:text-white">Payment History</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                  No payments recorded yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead className="text-right">Download</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.payment_date}</TableCell>
                        <TableCell>
                          {p.bus_stop?.name
                            ? `Transport — ${p.bus_stop.name}`
                            : p.fee_structure?.fee_type ?? "--"}
                        </TableCell>
                        <TableCell>{formatCurrency(p.amount_paid)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.receipt_number ?? "--"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              window.open(
                                `/api/fees/receipt?payment_id=${p.id}`,
                                "_blank",
                                "noopener"
                              )
                            }
                            title="Download fee receipt"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
