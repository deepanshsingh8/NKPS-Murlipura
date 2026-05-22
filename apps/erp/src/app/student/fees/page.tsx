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
import { resolveEffectiveFeeLines, sumAnnualized } from "@/lib/fees";
import type {
  FeeStructure,
  FeePayment,
  TransportFareSlab,
  EffectiveFeeLine,
} from "@nkps/shared/types";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

export default function StudentFeesPage() {
  const [loading, setLoading] = useState(true);
  const [feeLines, setFeeLines] = useState<EffectiveFeeLine[]>([]);
  const [payments, setPayments] = useState<
    (FeePayment & {
      fee_structure?: FeeStructure;
      transport_slab?: Pick<TransportFareSlab, "name"> | null;
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
          "class_id, stream_id, academic_year_id, has_transport, transport_slab_id, classes(name)"
        )
        .eq("student_id", studentId)
        .order("enrollment_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const className =
        (enrollment?.classes as unknown as { name: string } | null)?.name ?? "";
      const streamId = (enrollment?.stream_id as string | null) ?? null;
      const hasTransport = Boolean(enrollment?.has_transport);
      const transportSlabId =
        (enrollment?.transport_slab_id as string | null) ?? null;
      const academicYearId =
        (enrollment?.academic_year_id as string | null) ?? null;

      // Fetch fee structures for student's class + transport slab catalog,
      // then resolve unified fee lines (academic + the picked transport slab).
      if (className) {
        const [{ data: structuresData }, { data: slabsData }] = await Promise.all([
          supabase.from("fee_structures").select("*").eq("class_name", className),
          academicYearId
            ? supabase
                .from("transport_fare_slabs")
                .select("id, name, amount, frequency, is_active")
                .eq("academic_year_id", academicYearId)
            : Promise.resolve({ data: [] }),
        ]);
        const resolved = resolveEffectiveFeeLines({
          structures: (structuresData as FeeStructure[]) ?? [],
          studentStreamId: streamId,
          hasTransport,
          transportSlabId,
          slabs: (slabsData as TransportFareSlab[]) ?? [],
        });
        setFeeLines(resolved);
      }

      // Fetch payments — also pull the slab name so the history table can
      // show "Transport — 0–5 km" instead of falling back to "--".
      const { data: paymentData } = await supabase
        .from("fee_payments")
        .select(
          "*, fee_structure:fee_structures(*), transport_slab:transport_fare_slabs(name)"
        )
        .eq("student_id", studentId)
        .order("payment_date", { ascending: false });

      setPayments(
        (paymentData as (FeePayment & {
          fee_structure?: FeeStructure;
          transport_slab?: Pick<TransportFareSlab, "name"> | null;
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

  // Compute summary — annualize each line so quarterly/monthly fees are
  // counted correctly for the whole academic year.
  const totalFees = sumAnnualized(feeLines);
  const totalPaid = payments
    .filter((p) => p.status === "paid" || p.status === "partial")
    .reduce((sum, p) => sum + p.amount_paid, 0);
  const pending = totalFees - totalPaid;

  // Lines marked paid: match by fee_structure_id (academic) or
  // transport_slab_id (transport). Both keys live in EffectiveFeeLine.id by
  // construction, so a single Set covers both.
  const paidLineIds = new Set(
    payments
      .filter((p) => p.status === "paid")
      .map((p) => p.fee_structure_id ?? p.transport_slab_id)
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
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-600">
              {formatCurrency(pending > 0 ? pending : 0)}
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
                      {line.kind === "transport_slab"
                        ? `Transport — ${line.slab_name}`
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
                      {p.transport_slab?.name
                        ? `Transport — ${p.transport_slab.name}`
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
