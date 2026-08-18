"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Button } from "@nkps/shared/components/ui/button";
import { CreditCard, CheckCircle, AlertCircle, Loader2, Download } from "lucide-react";
import {
  amountBilledToDate,
  resolveEffectiveFeeLines,
  resolveStudentType,
  sumAnnualized,
} from "@/lib/fees";
import type { StopFeeLookup } from "@/lib/fees";
import type {
  FeeStructure,
  FeePayment,
  BusStop,
  TransportDirection,
  EffectiveFeeLine,
} from "@nkps/shared/types";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

// Today, as YYYY-MM-DD. Computed once per render pass so every fee line is
// judged against the same date.
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function StudentFeesPage() {
  const [loading, setLoading] = useState(true);
  const [feeLines, setFeeLines] = useState<EffectiveFeeLine[]>([]);
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

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Resolve linked student record ID
      const { data: profile } = await supabase
        .from("profiles")
        .select("student_id")
        .eq("id", user.id)
        .single();

      const studentId = profile?.student_id;
      if (!studentId) {
        setLoading(false);
        return;
      }

      // Fetch enrollment to determine class + stream + transport opt-in.
      const { data: enrollment } = await supabase
        .from("student_enrollments")
        .select(
          "class_id, stream_id, academic_year_id, has_transport, bus_stop_id, transport_direction, transport_fee_override, classes(name)"
        )
        .eq("student_id", studentId)
        .order("enrollment_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const className =
        (enrollment?.classes as unknown as { name: string } | null)?.name ?? "";
      const streamId = (enrollment?.stream_id as string | null) ?? null;
      const hasTransport = Boolean(enrollment?.has_transport);
      const busStopId = (enrollment?.bus_stop_id as string | null) ?? null;
      const direction =
        (enrollment?.transport_direction as TransportDirection | null) ?? "both";
      const feeOverride =
        (enrollment?.transport_fee_override as number | null) ?? null;
      const academicYearId =
        (enrollment?.academic_year_id as string | null) ?? null;

      // A schedule row can be restricted to newly-admitted or returning
      // students (the admission fee bills only this year's intake), so the
      // student's own admission date and the year's span decide which rows
      // they actually owe.
      const [{ data: studentRow }, { data: yearRow }] = await Promise.all([
        supabase
          .from("students")
          .select("admission_date")
          .eq("id", studentId)
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

      // Fetch fee structures for student's class + per-stop fees for the year,
      // then resolve unified fee lines (academic + the assigned stop's fee).
      if (className) {
        // Scope structures to the enrollment's academic year and active rows
        // only — avoids stacking multiple years of a reused class name and
        // excludes the amount=0 "Historical" buckets from bulk import.
        let structuresQuery = supabase
          .from("fee_structures")
          .select("*")
          .eq("class_name", className)
          .eq("is_active", true);
        if (academicYearId) {
          structuresQuery = structuresQuery.eq("academic_year_id", academicYearId);
        }
        const [{ data: structuresData }, { data: stopFeesData }] = await Promise.all([
          structuresQuery,
          academicYearId
            ? supabase
                .from("bus_stop_fees")
                .select("bus_stop_id, amount, frequency, is_active, bus_stops(name)")
                .eq("academic_year_id", academicYearId)
            : Promise.resolve({ data: [] }),
        ]);
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
        const resolved = resolveEffectiveFeeLines({
          structures: (structuresData as FeeStructure[]) ?? [],
          studentStreamId: streamId,
          studentType,
          hasTransport,
          busStopId,
          direction,
          feeOverride,
          stopFees,
        });
        setFeeLines(resolved);
      }

      // Fetch payments — also pull the stop name so the history table can
      // show "Transport — Main Gate" instead of falling back to "--".
      // Scope to the current academic year so prior-year receipts aren't
      // subtracted from this year's fees (fee structures are year-scoped).
      let paymentsQuery = supabase
        .from("fee_payments")
        .select(
          "*, fee_structure:fee_structures(*), bus_stop:bus_stops(name)"
        )
        .eq("student_id", studentId);
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
      setLoading(false);
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
      </div>
    );
  }

  // Two different questions, so two different totals:
  //   totalFees      — the whole year's obligation (annualized).
  //   billedToDate   — the slice of it that has actually fallen due.
  // "Pending" is measured against the second, because a January instalment
  // isn't an arrear in August. This is the same figure the download dues gate
  // uses (see lib/student-dues.ts), so the number shown here is exactly the
  // number that decides whether an admit card downloads.
  const today = todayISO();
  const totalFees = sumAnnualized(feeLines);
  const billedToDate = feeLines.reduce(
    (sum, line) =>
      sum + amountBilledToDate(line, today, academicYear?.start_date),
    0
  );
  // Match the admin dues view: cash paid + any waiver granted both settle a
  // fee. A partially-refunded payment keeps status 'refunded' with amount_paid
  // unchanged, so include refunded rows too and net out refund_amount (never
  // below 0 per row) — otherwise the whole receipt vanishes and dues overstate.
  const totalPaid = payments
    .filter(
      (p) =>
        p.status === "paid" ||
        p.status === "partial" ||
        p.status === "refunded"
    )
    .reduce(
      (sum, p) =>
        sum +
        Math.max(
          0,
          Number(p.amount_paid) - Number(p.refund_amount ?? 0)
        ) +
        Number(p.waiver_amount ?? 0),
      0
    );
  const pending = billedToDate - totalPaid;

  // Lines marked paid: match by fee_structure_id (academic) or
  // bus_stop_id (transport). Both keys live in EffectiveFeeLine.id by
  // construction, so a single Set covers both.
  const paidLineIds = new Set(
    payments
      .filter((p) => p.status === "paid")
      .map((p) => p.fee_structure_id ?? p.bus_stop_id)
      .filter((id): id is string => Boolean(id))
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          My Fees
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          View your fee structure and payment history.
        </p>
      </div>

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
            <p className="text-3xl font-bold text-green-600">
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
            <p className="text-3xl font-bold text-red-600">
              {formatCurrency(pending > 0 ? pending : 0)}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {billedToDate < totalFees
                ? `Instalments due so far: ${formatCurrency(billedToDate)}. The rest falls due later in the session.`
                : "All instalments for the session have fallen due."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Fee Breakdown */}
      <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-navy-900 dark:text-white">Fee Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {feeLines.length === 0 ? (
            <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
              No fee structures found for your class.
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
    </div>
  );
}
