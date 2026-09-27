"use client";

import { useEffect, useState, useCallback, useMemo, Suspense, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { todayISO } from "@nkps/shared/lib/date";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import { fetchAllRows } from "@nkps/shared/lib/fetch-all-rows";
import {
  useTablePagination,
  TablePaginationBar,
} from "@nkps/shared/components/ui/data-table";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { TableExportButton } from "@nkps/shared/components/ui/table-export-button";
import { AcademicSessionPicker } from "@nkps/shared/components/AcademicSessionPicker";
import { useAcademicSession } from "@nkps/shared/lib/hooks/use-academic-session";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nkps/shared/components/ui/tabs";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import { toast } from "sonner";
import Link from "next/link";
import { Plus, Pencil, Trash2, Loader2, Search, CreditCard, Banknote, Download, ArrowLeft, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { adminApi, adminFetch } from "@nkps/shared/lib/admin-api";
import { cn, formatClassName } from "@nkps/shared/lib/utils";
import { classSortIndex, CLASS_ORDER } from "@nkps/shared/lib/constants";
import { FeeScheduleImportDialog } from "@/components/FeeScheduleImportDialog";
import { StudentConcessionImportDialog } from "@/components/StudentConcessionImportDialog";
import { useIsAdmin } from "@nkps/shared/hooks/useIsAdmin";
import {
  resolveEffectiveFeeStructures,
  resolveEffectiveFeeLines,
  resolveStudentType,
  computeDuesBreakdown,
  resolveBillingCutoff,
  computeLateFee,
  annualizedAmount,
  settledAmount,
  feeLineLabel,
  type BillableEnrollment,
  type DuesBreakdown,
  type StopFeeLookup,
} from "@/lib/fees";
import { FEE_HEADS } from "@nkps/shared/types";
import type {
  FeeStructure,
  FeePayment,
  Student,
  Stream,
  EffectiveFeeLine,
  TransportDirection,
  FeeFrequency,
  FeeStudentType,
} from "@nkps/shared/types";
import { HistoricalFeesImportDialog } from "@/components/HistoricalFeesImportDialog";
import { DayBookImportDialog } from "@/components/DayBookImportDialog";
import { ImportHistoryPanel } from "@/components/ImportHistoryPanel";
import { FeeScheduleGrid } from "./FeeScheduleGrid";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";

// The class list is CLASS_ORDER from shared constants. It used to be
// retyped in this file (and two others), which is three places for the
// school's class list to disagree with itself.
const CLASS_NAMES: readonly string[] = CLASS_ORDER;

const STREAM_CLASSES = ["XI", "XII"];

// Heads offered by the single-row dialog. FEE_HEADS carries the schedule's
// vocabulary ("Tuition Fee", "Admission Fee"); the older short labels stay
// listed so pre-085 rows keep their own head when edited here.
const FEE_TYPES = [...FEE_HEADS, "Tuition", "Lab", "Annual", "Other"];

const STUDENT_TYPE_OPTIONS: { value: FeeStudentType; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "new", label: "New Student" },
  { value: "existing", label: "Old Student" },
];
const FREQUENCIES = ["monthly", "quarterly", "annual", "one_time"] as const;
const PAYMENT_METHODS = [
  "cash",
  "online",
  "cheque",
  "bank_transfer",
] as const;

const EMPTY_STRUCTURE = {
  class_name: CLASS_NAMES[0],
  stream_id: "" as string,
  fee_type: FEE_TYPES[0],
  amount: "",
  frequency: "monthly" as (typeof FREQUENCIES)[number],
  due_date: "",
  instalment_name: "",
  month_label: "",
  student_type: "both" as FeeStudentType,
  late_fee_start_date: "",
  late_fee_percent: "",
  late_fee_per_day: "",
  late_fee_max: "",
};

interface ClassEntry {
  id: string;
  name: string;
  section: string;
  stream_id: string | null;
  streams: { name: string } | { name: string }[] | null;
}

// PostgREST returns a to-one embed as an object, but the generated types
// widen it to an array. Both shapes are normalised through pickEmbedded.
type EmbeddedClass =
  | { name: string; section: string; streams?: { name: string } | { name: string }[] | null }
  | { name: string; section: string; streams?: { name: string } | { name: string }[] | null }[]
  | null;

function pickEmbedded<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

// "V — A · Science". Same label the class picker shows, built from an
// enrollment's embedded class rather than from the class list.
function embeddedClassLabel(c: EmbeddedClass): string {
  const cls = pickEmbedded(c);
  if (!cls) return "";
  const stream = pickEmbedded(cls.streams)?.name ?? null;
  return formatClassName({
    name: cls.name,
    section: cls.section,
    stream_name: stream,
  });
}

interface RosterStudent {
  id: string;
  full_name: string;
  admission_no: string;
  father_name: string | null;
  /** Empty when the enrollment carries no class — shown as "Unassigned". */
  class_label: string;
}

interface DuesRow {
  student_id: string;
  admission_no: string;
  full_name: string;
  father_name: string | null;
  class_label: string;
  has_transport: boolean;
  // Whole-year obligation — what the class's schedule totals for this student.
  // For a leaver it is the obligation up to `billing_cutoff` instead: their
  // year ended when they did.
  expected: number;
  // The slice of `expected` that has actually fallen due as of today (or as of
  // `billing_cutoff`, for a leaver). Dues are measured against this, not the
  // annual figure: an instalment due in January is not an arrear in August.
  billed_to_date: number;
  paid: number;
  // Late-fee surcharge auto-applied when at least one applicable fee
  // structure has a due_date in the past. Computed per overdue structure as
  //   min( max( amount * late_fee_percent/100, daysOverdue * late_fee_per_day ),
  //        late_fee_max || Infinity )
  // then summed.
  late_fee: number;
  dues: number;
  // The enrollment's status. Always 'active' unless "Include students who
  // left" is on — in which case the register must say which rows are leavers,
  // or the office cannot tell an arrear it should chase from one it should not.
  enrollment_status: string;
  // The leaving date this row was priced to, for leavers. Shown on the badge:
  // an operator looking at a frozen figure should be able to see the date it
  // froze on without opening the student.
  billing_cutoff: string | null;
}

export type FeesSection = "academic" | "payments" | "dues";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

/**
 * The selected student's balance, shown on the Record & History screen.
 *
 * Previously the only place a due figure existed was the class-wide register,
 * so answering "does this child owe anything?" meant leaving the student you
 * had just looked up and searching for them again in a list of forty. The
 * headline here answers it in place; the register link is for when you
 * genuinely do want the whole class.
 */
function StudentDuesSummary({
  dues,
  loading,
  classId,
}: {
  dues: DuesBreakdown;
  loading: boolean;
  classId: string | null;
}) {
  const owes = dues.dues > 0;
  return (
    <div
      className={cn(
        "mb-6 rounded-xl border p-4",
        owes
          ? "border-red-200 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20"
          : "border-green-200 bg-green-50/60 dark:border-green-900/40 dark:bg-green-950/20"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Outstanding Dues
          </p>
          {loading ? (
            <Loader2 className="mt-1 h-5 w-5 animate-spin text-gray-400" />
          ) : (
            <p
              className={cn(
                "text-2xl font-bold tabular-nums",
                owes
                  ? "text-red-700 dark:text-red-400"
                  : "text-green-700 dark:text-green-400"
              )}
            >
              {owes ? inr(dues.dues) : "No dues"}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            As of{" "}
            {new Date().toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            . Instalments falling due later this session are not counted.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <DuesFigure label="Annual Fee" value={inr(dues.expected)} muted />
          <DuesFigure label="Due Till Date" value={inr(dues.billedToDate)} />
          <DuesFigure label="Paid" value={inr(dues.paid)} />
          {dues.lateFee > 0 && (
            <DuesFigure
              label="Late Fee"
              value={inr(dues.lateFee)}
              className="text-amber-700 dark:text-amber-400"
            />
          )}
        </div>
      </div>

      {classId && (
        <Link
          href={`/fees/dues?dues_class_id=${classId}`}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          View the whole class register
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

/**
 * One side of the dues register — either the students who owe, or the ones who
 * are clear. Rendered as its own component so each list owns its column
 * sort/filter state: sorting the Dues tab must not reorder the No-Dues tab.
 *
 * Each name links back to that student's Record & History, which is the trip
 * an operator actually makes from here — spot a defaulter, go take the money.
 */
function DuesTable({
  rows,
  emptyMessage,
  showClass,
  showLeftOn,
  exportName,
  exportTitle,
}: {
  rows: DuesRow[];
  emptyMessage: string;
  /** Off when a single class is selected — the column would repeat one value. */
  showClass: boolean;
  /**
   * On only when "Include students who left" is on. Off it would be a column
   * of dashes, since every row is then a student still on the roll.
   */
  showLeftOn: boolean;
  exportName: string;
  exportTitle: string;
}) {
  const columns = useMemo<TableColumns<DuesRow>>(
    () => ({
      admission_no: {
        label: "Adm No",
        value: (r) => r.admission_no || null,
        filter: "text",
      },
      full_name: { label: "Name", value: (r) => r.full_name, filter: "text" },
      class_label: {
        label: "Class",
        value: (r) => r.class_label || null,
        emptyLabel: "Unassigned",
      },
      father_name: {
        label: "Father",
        value: (r) => r.father_name || null,
        filter: "text",
      },
      transport: {
        label: "Transport",
        value: (r) => (r.has_transport ? "Yes" : "No"),
      },
      // A leaver's money columns are frozen on this date. Without it a
      // downloaded register reads as if every figure were priced to today,
      // which is exactly the wrong impression for a student who left in June.
      ...(showLeftOn
        ? {
            billing_cutoff: {
              label: "Left On",
              value: (r: DuesRow) => r.billing_cutoff,
              sortValue: (r: DuesRow) => r.billing_cutoff ?? "",
              emptyLabel: "On roll",
            },
          }
        : {}),
      // `sortValue` already holds the raw rupee amount for each of these, so
      // `exportFormat` is all it takes for the exported column to be a number
      // Excel can total — rather than the "₹1,23,456" text it shows on screen.
      expected: {
        label: "Annual Fee",
        value: (r) => inr(r.expected),
        sortValue: (r) => r.expected,
        exportFormat: "currency",
      },
      billed_to_date: {
        label: "Due Till Date",
        value: (r) => inr(r.billed_to_date),
        sortValue: (r) => r.billed_to_date,
        exportFormat: "currency",
      },
      paid: {
        label: "Paid",
        value: (r) => inr(r.paid),
        sortValue: (r) => r.paid,
        exportFormat: "currency",
      },
      late_fee: {
        label: "Late Fee",
        value: (r) => (r.late_fee > 0 ? inr(r.late_fee) : null),
        sortValue: (r) => r.late_fee,
        emptyLabel: "None",
        exportFormat: "currency",
      },
      dues: {
        label: "Dues",
        value: (r) => (r.dues > 0 ? inr(r.dues) : "Nil"),
        sortValue: (r) => r.dues,
        exportFormat: "currency",
      },
      // Replaces the three separate "export all / with dues / cleared"
      // buttons: as a column it filters the table on screen as well, and it
      // cannot disagree with what gets downloaded — the old buttons each used
      // a different row set, so two of them exported something other than what
      // the reader was looking at.
      dues_bucket: {
        label: "Dues Status",
        value: (r) => (r.dues > 0 ? "Has dues" : "Cleared"),
      },
    }),
    [showLeftOn]
  );

  const table = useTableControls({ rows, columns });
  // Keyed on the filter summary so applying a column filter lands on page 1
  // rather than on whatever page number was left over from the wider set.
  const pagination = useTablePagination(table.rows, {
    defaultPageSize: 50,
    resetKey: `${exportName}:${table.filterSummary
      .map((f) => `${f.label}=${f.value}`)
      .join("|")}`,
  });

  if (rows.length === 0) {
    return (
      <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <TableFilterSummary
          ctl={table}
          total={rows.length}
          shown={table.rows.length}
          className="mb-0 mr-auto"
        />
        <TableExportButton
          ctl={table}
          filename={exportName}
          title={exportTitle}
          featureKey="fees"
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <SortFilterHead ctl={table} col="admission_no" />
            <SortFilterHead ctl={table} col="full_name" />
            {showClass && <SortFilterHead ctl={table} col="class_label" />}
            <SortFilterHead ctl={table} col="father_name" />
            <SortFilterHead ctl={table} col="transport" />
            <SortFilterHead ctl={table} col="expected" align="right" />
            <SortFilterHead ctl={table} col="billed_to_date" align="right" />
            <SortFilterHead ctl={table} col="paid" align="right" />
            <SortFilterHead ctl={table} col="late_fee" align="right" />
            <SortFilterHead ctl={table} col="dues" align="right" />
            <SortFilterHead ctl={table} col="dues_bucket" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagination.total === 0 && (
            <TableRow>
              <TableCell
                colSpan={showClass ? 11 : 10}
                className="py-10 text-center text-gray-500 dark:text-gray-400"
              >
                No students match the column filters.
              </TableCell>
            </TableRow>
          )}
          {pagination.pageRows.map((r) => (
            <TableRow key={r.student_id}>
              <TableCell className="font-medium">{r.admission_no}</TableCell>
              <TableCell>
                <Link
                  href={`/fees/payments?student_id=${r.student_id}`}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                  title="Open this student's payments & history"
                >
                  {r.full_name}
                </Link>
                {/* Only ever set when "Include students who left" is on. A
                    leaver's arrears are historical, not something to chase. */}
                {r.enrollment_status !== "active" && (
                  <Badge
                    className="ml-2 bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300"
                    title={
                      r.billing_cutoff
                        ? `Billing stopped on ${r.billing_cutoff}. Nothing due after this date is charged.`
                        : "No leaving date on record, so this student is still being billed to today. Set one on People \u2192 Students."
                    }
                  >
                    {r.enrollment_status === "terminated" ? "Terminated" : "Left"}
                    {r.billing_cutoff ? ` \u00b7 ${r.billing_cutoff}` : ""}
                  </Badge>
                )}
              </TableCell>
              {showClass && (
                <TableCell className="text-gray-600 dark:text-gray-300">
                  {r.class_label || "Unassigned"}
                </TableCell>
              )}
              <TableCell className="text-gray-600 dark:text-gray-300">
                {r.father_name || "—"}
              </TableCell>
              <TableCell>
                {r.has_transport ? (
                  <Badge className="bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200">
                    Yes
                  </Badge>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </TableCell>
              <TableCell className="text-right text-gray-500 dark:text-gray-400">
                {inr(r.expected)}
              </TableCell>
              <TableCell className="text-right">
                {inr(r.billed_to_date)}
              </TableCell>
              <TableCell className="text-right">{inr(r.paid)}</TableCell>
              <TableCell className="text-right text-amber-700 dark:text-amber-400">
                {r.late_fee > 0 ? inr(r.late_fee) : "—"}
              </TableCell>
              <TableCell className="text-right font-medium">
                {r.dues > 0 ? (
                  <span className="text-red-600 dark:text-red-400">{inr(r.dues)}</span>
                ) : (
                  <span className="text-green-600 dark:text-green-400">Nil</span>
                )}
              </TableCell>
              <TableCell>
                <span
                  className={
                    r.dues > 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-green-700 dark:text-green-400"
                  }
                >
                  {r.dues > 0 ? "Has dues" : "Cleared"}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* Export stays bound to the controller's full row list, not this page:
          exporting only what is on screen would hand someone a partial
          arrears report that looks complete. */}
      <TablePaginationBar ctl={pagination} noun="students" />
    </>
  );
}

/**
 * The late-fee terms on one fee line, and whether they are currently biting.
 *
 * Transport lines carry no surcharge and schedule rows often leave it unset,
 * so this renders nothing at all in the common case rather than a row of
 * "Late fee: none" noise.
 */
function LateFeeNote({
  line,
  settled,
}: {
  line: EffectiveFeeLine;
  /** Net cash + waivers recorded against this line for the year. */
  settled: number;
}) {
  const pct = Number(line.late_fee_percent ?? 0);
  const perDay = Number(line.late_fee_per_day ?? 0);
  if (pct === 0 && perDay === 0) return null;

  const anchor = line.late_fee_start_date ?? line.due_date;
  const today = todayISO();
  // Only "accruing" when the line itself is still owed. A line paid on time
  // incurs nothing however overdue its neighbours are.
  const outstanding = settled < annualizedAmount(line);
  const accrued = outstanding ? computeLateFee(line, today) : 0;

  const rule = [
    pct > 0 ? `${pct}% of the instalment` : null,
    perDay > 0 ? `${inr(perDay)}/day` : null,
  ].filter(Boolean);
  const ruleText =
    rule.length === 2 ? `${rule[0]} or ${rule[1]}, whichever is greater` : rule[0];
  const cap =
    line.late_fee_max != null ? `, capped at ${inr(Number(line.late_fee_max))}` : "";

  return (
    <div className="mt-2 border-t border-dashed border-gray-200 pt-1.5 dark:border-gray-700">
      <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
        <span className="font-medium text-amber-700 dark:text-amber-500">
          Late fee
        </span>
        {accrued > 0 ? (
          <>
            {" "}
            <span className="font-semibold text-amber-700 dark:text-amber-500">
              {inr(accrued)}
            </span>{" "}
            accruing —{" "}
          </>
        ) : (
          ": "
        )}
        {ruleText}
        {cap}
        {anchor ? ` — from ${anchor}` : " — no start date set"}
      </p>
    </div>
  );
}

function DuesFigure({
  label,
  value,
  muted,
  className,
}: {
  label: string;
  value: string;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={cn(
          "font-semibold tabular-nums",
          muted
            ? "text-gray-500 dark:text-gray-400"
            : "text-navy-900 dark:text-white",
          className
        )}
      >
        {value}
      </p>
    </div>
  );
}

interface AdminFeesContentInnerProps {
  section: FeesSection;
}

// The previous tab-driven layout collapsed every fee surface — academic
// structures, transport slabs, payments, dues — into one screen. Sub-routes
// now drive navigation via the sidebar, so this component renders only the
// section the caller asks for and drops the outer Tabs nav entirely.
function AdminFeesContentInner({ section }: AdminFeesContentInnerProps) {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const initialStudentId = searchParams.get("student_id");

  // Caller role — admins refund/edit directly; editors must file change
  // requests instead. Stays null until loaded, which keeps the dialog
  // disabled rather than guessing wrong. (See migration-056 + the
  // EDITOR_MUST_REQUEST gate in /api/admin and /api/fees/.../refund.)
  const [userRole, setUserRole] = useState<"admin" | "editor" | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setUserRole(data?.role === "admin" ? "admin" : "editor");
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);
  const isEditor = userRole === "editor";

  // Fee structures state
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [structuresLoading, setStructuresLoading] = useState(true);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [classFilter, setClassFilter] = useUrlState("class_name");
  const [streams, setStreams] = useState<Stream[]>([]);
  const [structureDialogOpen, setStructureDialogOpen] = useState(false);
  const [structureDialogMode, setStructureDialogMode] = useState<"add" | "edit">("add");
  const [editingStructureId, setEditingStructureId] = useState<string | null>(null);
  const [structureSubmitting, setStructureSubmitting] = useState(false);
  const [structureForm, setStructureForm] = useState(EMPTY_STRUCTURE);

  // Payments state
  const [studentResults, setStudentResults] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedStudentStreamId, setSelectedStudentStreamId] = useState<
    string | null
  >(null);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string | null>(null);
  const [selectedClassLabel, setSelectedClassLabel] = useState<string>("");
  // The student's own class, so the dues card can deep-link to that class's
  // register even when the student was reached by name search rather than by
  // picking a class first.
  const [selectedStudentClassId, setSelectedStudentClassId] = useState<string | null>(null);
  // Last date the selected student may be billed for — see resolveBillingCutoff().
  const [selectedBillingCutoff, setSelectedBillingCutoff] = useState<string | null>(null);
  // Transport state for the selected student. Stop/fee/bus assignment now
  // lives in the standalone /transport section (migration 074); Payments only
  // reads the assigned stop so the office can bill a transport payment.
  const [studentHasTransport, setStudentHasTransport] = useState(false);
  const [studentBusStopId, setStudentBusStopId] = useState<string | null>(null);
  const [studentTransportDirection, setStudentTransportDirection] =
    useState<TransportDirection>("both");
  const [studentTransportFeeOverride, setStudentTransportFeeOverride] =
    useState<number | null>(null);
  // Resolved from bus_stop_fees for the current academic year — the stop's
  // display name and its flat per-year fee (before any one-side override).
  const [studentStopName, setStudentStopName] = useState("");
  const [studentStopFeeAmount, setStudentStopFeeAmount] = useState<
    number | null
  >(null);
  const [studentStopFeeFrequency, setStudentStopFeeFrequency] =
    useState<FeeFrequency>("monthly");
  const [studentFeeStructures, setStudentFeeStructures] = useState<
    FeeStructure[]
  >([]);
  const [studentPayments, setStudentPayments] = useState<
    (FeePayment & {
      fee_structure?: FeeStructure;
      bus_stop?: { name: string } | null;
    })[]
  >([]);
  const isAdmin = useIsAdmin();
  // Bumped after an import so the history panel refetches.
  const [importHistoryKey, setImportHistoryKey] = useState(0);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // Payments tab: class-driven roster picker. Pick a class → see students →
  // click one → land on the existing per-student detail view. Falls back to
  // the global name search when no class is selected.
  const [paymentsClassId, setPaymentsClassId] = useUrlState("payments_class_id");
  const [classStudents, setClassStudents] = useState<RosterStudent[]>([]);
  const [classStudentsLoading, setClassStudentsLoading] = useState(false);
  const [classStudentSearch, setClassStudentSearch] = useState("");

  // Dues tab state
  const [classesList, setClassesList] = useState<ClassEntry[]>([]);
  const [duesClassId, setDuesClassId] = useUrlState("dues_class_id");
  // Mid-session leavers are excluded from the register by default: chasing
  // someone who has left for an instalment they will never owe is noise.
  // But their receipts are part of the session's collection, and after the
  // day-book backfill a chunk of the money belongs to students no longer on
  // the roster — so the office needs to be able to see them on demand.
  const [includeLeavers, setIncludeLeavers] = useState(false);
  // Which side of the register is open, in the URL so the dashboard's
  // "Paid" / "Remaining" tiles can land on the matching list.
  const [duesTab, setDuesTab] = useUrlState("dues_tab", "dues-list");
  const [duesSearch, setDuesSearch] = useState("");
  const [duesRows, setDuesRows] = useState<DuesRow[]>([]);
  const [duesLoading, setDuesLoading] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [newPayment, setNewPayment] = useState({
    // The dropdown encodes its choice as either "fs:<uuid>" (fee_structure_id)
    // or "stop:<uuid>" (bus_stop_id); we decode at submit time. Keeps the state
    // model simple and the UI single-select even though the underlying FK lives
    // on two columns.
    fee_target: "",
    amount_paid: "",
    payment_method: "cash" as (typeof PAYMENT_METHODS)[number],
    month: "",
    cheque_number: "",
    cheque_date: "",
    bank_name: "",
    payer_name: "",
    transaction_ref: "",
    payment_provider: "",
  });

  // Refund + waiver dialog state (M9). Keeping the two flows separate so the
  // surface area on the existing record-payment dialog stays small.
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null);
  const [refundMaxAmount, setRefundMaxAmount] = useState<number>(0);
  const [refundForm, setRefundForm] = useState({ amount: "", reason: "" });
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  const [waiverOpen, setWaiverOpen] = useState(false);
  const [waiverForm, setWaiverForm] = useState({
    fee_structure_id: "",
    waiver_amount: "",
    waiver_reason: "",
    month: "",
  });
  const [waiverSubmitting, setWaiverSubmitting] = useState(false);

  // Academic year. The date range is needed as well as the id: a student
  // counts as "new" (and so owes the admission fee) when their admission date
  // falls inside the year being billed.
  const session = useAcademicSession();
  const sessionId = session.sessionId;

  const [academicYearId, setAcademicYearId] = useState("");
  const [academicYearRange, setAcademicYearRange] = useState<{
    start_date: string | null;
    end_date: string | null;
  } | null>(null);

  // Every fee query on this page keys off `academicYearId` — structures,
  // payments, stop fees, the dues calculation and its late-fee window — so
  // pointing this one lookup at the session picker makes the whole register
  // session-aware, rather than permanently pinned to whichever year carries
  // the is_current flag.
  const fetchAcademicYear = useCallback(async () => {
    let query = supabase.from("academic_years").select("id, start_date, end_date");
    query = sessionId ? query.eq("id", sessionId) : query.eq("is_current", true);
    const { data } = await query.maybeSingle();
    if (data) {
      setAcademicYearId(data.id as string);
      setAcademicYearRange({
        start_date: (data.start_date as string | null) ?? null,
        end_date: (data.end_date as string | null) ?? null,
      });
    }
  }, [supabase, sessionId]);

  const fetchStreams = useCallback(async () => {
    // kind='stream' only: this list is both the fee-structure stream picker
    // and the label map for a stored fee_structures.stream_id, and a wing can
    // never legitimately be either. (migration 118)
    const { data } = await supabase
      .from("streams")
      .select("*")
      .eq("kind", "stream")
      .eq("is_active", true)
      .order("sort_order");
    setStreams((data as Stream[]) ?? []);
  }, [supabase]);

  const fetchFeeStructures = useCallback(async () => {
    let query = supabase
      .from("fee_structures")
      .select("*")
      .order("class_name", { ascending: true });

    if (classFilter) {
      query = query.eq("class_name", classFilter);
    }

    const { data, error } = await query;
    if (error) {
      toast.error("Failed to fetch fee structures");
      return;
    }
    setFeeStructures((data as FeeStructure[]) ?? []);
    setStructuresLoading(false);
  }, [supabase, classFilter]);

  useEffect(() => {
    fetchAcademicYear();
    fetchStreams();
  }, [fetchAcademicYear, fetchStreams]);

  useEffect(() => {
    fetchFeeStructures();
  }, [fetchFeeStructures]);

  const streamById = useMemo(() => {
    const map: Record<string, string> = {};
    streams.forEach((s) => {
      map[s.id] = s.code ? `${s.name} (${s.code})` : s.name;
    });
    return map;
  }, [streams]);

  // Search students (from students table, not profiles)
  // Select a student and load their data
  const selectStudent = useCallback(async (student: Student) => {
    setSelectedStudent(student);
    setStudentResults([]);
    setPaymentsLoading(true);

    // Get active enrollment to determine class + stream + transport opt-in.
    // Transport assignment (stop/bus/direction) is managed in the /transport
    // section; here we only read what we need to bill the assigned stop.
    const { data: enrollment } = await supabase
      .from("student_enrollments")
      .select(
        "id, class_id, stream_id, has_transport, bus_stop_id, transport_direction, transport_fee_override, status, exit_date, status_changed_at, classes(name, section)"
      )
      .eq("student_id", student.id)
      .order("enrollment_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const classRaw = (enrollment?.classes as unknown as { name: string; section: string } | null) ?? null;
    const className = classRaw?.name ?? "";
    const streamId = enrollment?.stream_id ?? null;
    const hasTransport = Boolean(enrollment?.has_transport);
    const busStopId = (enrollment?.bus_stop_id as string | null) ?? null;
    const direction =
      (enrollment?.transport_direction as TransportDirection | null) ?? "both";
    const feeOverride =
      enrollment?.transport_fee_override != null
        ? Number(enrollment.transport_fee_override)
        : null;
    setSelectedStudentStreamId(streamId);
    setSelectedEnrollmentId(enrollment?.id ?? null);
    // Null while the student is on the roll; their leaving date once they are
    // not, which is what stops the schedule charging them past their exit.
    setSelectedBillingCutoff(resolveBillingCutoff(enrollment));
    setSelectedStudentClassId((enrollment?.class_id as string | null) ?? null);
    setStudentHasTransport(hasTransport);
    setStudentBusStopId(busStopId);
    setStudentTransportDirection(direction);
    setStudentTransportFeeOverride(feeOverride);
    setSelectedClassLabel(
      classRaw ? `${classRaw.name}${classRaw.section ? " - " + classRaw.section : ""}` : ""
    );

    // Resolve the stop's fee for the current academic year so Payments can
    // offer a transport line. Only meaningful when the student is opted in
    // and actually assigned to a stop.
    if (hasTransport && busStopId && academicYearId) {
      const { data: stopFee, error: stopFeeError } = await supabase
        .from("bus_stop_fees")
        .select("amount, frequency, is_active, bus_stops(name)")
        .eq("bus_stop_id", busStopId)
        .eq("academic_year_id", academicYearId)
        .eq("is_active", true)
        .maybeSingle();
      // Distinguish "this stop has no fee configured" from "the read failed":
      // the else branch below clears the transport line, and an operator who
      // sees it missing would reasonably conclude the student owes nothing for
      // the bus and take a payment short of what is due.
      if (stopFeeError) {
        toast.error("Couldn't load the transport fee for this stop");
      }
      if (stopFee) {
        const stopMeta =
          (stopFee.bus_stops as unknown as { name: string } | null) ?? null;
        setStudentStopName(stopMeta?.name ?? "");
        setStudentStopFeeAmount(Number(stopFee.amount));
        setStudentStopFeeFrequency(
          (stopFee.frequency as FeeFrequency) ?? "monthly"
        );
      } else {
        setStudentStopName("");
        setStudentStopFeeAmount(null);
        setStudentStopFeeFrequency("monthly");
      }
    } else {
      setStudentStopName("");
      setStudentStopFeeAmount(null);
      setStudentStopFeeFrequency("monthly");
    }

    // Fetch fee structures for student's class. Filter by stream:
    //  - rows with stream_id IS NULL always apply
    //  - rows with matching stream_id apply
    if (className) {
      let query = supabase
        .from("fee_structures")
        .select("*")
        // Only live rows for the year being billed. A schedule row that was
        // already receipted can't be hard-deleted, so removing it from the
        // schedule flips is_active instead — those must not reappear here.
        .eq("class_name", className)
        .eq("is_active", true);
      if (academicYearId) {
        query = query.eq("academic_year_id", academicYearId);
      }

      if (streamId) {
        query = query.or(`stream_id.is.null,stream_id.eq.${streamId}`);
      } else {
        query = query.is("stream_id", null);
      }

      const { data: structures } = await query;
      setStudentFeeStructures((structures as FeeStructure[]) ?? []);
    } else {
      setStudentFeeStructures([]);
    }

    // Fetch payment history. Academic payments carry a fee_structure; transport
    // payments carry a bus_stop (migration 074 replaced the old fare slab).
    const { data: payments } = await supabase
      .from("fee_payments")
      .select("*, fee_structure:fee_structures(*), bus_stop:bus_stops(name)")
      .eq("student_id", student.id)
      .order("payment_date", { ascending: false });

    setStudentPayments(
      (payments as (FeePayment & {
        fee_structure?: FeeStructure;
        bus_stop?: { name: string } | null;
      })[]) ?? []
    );
    setPaymentsLoading(false);
  }, [supabase, academicYearId]);

  // Re-fetch the full Student row by id (the roster select only carries a few
  // columns) and hand off to the existing detail loader.
  const selectStudentById = useCallback(
    async (id: string) => {
      const { data } = await supabase
        .from("students")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (data) await selectStudent(data as Student);
    },
    [supabase, selectStudent]
  );

  const clearSelectedStudent = useCallback(() => {
    setSelectedStudent(null);
    setSelectedStudentStreamId(null);
    setSelectedEnrollmentId(null);
    setSelectedClassLabel("");
    setSelectedStudentClassId(null);
    setStudentHasTransport(false);
    setStudentBusStopId(null);
    setStudentTransportDirection("both");
    setStudentTransportFeeOverride(null);
    setStudentStopName("");
    setStudentStopFeeAmount(null);
    setStudentStopFeeFrequency("monthly");
    setStudentFeeStructures([]);
    setStudentPayments([]);
    setStudentResults([]);
  }, []);

  // Deep-link: if ?student_id=... is in URL, auto-select that student once.
  useEffect(() => {
    if (!initialStudentId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("*")
        .eq("id", initialStudentId)
        .maybeSingle();
      if (!cancelled && data) {
        await selectStudent(data as Student);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialStudentId, supabase, selectStudent]);

  // Fetch classes once (for dues tab filter)
  useEffect(() => {
    if (!academicYearId) return;
    (async () => {
      const { data } = await supabase
        .from("classes")
        .select("id, name, section, stream_id, streams(name)")
        .eq("academic_year_id", academicYearId)
        .order("sort_order");
      setClassesList((data as ClassEntry[]) ?? []);
    })();
  }, [supabase, academicYearId]);

  // The Payments roster. With no class picked this is every enrolled student
  // in the year — the screen opens on the full list rather than an empty
  // "pick a class first" prompt, which is how the Students section behaves.
  // Picking a class narrows it.
  useEffect(() => {
    if (!academicYearId) {
      setClassStudents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setClassStudentsLoading(true);
      let query = supabase
        .from("student_enrollments")
        .select(
          "students(id, full_name, admission_no, father_name, is_active), classes(name, section, streams(name))"
        )
        .eq("academic_year_id", academicYearId)
        .eq("status", "active");
      if (paymentsClassId) query = query.eq("class_id", paymentsClassId);
      // Paged. A .range() cannot lift PostgREST's db-max-rows cap, and the
      // school is at 942 active students against a cap of 1000 — a truncated
      // roster here means a student the office cannot find to take money from,
      // with nothing on screen to say why.
      const { data } = await fetchAllRows<Record<string, unknown>>((from, to) =>
        query.range(from, to)
      );
      if (cancelled) return;
      type Row = {
        students: {
          id: string;
          full_name: string;
          admission_no: string;
          father_name: string | null;
          is_active: boolean;
        } | null;
        classes: EmbeddedClass;
      };
      const rows = ((data as unknown as Row[]) ?? [])
        .filter((r) => Boolean(r.students?.is_active))
        .map((r) => ({
          id: r.students!.id,
          full_name: r.students!.full_name,
          admission_no: r.students!.admission_no,
          father_name: r.students!.father_name,
          class_label: embeddedClassLabel(r.classes),
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
      setClassStudents(rows);
      setClassStudentsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentsClassId, academicYearId, supabase]);

  const filteredClassStudents = useMemo(() => {
    const q = classStudentSearch.trim().toLowerCase();
    if (!q) return classStudents;
    return classStudents.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.admission_no.toLowerCase().includes(q) ||
        (s.father_name ?? "").toLowerCase().includes(q)
    );
  }, [classStudents, classStudentSearch]);

  // The roster covers this year's enrolments. A student who has none — an
  // alumnus, or someone yet to be placed in a class — is still someone the
  // office may need to pull a receipt for, so when the roster filter comes up
  // empty we fall back to searching all student records. Only then: showing
  // both at once made one search box mean two things.
  useEffect(() => {
    const q = classStudentSearch.trim();
    if (q.length < 2 || filteredClassStudents.length > 0) {
      setStudentResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("students")
        .select("*")
        .eq("is_active", true)
        .ilike("full_name", `%${q}%`)
        .limit(10);
      if (!cancelled) setStudentResults((data as Student[]) ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [classStudentSearch, filteredClassStudents.length, supabase]);

  // Header sort/filter accessors for the three list tables on this page.
  // Each accessor mirrors what the matching cell renders.
  const structureColumns = useMemo<TableColumns<FeeStructure>>(
    () => ({
      class_name: { label: "Class", value: (fs) => fs.class_name },
      stream: {
        label: "Stream",
        value: (fs) =>
          fs.stream_id ? streamById[fs.stream_id] ?? "—" : "All streams",
      },
      fee_type: { label: "Fee Head", value: (fs) => fs.fee_type },
      instalment: {
        label: "Instalment",
        value: (fs) => fs.instalment_name,
        sortValue: (fs) => fs.instalment_no,
      },
      amount: {
        label: "Amount",
        value: (fs) => fs.amount,
        filter: "none",
      },
      frequency: {
        label: "Frequency",
        value: (fs) => fs.frequency.replace("_", " "),
      },
      due_date: { label: "Due Date", value: (fs) => fs.due_date },
      student_type: {
        label: "Student Type",
        value: (fs) =>
          fs.student_type === "new"
            ? "New Student"
            : fs.student_type === "existing"
              ? "Old Student"
              : "Both",
      },
    }),
    [streamById]
  );
  const structureTable = useTableControls({
    rows: feeStructures,
    columns: structureColumns,
  });

  // ── "All Structures": grouped by class ──
  // Flat, this table runs to 60-100+ rows (15 classes x 3-6 instalments, plus
  // a set per stream for XI) with no visual break, so finding one class means
  // scanning the lot. Collapsed groups make the common task -- "what does
  // Class V pay?" -- one click.
  //
  // Ordered by CURRICULUM order, not the text sort the query returns: sorting
  // class names as strings puts "I" before "Nursery" and "X" before "XI",
  // which looks plausible enough to go unnoticed.
  const groupedStructures = useMemo(() => {
    const byClass = new Map<string, FeeStructure[]>();
    for (const fs of structureTable.rows) {
      const key = fs.class_name ?? "—";
      const list = byClass.get(key) ?? [];
      list.push(fs);
      byClass.set(key, list);
    }
    return Array.from(byClass.entries())
      .map(([className, rows]) => ({
        className,
        rows,
        total: rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
      }))
      .sort(
        (a, b) =>
          classSortIndex(a.className) - classSortIndex(b.className) ||
          a.className.localeCompare(b.className)
      );
  }, [structureTable.rows]);

  // Collapsed by default — the point is to shorten the page.
  const [expandedFeeClasses, setExpandedFeeClasses] = useState<Set<string>>(
    new Set()
  );
  const toggleFeeClass = useCallback((className: string) => {
    setExpandedFeeClasses((prev) => {
      const next = new Set(prev);
      if (next.has(className)) next.delete(className);
      else next.add(className);
      return next;
    });
  }, []);

  // A column filter or search that narrows to one class should not leave the
  // reader clicking it open: when only one group survives, expand it.
  useEffect(() => {
    if (groupedStructures.length === 1) {
      setExpandedFeeClasses(new Set([groupedStructures[0].className]));
    }
  }, [groupedStructures]);

  const classStudentColumns = useMemo<TableColumns<RosterStudent>>(
    () => ({
      admission_no: {
        label: "Adm No",
        value: (s) => s.admission_no,
        filter: "text",
      },
      full_name: { label: "Name", value: (s) => s.full_name, filter: "text" },
      class_label: {
        label: "Class",
        value: (s) => s.class_label || null,
        emptyLabel: "Unassigned",
      },
      father_name: {
        label: "Father",
        value: (s) => s.father_name || null,
        filter: "text",
      },
    }),
    []
  );
  const classStudentTable = useTableControls({
    rows: filteredClassStudents,
    columns: classStudentColumns,
  });

  const paymentColumns = useMemo<
    TableColumns<(typeof studentPayments)[number]>
  >(
    () => ({
      payment_date: { label: "Date", value: (p) => p.payment_date },
      type: {
        label: "Type",
        value: (p) =>
          p.bus_stop
            ? `Transport — ${p.bus_stop.name}`
            : p.fee_structure
              ? feeLineLabel(p.fee_structure)
              : null,
      },
      amount: { label: "Amount", value: (p) => p.amount_paid, filter: "none" },
      method: {
        label: "Method",
        value: (p) => p.payment_method?.replace("_", " ") ?? null,
      },
      receipt: {
        label: "Receipt",
        value: (p) => p.receipt_number,
        filter: "text",
      },
      status: { label: "Status", value: (p) => p.status },
    }),
    []
  );
  const paymentTable = useTableControls({
    rows: studentPayments,
    columns: paymentColumns,
  });

  const downloadReceipt = async (paymentId: string) => {
    try {
      const res = await adminFetch(
        `/api/fees/receipt?payment_id=${paymentId}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to generate receipt");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error("Failed to download receipt");
    }
  };

  // Prices the register. With no class picked this runs the whole school —
  // the arrears report opens on every outstanding student rather than on an
  // empty "pick a class" prompt, which is the question the office actually
  // arrives with. Picking a class narrows it.
  const computeDues = useCallback(async () => {
    if (!academicYearId) {
      setDuesRows([]);
      return;
    }
    setDuesLoading(true);
    try {
      // Every read below is paged: PostgREST caps a response at db-max-rows
      // (1000 on Supabase) and a Range header cannot lift that cap, only ask
      // for less than it — a whole-school pass truncated there would
      // under-report arrears with no error to notice.
      //
      // Each carries an .order("id") too. LIMIT/OFFSET with no total order
      // has no stable row order between pages, so a page boundary can hand
      // back one row twice and skip another — on fee_payments that
      // double-counts one receipt while losing a real one.
      const enrollmentPage = (from: number, to: number) => {
        let q = supabase
          .from("student_enrollments")
          .select(
            "id, student_id, stream_id, has_transport, bus_stop_id, transport_direction, transport_fee_override, status, exit_date, status_changed_at, students(id, full_name, admission_no, father_name, is_active, admission_date), classes(name, section, streams(name))"
          )
          .eq("academic_year_id", academicYearId)
          .in(
            "status",
            includeLeavers ? ["active", "exited", "terminated"] : ["active"]
          );
        if (duesClassId) q = q.eq("class_id", duesClassId);
        return q.order("id", { ascending: true }).range(from, to);
      };
      const {
        data: enrollments,
        error: enrollmentError,
        truncated: enrollmentTruncated,
      } = await fetchAllRows<Record<string, unknown>>(enrollmentPage);
      if (enrollmentError || enrollmentTruncated) {
        throw new Error(
          `student_enrollments: ${enrollmentError ?? "read stopped at the paging guard"}`
        );
      }
      // Structures for every class in the year, grouped by class name below.
      // Fetched whole even for a single class: the row count is small, and it
      // keeps one code path for both scopes.
      const {
        data: structures,
        error: structuresError,
        truncated: structuresTruncated,
      } = await fetchAllRows<FeeStructure>((from, to) =>
        supabase
          .from("fee_structures")
          .select("*")
          .eq("academic_year_id", academicYearId)
          .eq("is_active", true)
          .order("id", { ascending: true })
          .range(from, to)
      );
      // Per-stop fees for the current year (stop-based model, migration 074).
      // Keyed by bus_stop_id so each transport-using enrollment can price its
      // assigned stop.
      type StopFeeRow = {
        bus_stop_id: string;
        amount: number;
        frequency: string;
        is_active: boolean;
      };
      const {
        data: stopFeeRows,
        error: stopFeeError,
        truncated: stopFeeTruncated,
      } = await fetchAllRows<StopFeeRow>((from, to) =>
        supabase
          .from("bus_stop_fees")
          .select("bus_stop_id, amount, frequency, is_active")
          .eq("academic_year_id", academicYearId)
          .eq("is_active", true)
          .order("id", { ascending: true })
          .range(from, to)
      );
      // Same reasoning as the enrollment read: a read that fails or stops
      // short leaves the arrears under-reported with nothing on screen to say
      // so. A dropped bus_stop_fees read would quietly clear the transport
      // charge from every transport-using student in the register. Throw to
      // the catch below, which surfaces it, rather than publishing a short
      // total as fact.
      if (structuresError || structuresTruncated) {
        throw new Error(
          `fee_structures: ${structuresError ?? "read stopped at the paging guard"}`
        );
      }
      if (stopFeeError || stopFeeTruncated) {
        throw new Error(
          `bus_stop_fees: ${stopFeeError ?? "read stopped at the paging guard"}`
        );
      }
      const stopFeesById = new Map(
        stopFeeRows.map((f) => [f.bus_stop_id, f])
      );

      const studentIds = (enrollments ?? []).map((e) => e.student_id as string);
      type PayRow = {
        student_id: string;
        fee_structure_id: string | null;
        amount_paid: number;
        waiver_amount: number;
        refund_amount: number | null;
        status: string;
      };
      let payments: PayRow[] = [];
      if (studentIds.length > 0) {
        // Audit H11: filter on `fee_payments.academic_year_id` directly
        // instead of an INNER join through `fee_structures` — the join
        // dropped payments whose linked structure had been deleted, even
        // though those payments are still real cash receipts the school
        // received. Waiver rows contribute via `waiver_amount` (their
        // amount_paid is 0 by schema). Refunded rows are INCLUDED: a partial
        // refund flips status to 'refunded' while amount_paid stays put, so
        // dropping them by status erased the whole receipt from paid totals
        // and overstated dues. Each refunded row's net cash is settled below.
        // Paged, not .range(0, 99999). A Range header cannot lift PostgREST's
        // db-max-rows cap, only ask for less than it — so the old call read
        // the first 1000 payments and returned 200 OK. After the 2026-27 day
        // book put 1,994 rows in this table it reported 432 students as having
        // paid nothing, against Rs 1.02 crore that was in the table all along.
        const paymentPage = (from: number, to: number) => {
          let q = supabase
            .from("fee_payments")
            .select(
              "student_id, fee_structure_id, amount_paid, waiver_amount, refund_amount, status"
            )
            .in("status", ["paid", "partial", "refunded"])
            .eq("academic_year_id", academicYearId);
          // Scope by student only for a single class. Across the whole school
          // the id list would be thousands of UUIDs in a query string, and the
          // year filter already bounds the result to the same rows.
          if (duesClassId) q = q.in("student_id", studentIds);
          return q.order("id", { ascending: true }).range(from, to);
        };
        const {
          data: pays,
          error: payError,
          truncated: payTruncated,
        } = await fetchAllRows<PayRow>(paymentPage);
        // A short read here understates what a family has paid and invents
        // arrears. Surface it instead of publishing the number.
        if (payError || payTruncated) {
          throw new Error(
            `fee_payments: ${payError ?? "read stopped at the paging guard"}`
          );
        }
        payments = pays;
      }

      const allStructures = (structures as FeeStructure[] | null) ?? [];
      // Fee structures are keyed by class *name* (not class id), so sections
      // of the same class share a schedule. Group once instead of filtering
      // the whole list per student.
      const structuresByClassName = new Map<string, FeeStructure[]>();
      for (const fs of allStructures) {
        const list = structuresByClassName.get(fs.class_name);
        if (list) list.push(fs);
        else structuresByClassName.set(fs.class_name, [fs]);
      }
      // Use a single "today" reference for the whole compute pass so a row
      // crossing midnight mid-computation doesn't get a different verdict
      // than its neighbour.
      const today = todayISO();
      // Fallback anchor for recurring fees that carry no due date of their own
      // (legacy monthly/quarterly rows, transport stop fees): they run with the
      // academic year, so periods elapse from its start.
      const yearStartDate = academicYearRange?.start_date ?? null;
      const rows: DuesRow[] = (enrollments ?? []).map((e) => {
        const stu = e.students as unknown as {
          full_name: string;
          admission_no: string;
          father_name: string | null;
          admission_date: string | null;
        } | null;
        const cls = pickEmbedded(e.classes as EmbeddedClass);
        const busStopId = (e.bus_stop_id as string | null) ?? null;
        const stopFee = busStopId ? stopFeesById.get(busStopId) : undefined;
        // Same resolution the per-student payment screen runs, so the register
        // and that screen price a student identically. The stop name is only
        // ever displayed there, so an empty label is fine here.
        const lines = resolveEffectiveFeeLines({
          structures: cls ? structuresByClassName.get(cls.name) ?? [] : [],
          studentStreamId: (e.stream_id as string | null) ?? null,
          // Admission/registration rows bill this year's intake only.
          studentType: resolveStudentType(
            stu?.admission_date,
            academicYearRange
          ),
          hasTransport: Boolean(e.has_transport),
          busStopId,
          direction:
            (e.transport_direction as TransportDirection | null) ?? "both",
          feeOverride:
            e.transport_fee_override != null
              ? Number(e.transport_fee_override)
              : null,
          stopFees: stopFee
            ? [
                {
                  bus_stop_id: stopFee.bus_stop_id,
                  stop_name: "",
                  amount: stopFee.amount,
                  frequency: stopFee.frequency,
                  is_active: true,
                },
              ]
            : [],
        });
        // With "include leavers" on, the register prices students who are no
        // longer on the roll. Their schedule stops on the day they left — the
        // whole reason the arrears column stayed honest after migration 123.
        const billingCutoff = resolveBillingCutoff(e as BillableEnrollment);
        const breakdown = computeDuesBreakdown({
          lines,
          payments: payments.filter((pay) => pay.student_id === e.student_id),
          today,
          yearStartDate,
          billingCutoff,
        });
        return {
          student_id: e.student_id as string,
          admission_no: stu?.admission_no ?? "",
          full_name: stu?.full_name ?? "",
          father_name: stu?.father_name ?? null,
          class_label: embeddedClassLabel(e.classes as EmbeddedClass),
          has_transport: Boolean(e.has_transport),
          enrollment_status: (e.status as string) ?? "active",
          billing_cutoff: billingCutoff,
          expected: breakdown.expected,
          billed_to_date: breakdown.billedToDate,
          paid: breakdown.paid,
          late_fee: breakdown.lateFee,
          dues: breakdown.dues,
        };
      });
      rows.sort((a, b) => b.dues - a.dues || a.full_name.localeCompare(b.full_name));
      setDuesRows(rows);
    } catch (err) {
      console.error("Dues compute error:", err);
      toast.error("Failed to compute dues");
    } finally {
      setDuesLoading(false);
    }
  }, [supabase, duesClassId, academicYearId, academicYearRange, includeLeavers]);

  useEffect(() => {
    computeDues();
  }, [computeDues]);

  // Reset the search whenever the class changes — sticky search text across
  // an unrelated roster would just confuse the empty-state message.
  useEffect(() => {
    setDuesSearch("");
  }, [duesClassId]);

  const filteredDuesRows = useMemo(() => {
    const q = duesSearch.trim().toLowerCase();
    if (!q) return duesRows;
    return duesRows.filter((r) => {
      return (
        r.full_name.toLowerCase().includes(q) ||
        r.admission_no.toLowerCase().includes(q) ||
        (r.father_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [duesRows, duesSearch]);

  const duesSummary = useMemo(() => {
    const withDues = filteredDuesRows.filter((r) => r.dues > 0);
    const clear = filteredDuesRows.filter((r) => r.dues === 0);
    const totalDues = withDues.reduce((s, r) => s + r.dues, 0);
    return { withDues, clear, totalDues };
  }, [filteredDuesRows]);


  // New vs returning student, for schedule rows restricted by audience —
  // the admission/registration fee bills only this year's intake.
  const selectedStudentType = useMemo<FeeStudentType | null>(
    () =>
      resolveStudentType(selectedStudent?.admission_date, academicYearRange),
    [selectedStudent?.admission_date, academicYearRange]
  );

  // Effective academic fee structures for the selected student. Applies the
  // section/stream override rule (a stream-specific structure hides the
  // class-wide one for the same fee_type) and the schedule's student-type
  // restriction. Transport is no longer part of fee_structures
  // (migration 050) — it's resolved separately below.
  const applicableFeeStructures = useMemo(() => {
    return resolveEffectiveFeeStructures(studentFeeStructures, {
      studentStreamId: selectedStudentStreamId,
      studentType: selectedStudentType,
    });
  }, [studentFeeStructures, selectedStudentStreamId, selectedStudentType]);

  // Unified fee lines (academic + the student's assigned transport stop).
  // The record-payment dropdown maps over this so transport sits alongside
  // tuition / lab / annual without a separate UI affordance. The stop's fee
  // is resolved from bus_stop_fees (migration 074); a one-side facility bills
  // the per-student override.
  const applicableFeeLines = useMemo<EffectiveFeeLine[]>(() => {
    const stopFees: StopFeeLookup[] =
      studentBusStopId && studentStopFeeAmount != null
        ? [
            {
              bus_stop_id: studentBusStopId,
              stop_name: studentStopName,
              amount: studentStopFeeAmount,
              frequency: studentStopFeeFrequency,
              is_active: true,
            },
          ]
        : [];
    return resolveEffectiveFeeLines({
      structures: studentFeeStructures,
      studentStreamId: selectedStudentStreamId,
      studentType: selectedStudentType,
      hasTransport: studentHasTransport,
      busStopId: studentBusStopId,
      direction: studentTransportDirection,
      feeOverride: studentTransportFeeOverride,
      stopFees,
    });
  }, [
    studentFeeStructures,
    selectedStudentStreamId,
    selectedStudentType,
    studentHasTransport,
    studentBusStopId,
    studentTransportDirection,
    studentTransportFeeOverride,
    studentStopName,
    studentStopFeeAmount,
    studentStopFeeFrequency,
  ]);

  // What this one student owes, priced by the same function that builds the
  // class-wide register. Operators asked for the figure here rather than
  // having to leave the student they are looking at to go find them again in
  // a whole-class list.
  //
  // `studentPayments` is the full receipt history — every year, every status —
  // because the table below shows it all. Dues are a current-year question, so
  // the receipts are narrowed to the billed year and to statuses that carry
  // money. A refunded row stays in: a partial refund leaves amount_paid intact
  // and settledAmount() nets the returned portion out.
  const yearPayments = useMemo(
    () =>
      studentPayments.filter(
        (p) =>
          p.academic_year_id === academicYearId &&
          ["paid", "partial", "refunded"].includes(p.status)
      ),
    [studentPayments, academicYearId]
  );

  const selectedStudentDues = useMemo<DuesBreakdown | null>(() => {
    if (!selectedStudent || !academicYearId) return null;
    return computeDuesBreakdown({
      lines: applicableFeeLines,
      payments: yearPayments,
      today: todayISO(),
      yearStartDate: academicYearRange?.start_date ?? null,
      // A student who has left is priced as of their leaving date, so opening
      // their record a quarter later shows the balance they actually walked
      // out with rather than one the calendar has grown since.
      billingCutoff: selectedBillingCutoff,
    });
  }, [
    selectedStudent,
    academicYearId,
    academicYearRange,
    applicableFeeLines,
    yearPayments,
    selectedBillingCutoff,
  ]);

  // Net settled per fee line, so a late-fee note can say whether the
  // surcharge is actually running on THIS instalment rather than reporting a
  // rule that a paid-on-time line will never incur.
  const settledByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of yearPayments) {
      const key = p.fee_structure_id ?? p.bus_stop_id;
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + settledAmount(p));
    }
    return m;
  }, [yearPayments]);

  const openAddStructure = () => {
    setStructureDialogMode("add");
    setEditingStructureId(null);
    setStructureForm({
      ...EMPTY_STRUCTURE,
      class_name: classFilter || CLASS_NAMES[0],
    });
    setStructureDialogOpen(true);
  };

  const openEditStructure = (fs: FeeStructure) => {
    setStructureDialogMode("edit");
    setEditingStructureId(fs.id);
    setStructureForm({
      class_name: fs.class_name,
      stream_id: fs.stream_id ?? "",
      fee_type: fs.fee_type,
      amount: String(fs.amount),
      frequency: fs.frequency,
      due_date: fs.due_date ?? "",
      instalment_name: fs.instalment_name ?? "",
      month_label: fs.month_label ?? "",
      student_type: fs.student_type ?? "both",
      late_fee_start_date: fs.late_fee_start_date ?? "",
      late_fee_percent: fs.late_fee_percent
        ? String(fs.late_fee_percent)
        : "",
      late_fee_per_day: fs.late_fee_per_day
        ? String(fs.late_fee_per_day)
        : "",
      late_fee_max:
        fs.late_fee_max != null ? String(fs.late_fee_max) : "",
    });
    setStructureDialogOpen(true);
  };

  const supportsStream = STREAM_CLASSES.includes(structureForm.class_name);

  // Save fee structure (add or edit)
  const handleSaveStructure = async () => {
    if (!academicYearId) {
      toast.error("No current academic year found");
      return;
    }
    const amount = parseFloat(structureForm.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setStructureSubmitting(true);

    const lateFeePct = structureForm.late_fee_percent
      ? Number(structureForm.late_fee_percent)
      : 0;
    const lateFeePerDay = structureForm.late_fee_per_day
      ? Number(structureForm.late_fee_per_day)
      : 0;
    // Empty = no cap (null); any entered value is the ceiling.
    const lateFeeMax =
      structureForm.late_fee_max.trim() === ""
        ? null
        : Number(structureForm.late_fee_max);
    if (
      !Number.isFinite(lateFeePct) ||
      lateFeePct < 0 ||
      lateFeePct > 100
    ) {
      toast.error("Late fee % must be between 0 and 100");
      setStructureSubmitting(false);
      return;
    }
    if (!Number.isFinite(lateFeePerDay) || lateFeePerDay < 0) {
      toast.error("Late fee per day must be ≥ 0");
      setStructureSubmitting(false);
      return;
    }
    if (lateFeeMax !== null && (!Number.isFinite(lateFeeMax) || lateFeeMax < 0)) {
      toast.error("Max late fee must be ≥ 0");
      setStructureSubmitting(false);
      return;
    }
    // The DB rejects a grace date that precedes the due date; catch it here so
    // the admin gets a sentence instead of a constraint name.
    if (
      structureForm.late_fee_start_date &&
      structureForm.due_date &&
      structureForm.late_fee_start_date < structureForm.due_date
    ) {
      toast.error("Late fee start date cannot be before the due date");
      setStructureSubmitting(false);
      return;
    }

    const data: Record<string, unknown> = {
      academic_year_id: academicYearId,
      class_name: structureForm.class_name,
      fee_type: structureForm.fee_type,
      amount,
      frequency: structureForm.frequency,
      due_date: structureForm.due_date || null,
      stream_id: supportsStream ? (structureForm.stream_id || null) : null,
      instalment_name: structureForm.instalment_name.trim() || null,
      month_label: structureForm.month_label.trim() || null,
      student_type: structureForm.student_type,
      late_fee_start_date: structureForm.late_fee_start_date || null,
      late_fee_percent: lateFeePct,
      late_fee_per_day: lateFeePerDay,
      late_fee_max: lateFeeMax,
    };

    const result = editingStructureId
      ? await adminApi({
          action: "update",
          table: "fee_structures",
          data,
          match: { column: "id", value: editingStructureId },
        })
      : await adminApi({
          action: "insert",
          table: "fee_structures",
          data,
        });

    if (!result.success) {
      toast.error(
        `Failed to ${editingStructureId ? "update" : "add"} fee structure: ${result.error}`
      );
    } else {
      toast.success(editingStructureId ? "Fee structure updated" : "Fee structure added");
      setStructureDialogOpen(false);
      setStructureForm(EMPTY_STRUCTURE);
      setEditingStructureId(null);
      fetchFeeStructures();
    }
    setStructureSubmitting(false);
  };

  // Delete fee structure. If FK violations block hard delete (recorded
  // payments reference this row), offer to deactivate instead — a deactivated
  // structure stops appearing in dues / record-payment dropdowns without
  // discarding receipt history.
  const handleDeleteStructure = async (id: string) => {
    if (!confirm("Delete this fee structure? This cannot be undone.")) return;

    const result = await adminApi({
      action: "delete",
      table: "fee_structures",
      match: { column: "id", value: id },
    });

    if (result.success) {
      toast.success("Fee structure deleted");
      fetchFeeStructures();
      return;
    }

    const blockedByFK = (result.error ?? "").toLowerCase().includes("cannot delete");
    if (
      blockedByFK &&
      confirm(
        "This fee has recorded payments and cannot be deleted. Deactivate it instead? It will be hidden from dues and the record-payment dialog, but receipts stay intact."
      )
    ) {
      const deact = await adminApi({
        action: "update",
        table: "fee_structures",
        data: { is_active: false },
        match: { column: "id", value: id },
      });
      if (!deact.success) {
        toast.error(`Failed to deactivate: ${deact.error}`);
        return;
      }
      toast.success("Fee structure deactivated");
      fetchFeeStructures();
      return;
    }

    toast.error(`Failed to delete: ${result.error}`);
  };

  // Refund a previously-recorded payment. Admins refund directly; editors
  // file a change request that an admin reviews. The dialog title +
  // submit-button label flip based on `isEditor` so the user knows which
  // path they're on before they click. (See migration-056.)
  const handleRefund = async () => {
    if (!refundPaymentId || !selectedStudent) return;
    const amt = parseFloat(refundForm.amount);
    if (Number.isNaN(amt) || amt <= 0) {
      toast.error("Enter a valid refund amount");
      return;
    }
    if (amt > refundMaxAmount) {
      toast.error(`Refund cannot exceed ${refundMaxAmount}`);
      return;
    }
    if (refundForm.reason.trim().length < 5) {
      toast.error("Refund reason is required (min 5 chars)");
      return;
    }
    setRefundSubmitting(true);
    try {
      // Editor branch: file a change request instead of refunding directly.
      // The proposed_changes describe a refund — admin's approve endpoint
      // stamps refunded_at/refunded_by from the approver, not the requester.
      if (isEditor) {
        const res = await adminFetch("/api/fees/change-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_table: "fee_payments",
            target_id: refundPaymentId,
            action: "update",
            proposed_changes: {
              status: "refunded",
              refund_amount: amt,
              refund_reason: refundForm.reason.trim(),
            },
            reason: refundForm.reason.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to file refund request");
          return;
        }
        toast.success("Refund request filed for admin review.");
        setRefundOpen(false);
        setRefundForm({ amount: "", reason: "" });
        setRefundPaymentId(null);
        return;
      }

      // Admin branch: direct refund.
      const res = await adminFetch(
        `/api/fees/payments/${refundPaymentId}/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            refund_amount: amt,
            refund_reason: refundForm.reason.trim(),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to refund payment");
        return;
      }
      toast.success("Payment marked refunded");
      setRefundOpen(false);
      setRefundForm({ amount: "", reason: "" });
      setRefundPaymentId(null);
      selectStudent(selectedStudent);
    } finally {
      setRefundSubmitting(false);
    }
  };

  // Record a fee waiver — counts toward "no dues" without a cash receipt.
  const handleRecordWaiver = async () => {
    if (!selectedStudent) return;
    const amt = parseFloat(waiverForm.waiver_amount);
    if (Number.isNaN(amt) || amt <= 0) {
      toast.error("Enter a valid waiver amount");
      return;
    }
    if (!waiverForm.fee_structure_id) {
      toast.error("Pick a fee structure to waive");
      return;
    }
    if (waiverForm.waiver_reason.trim().length < 5) {
      toast.error("Waiver reason is required (min 5 chars)");
      return;
    }
    setWaiverSubmitting(true);
    try {
      const res = await adminFetch("/api/fees/waivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          fee_structure_id: waiverForm.fee_structure_id,
          waiver_amount: amt,
          waiver_reason: waiverForm.waiver_reason.trim(),
          month: waiverForm.month || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to record waiver");
        return;
      }
      // Editors don't write directly — the server files a change request for an
      // admin to approve, and responds with { pending: true }.
      toast.success(
        data.pending
          ? data.message ?? "Waiver submitted for admin approval"
          : "Waiver recorded"
      );
      setWaiverOpen(false);
      setWaiverForm({
        fee_structure_id: "",
        waiver_amount: "",
        waiver_reason: "",
        month: "",
      });
      selectStudent(selectedStudent);
    } finally {
      setWaiverSubmitting(false);
    }
  };

  // Record payment
  const handleRecordPayment = async () => {
    if (!selectedStudent) return;

    const amount = parseFloat(newPayment.amount_paid);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (!newPayment.fee_target) {
      toast.error("Please select a fee");
      return;
    }
    // Decode the dropdown value: "fs:<uuid>" → fee_structure_id,
    // "stop:<uuid>" → bus_stop_id. Server enforces the XOR.
    const [kind, id] = newPayment.fee_target.split(":");
    const fkPayload =
      kind === "stop"
        ? { bus_stop_id: id }
        : { fee_structure_id: id };

    setPaymentSubmitting(true);
    const m = newPayment.payment_method;
    const res = await adminFetch("/api/fees/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: selectedStudent.id,
        ...fkPayload,
        amount_paid: amount,
        payment_method: m,
        month: newPayment.month || "",
        // Only send the fields that apply to the chosen method. Sending
        // the rest as empty strings is fine — the schema treats empty as
        // undefined — but we keep the body lean.
        ...(m === "cheque" && {
          cheque_number: newPayment.cheque_number,
          cheque_date: newPayment.cheque_date,
          bank_name: newPayment.bank_name,
          payer_name: newPayment.payer_name,
        }),
        ...(m === "bank_transfer" && {
          bank_name: newPayment.bank_name,
          payer_name: newPayment.payer_name,
          transaction_ref: newPayment.transaction_ref,
        }),
        ...(m === "online" && {
          payment_provider: newPayment.payment_provider,
          transaction_ref: newPayment.transaction_ref,
        }),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to record payment");
    } else {
      toast.success(`Payment recorded. Receipt: ${data.payment.receipt_number}`);
      setRecordPaymentOpen(false);
      setNewPayment({
        fee_target: "",
        amount_paid: "",
        payment_method: "cash",
        month: "",
        cheque_number: "",
        cheque_date: "",
        bank_name: "",
        payer_name: "",
        transaction_ref: "",
        payment_provider: "",
      });
      // Refresh payments
      selectStudent(selectedStudent);
    }
    setPaymentSubmitting(false);
  };

  // Payment status. This was the one place in the app where status colour
  // disagreed with itself:
  //
  //   - `pending` was painted `destructive`, i.e. red, the same as `failed`.
  //     A payment nobody has made yet is not a failure, and the fee change
  //     requests screen already paints pending amber. It is amber here now.
  //   - `partial` was yellow while the Late Fee column in the same row is
  //     amber, so once yellow folds into amber — which it does, everywhere
  //     else — "partly paid" and "late fee owing" would have become one
  //     colour in one row. Partial is a payment in progress, so it takes the
  //     blue that `applied` and `passed` already mean elsewhere.
  //   - `refunded` was purple, a hue the app uses for nothing else. It is a
  //     settled, non-failure end state: neutral.
  const statusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return (
          <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800">
            Paid
          </Badge>
        );
      case "partial":
        return (
          <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800">
            Partial
          </Badge>
        );
      case "refunded":
        return (
          <Badge className="bg-gray-100 text-gray-700 border-gray-200 dark:bg-muted dark:text-gray-300 dark:border-border">
            Refunded
          </Badge>
        );
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "pending":
        return (
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
            Pending
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const sectionTitle =
    section === "academic"
      ? "Academic Fees"
      : section === "dues"
        ? "Dues & No-Dues"
        : "Payment Management";
  const sectionSubtitle =
    section === "academic"
      ? "Instalment-wise fee schedule per class, and the full structure list."
      : section === "dues"
        ? "Class-wide arrears register — who owes what, and who is clear."
        : "Record payments and refunds, and read one student's balance and history.";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            {sectionTitle}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {sectionSubtitle}
          </p>
        </div>
        <AcademicSessionPicker state={session} />
      </div>

      {section === "academic" && (
        <Tabs defaultValue="schedule">
          <TabsList>
            <TabsTrigger value="schedule">Fee Schedule</TabsTrigger>
            <TabsTrigger value="all">All Structures</TabsTrigger>
          </TabsList>

          {/* The schedule grid is the primary editor: a row per instalment,
              laid out the way the school publishes its fees. The flat list
              below stays for cross-class review and for legacy recurring
              rows the grid intentionally doesn't model. */}
          <TabsContent value="schedule">
            {/* Setting fifteen classes one grid at a time is a day's work at
                the start of every session; this takes one sheet. It sat
                beside the tab bar, which kept it on screen while All
                Structures was open — where it does nothing, since it
                imports a schedule. */}
            <div className="mt-3 flex justify-end">
              <FeeScheduleImportDialog onImported={fetchFeeStructures} />
            </div>
            <FeeScheduleGrid />
          </TabsContent>

          <TabsContent value="all">
          {/* Academic — tuition / lab / annual / other */}
          <div>
              <Card className="bg-white dark:bg-card rounded-2xl shadow-sm mt-3">
                <CardContent>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <NativeSelect
                        value={classFilter}
                        onChange={(e) => setClassFilter(e.target.value)}
                      >
                        <option value="">All Classes</option>
                        {CLASS_NAMES.map((cn) => (
                          <option key={cn} value={cn}>
                            {cn}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <Button
                      className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
                      onClick={openAddStructure}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Fee Structure
                    </Button>
                  </div>

                  {structuresLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white" />
                    </div>
                  ) : feeStructures.length === 0 ? (
                    <p className="text-center py-12 text-gray-500 dark:text-gray-400">
                      No fee structures found.
                    </p>
                  ) : (
                    <>
                    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                      <TableFilterSummary
                        ctl={structureTable}
                        total={feeStructures.length}
                        shown={structureTable.rows.length}
                        className="mb-0 mr-auto"
            />
                      <TableExportButton
                        ctl={structureTable}
                        filename="fee-structures"
                        title="Fee Structures"
                        featureKey="fees"
                      />
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortFilterHead ctl={structureTable} col="class_name" />
                          <SortFilterHead ctl={structureTable} col="stream" />
                          <SortFilterHead ctl={structureTable} col="fee_type" />
                          <SortFilterHead ctl={structureTable} col="instalment" />
                          <SortFilterHead ctl={structureTable} col="amount" />
                          <SortFilterHead ctl={structureTable} col="frequency" />
                          <SortFilterHead ctl={structureTable} col="due_date" />
                          <SortFilterHead ctl={structureTable} col="student_type" />
                          <TableHead className="w-24 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {structureTable.rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={9} className="py-10 text-center text-gray-500 dark:text-gray-400">
                              No fee structures match the column filters.
                            </TableCell>
                          </TableRow>
                        )}
                        {groupedStructures.map((group) => {
                          const collapsed = !expandedFeeClasses.has(group.className);
                          return (
                            <Fragment key={group.className}>
                              {/* Group header rendered as a row INSIDE the same
                                  table, rather than wrapping each class in its
                                  own Accordion + Table: one table keeps the
                                  columns aligned across classes and keeps the
                                  single set of sort/filter heads above working
                                  for all of them. */}
                              <TableRow
                                className="cursor-pointer bg-gray-50/80 dark:bg-muted/40 hover:bg-gray-100 dark:hover:bg-muted/60"
                                onClick={() => toggleFeeClass(group.className)}
                              >
                                <TableCell colSpan={8} className="font-medium">
                                  <span className="inline-flex items-center gap-2">
                                    {collapsed ? (
                                      <ChevronRight className="h-4 w-4 text-gray-400" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4 text-gray-400" />
                                    )}
                                    Class {group.className}
                                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                                      {group.rows.length} row
                                      {group.rows.length === 1 ? "" : "s"} ·{" "}
                                      {inr(group.total)}
                                    </span>
                                  </span>
                                </TableCell>
                                <TableCell />
                              </TableRow>
                              {!collapsed &&
                                group.rows.map((fs) => (
                            <TableRow key={fs.id}>
                              <TableCell className="font-medium pl-8">
                                {fs.class_name}
                              </TableCell>
                              <TableCell className="text-gray-600 dark:text-gray-300">
                                {fs.stream_id ? streamById[fs.stream_id] ?? "—" : "All streams"}
                              </TableCell>
                              <TableCell>{fs.fee_type}</TableCell>
                              <TableCell className="text-gray-600 dark:text-gray-300">
                                {fs.instalment_name ?? "--"}
                                {fs.month_label ? (
                                  <span className="block text-xs text-gray-400 dark:text-gray-500">
                                    {fs.month_label}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                {new Intl.NumberFormat("en-IN", {
                                  style: "currency",
                                  currency: "INR",
                                  maximumFractionDigits: 0,
                                }).format(fs.amount)}
                              </TableCell>
                              <TableCell className="capitalize">
                                {fs.frequency.replace("_", " ")}
                              </TableCell>
                              <TableCell>
                                {fs.due_date ?? "--"}
                                {/* The grace date the late fee actually runs
                                    from, when it differs from the due date. */}
                                {fs.late_fee_start_date &&
                                fs.late_fee_start_date !== fs.due_date ? (
                                  <span className="block text-xs text-gray-400 dark:text-gray-500">
                                    late fee from {fs.late_fee_start_date}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-gray-600 dark:text-gray-300">
                                {fs.student_type === "new"
                                  ? "New Student"
                                  : fs.student_type === "existing"
                                    ? "Old Student"
                                    : "Both"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => openEditStructure(fs)}
                                    className="text-blue-500 hover:text-blue-700 p-1"
                                    aria-label="Edit fee structure"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteStructure(fs.id)}
                                    className="text-red-500 hover:text-red-700 p-1"
                                    aria-label="Delete fee structure"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                                ))}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                    </>
                  )}
                </CardContent>
              </Card>
          </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Record a payment + read one student's history. The class-wide dues
          register used to be a sibling tab here, which meant clicking across
          from a student you were already looking at dumped you into a list of
          forty and made you find them again. It now lives at /fees/dues, and
          the balance for the student in hand is shown inline below. */}
      {section === "payments" && (
        <div>
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {/* Admin-only: a bulk concession path for editors would bypass the
                change-request approval their single-student waivers go through. */}
            {isAdmin && (
              <StudentConcessionImportDialog
                onImported={() => {
                  // Concessions span many students, so there is no global list
                  // to refresh — but if one student is open, their balance has
                  // just changed and should not go on showing the old figure.
                  if (selectedStudent) selectStudent(selectedStudent);
                }}
              />
            )}
            <DayBookImportDialog
              onImported={() => {
                // A day-book batch moves a whole session's collections, so the
                // open student's balance and the import history are both stale.
                if (selectedStudent) selectStudent(selectedStudent);
                setImportHistoryKey((k) => k + 1);
              }}
            />
            <HistoricalFeesImportDialog />
          </div>

          {/* Admin-only, matching the revert endpoint it drives. */}
          {isAdmin && (
            <div className="mt-4">
              <ImportHistoryPanel refreshKey={importHistoryKey} />
            </div>
          )}

          <Card className="bg-white dark:bg-card rounded-2xl shadow-sm mt-4">
            <CardContent>
              {/* Class picker + name filter */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6">
                <div>
                  <Label className="mb-2 block text-xs font-medium">
                    Class
                  </Label>
                  <NativeSelect
                    value={paymentsClassId}
                    onChange={(e) => {
                      setPaymentsClassId(e.target.value);
                      clearSelectedStudent();
                      setClassStudentSearch("");
                    }}
                    className="block min-w-[220px]"
                  >
                    <option value="">All classes</option>
                    {classesList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatClassName(c)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex-1">
                  <Label className="mb-2 block text-xs font-medium">
                    Search Students
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                    <Input
                      placeholder="Search by name, admission no or father…"
                      value={classStudentSearch}
                      onChange={(e) => setClassStudentSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              {selectedStudent && (
                <>
                  {paymentsClassId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearSelectedStudent}
                      className="mb-4 -ml-2 text-gray-600 dark:text-gray-300"
                    >
                      <ArrowLeft className="h-4 w-4 mr-1" />
                      Back to class list
                    </Button>
                  )}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-heading text-lg font-semibold text-navy-900 dark:text-white">
                        {selectedStudent.full_name}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {selectedStudent.admission_no}
                        {selectedClassLabel ? `  ·  ${selectedClassLabel}` : ""}
                        {selectedStudentStreamId && streamById[selectedStudentStreamId]
                          ? `  ·  ${streamById[selectedStudentStreamId]}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setWaiverOpen(true)}
                        title="Record a fee waiver (counts toward no-dues without a cash receipt)"
                      >
                        Record Waiver
                      </Button>
                      <Button
                        className="bg-gold-500 hover:bg-gold-600 text-navy-900"
                        onClick={() => setRecordPaymentOpen(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Record Payment
                      </Button>
                    </div>
                  </div>

                  {/* What this student owes right now. Sits above the fee
                      list because it is the question an operator taking a
                      payment actually has. */}
                  {selectedStudentDues && (
                    <StudentDuesSummary
                      dues={selectedStudentDues}
                      loading={paymentsLoading}
                      classId={paymentsClassId || selectedStudentClassId}
                    />
                  )}

                  {/* Fee structures for student's class (academic + transport) */}
                  {applicableFeeLines.length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                        Applicable Fees
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {applicableFeeLines.map((line) => {
                          const isTransport = line.kind === "transport_stop";
                          // Schedule rows carry their own dates and month
                          // label, which is what the family recognises on the
                          // printed schedule — show those instead of the
                          // frequency multiplier a one_time row doesn't use.
                          const subtitle = isTransport
                            ? `${line.frequency.replace("_", " ")} • ${line.stop_name}`
                            : [
                                line.due_date
                                  ? `Due ${line.due_date}`
                                  : line.frequency.replace("_", " "),
                                line.month_label,
                                line.stream_id && streamById[line.stream_id]
                                  ? streamById[line.stream_id]
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" • ");
                          return (
                            <div
                              key={line.id}
                              className="border border-gray-200 dark:border-border rounded-lg p-3"
                            >
                              <p className="font-medium text-sm">
                                {line.fee_type}
                              </p>
                              {!isTransport && line.instalment_name ? (
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {line.instalment_name}
                                </p>
                              ) : null}
                              <p className="text-lg font-bold text-navy-900 dark:text-white">
                                {new Intl.NumberFormat("en-IN", {
                                  style: "currency",
                                  currency: "INR",
                                  maximumFractionDigits: 0,
                                }).format(line.amount)}
                              </p>
                              <p className="text-xs text-gray-400 dark:text-gray-500">
                                {subtitle}
                              </p>
                              {/* The surcharge terms belong next to the fee
                                  they apply to — an office answering "why is
                                  this ₹600 more" shouldn't have to open the
                                  fee structure editor to find out. */}
                              <LateFeeNote
                                line={line}
                                settled={settledByLine.get(line.id) ?? 0}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Payment history */}
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Payment History
                  </h4>
                  {paymentsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-navy-900 dark:text-white" />
                    </div>
                  ) : studentPayments.length === 0 ? (
                    <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                      No payments recorded yet.
                    </p>
                  ) : (
                    <>
                    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                      <TableFilterSummary
                        ctl={paymentTable}
                        total={studentPayments.length}
                        shown={paymentTable.rows.length}
                        className="mb-0 mr-auto"
            />
                      <TableExportButton
                        ctl={paymentTable}
                        filename="fee-payments"
                        title="Fee Payments"
                        featureKey="fees"
                      />
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortFilterHead ctl={paymentTable} col="payment_date" />
                          <SortFilterHead ctl={paymentTable} col="type" />
                          <SortFilterHead ctl={paymentTable} col="amount" />
                          <SortFilterHead ctl={paymentTable} col="method" />
                          <SortFilterHead ctl={paymentTable} col="receipt" />
                          <SortFilterHead ctl={paymentTable} col="status" />
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentTable.rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={7} className="py-10 text-center text-gray-500 dark:text-gray-400">
                              No payments match the column filters.
                            </TableCell>
                          </TableRow>
                        )}
                        {paymentTable.rows.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>{p.payment_date}</TableCell>
                            <TableCell>
                              {p.bus_stop
                                ? `Transport — ${p.bus_stop.name}`
                                : p.fee_structure
                                  ? feeLineLabel(p.fee_structure)
                                  : "--"}
                            </TableCell>
                            <TableCell>
                              {new Intl.NumberFormat("en-IN", {
                                style: "currency",
                                currency: "INR",
                                maximumFractionDigits: 0,
                              }).format(p.amount_paid)}
                            </TableCell>
                            <TableCell className="capitalize">
                              {p.payment_method?.replace("_", " ") ?? "--"}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {p.receipt_number ?? "--"}
                            </TableCell>
                            <TableCell>{statusBadge(p.status)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => downloadReceipt(p.id)}
                                  className="text-green-600 dark:text-green-400 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                                  title="Download fee receipt (school + parent copy)"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                                {/* Refund applies only to genuine cash receipts that haven't been refunded yet. */}
                                {p.status !== "refunded" &&
                                p.payment_method !== "waiver" ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setRefundPaymentId(p.id);
                                      setRefundMaxAmount(Number(p.amount_paid));
                                      setRefundForm({
                                        amount: String(p.amount_paid),
                                        reason: "",
                                      });
                                      setRefundOpen(true);
                                    }}
                                    title="Refund this payment"
                                    className="text-amber-700 dark:text-amber-400 hover:text-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/30 h-8 px-2 text-xs"
                                  >
                                    Refund
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </>
                  )}
                </>
              )}

              {!selectedStudent && (
                classStudentsLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-navy-900 dark:text-white" />
                  </div>
                ) : filteredClassStudents.length === 0 ? (
                  <div className="py-12">
                    <p className="text-center text-gray-400 dark:text-gray-500 text-sm">
                      {classStudents.length === 0
                        ? paymentsClassId
                          ? "No active students in this class."
                          : "No active enrolments for the current academic year."
                        : "No students match your search."}
                    </p>
                    {/* Students outside this year's roster — alumni, or someone
                        not yet placed in a class. Only surfaced once the roster
                        itself has nothing, so the search box keeps one meaning. */}
                    {studentResults.length > 0 && (
                      <div className="mx-auto mt-6 max-w-md">
                        <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                          Not enrolled this year, from all student records:
                        </p>
                        <div className="rounded-lg border border-gray-200 dark:border-border divide-y divide-gray-100 dark:divide-border">
                          {studentResults.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => selectStudent(s)}
                              className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-muted text-sm"
                            >
                              <span className="font-medium">{s.full_name}</span>
                              <span className="text-gray-400 dark:text-gray-500 ml-2">
                                {s.admission_no}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                  <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                    <TableFilterSummary
                      ctl={classStudentTable}
                      total={filteredClassStudents.length}
                      shown={classStudentTable.rows.length}
                      className="mb-0 mr-auto"
            />
                    <TableExportButton
                      ctl={classStudentTable}
                      filename="class-fee-status"
                      title="Class Fee Status"
                      featureKey="fees"
                    />
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortFilterHead ctl={classStudentTable} col="admission_no" />
                        <SortFilterHead ctl={classStudentTable} col="full_name" />
                        {!paymentsClassId && (
                          <SortFilterHead ctl={classStudentTable} col="class_label" />
                        )}
                        <SortFilterHead ctl={classStudentTable} col="father_name" />
                        <TableHead className="w-32 text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {classStudentTable.rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={paymentsClassId ? 4 : 5} className="py-10 text-center text-gray-500 dark:text-gray-400">
                            No students match the column filters.
                          </TableCell>
                        </TableRow>
                      )}
                      {classStudentTable.rows.map((s) => (
                        <TableRow
                          key={s.id}
                          onClick={() => selectStudentById(s.id)}
                          className="cursor-pointer"
                        >
                          <TableCell className="font-medium">
                            {s.admission_no}
                          </TableCell>
                          <TableCell>{s.full_name}</TableCell>
                          {!paymentsClassId && (
                            <TableCell className="text-gray-600 dark:text-gray-300">
                              {s.class_label || "Unassigned"}
                            </TableCell>
                          )}
                          <TableCell className="text-gray-600 dark:text-gray-300">
                            {s.father_name || "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectStudentById(s.id);
                              }}
                            >
                              View Fees
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </>
                )
              )}

            </CardContent>
          </Card>
        </div>
      )}

      {/* The whole-class dues & no-dues register, on its own route. */}
      {section === "dues" && (
        <div>
          <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
            <CardContent>
              {/* The basis of the figures has to be stated: a register that
                  silently mixed "owed now" with "owed by March" would name
                  every student a defaulter from day one of the session. */}
              <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                Dues are counted as of{" "}
                <span className="font-medium">
                  {new Date().toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                . Instalments that fall due later in the session are shown under
                Annual Fee but are not treated as arrears.
              </p>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
                <div>
                  <Label className="text-xs font-medium">Class</Label>
                  <NativeSelect
                    value={duesClassId}
                    onChange={(e) => setDuesClassId(e.target.value)}
                    className="block mt-1 min-w-[220px]"
                  >
                    <option value="">All classes</option>
                    {classesList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatClassName(c)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <label className="flex items-center gap-2 text-sm mt-1 sm:mt-5">
                  <Checkbox
                    checked={includeLeavers}
                    onCheckedChange={(v) => setIncludeLeavers(Boolean(v))}
                  />
                  Include students who left
                </label>
                {!duesLoading && duesRows.length > 0 && (
                  <div className="flex-1 min-w-[220px]">
                    <Label className="text-xs font-medium">Search</Label>
                    <div className="relative mt-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                      <Input
                        placeholder="Search by name, admission no or father…"
                        value={duesSearch}
                        onChange={(e) => setDuesSearch(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                )}
                {!duesLoading && duesRows.length > 0 && (
                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    <Badge className="bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200">
                      Pending:{" "}
                      {new Intl.NumberFormat("en-IN", {
                        style: "currency",
                        currency: "INR",
                        maximumFractionDigits: 0,
                      }).format(duesSummary.totalDues)}
                    </Badge>
                    <Badge className="bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200">
                      Clear: {duesSummary.clear.length}
                    </Badge>
                  </div>
                )}
              </div>

              {duesLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-navy-900 dark:text-white" />
                </div>
              ) : duesRows.length === 0 ? (
                <p className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
                  {duesClassId
                    ? `No ${includeLeavers ? "" : "active "}enrolments for this class in the current academic year.`
                    : `No ${includeLeavers ? "" : "active "}enrolments in the current academic year.`}
                </p>
              ) : (
                <Tabs
                  value={duesTab === "clear-list" ? "clear-list" : "dues-list"}
                  onValueChange={(v) => v && setDuesTab(String(v))}
                >
                  <TabsList>
                    <TabsTrigger value="dues-list">
                      Dues ({duesSummary.withDues.length})
                    </TabsTrigger>
                    <TabsTrigger value="clear-list">
                      No Dues ({duesSummary.clear.length})
                    </TabsTrigger>
                  </TabsList>

                  {(["dues-list", "clear-list"] as const).map((key) => (
                    <TabsContent value={key} key={key}>
                      <div className="mt-3">
                        <DuesTable
                          rows={
                            key === "dues-list"
                              ? duesSummary.withDues
                              : duesSummary.clear
                          }
                          exportName={
                            key === "dues-list" ? "fee-dues" : "fee-no-dues"
                          }
                          exportTitle={
                            key === "dues-list"
                              ? "Outstanding Fees"
                              : "Students With No Dues"
                          }
                          showClass={!duesClassId}
                          showLeftOn={includeLeavers}
                          emptyMessage={
                            duesSearch.trim()
                              ? "No students match your search."
                              : key === "dues-list"
                                ? "No students have outstanding dues in this class."
                                : "No students are fully paid in this class yet."
                          }
                        />
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add/Edit Fee Structure Dialog */}
      <Dialog open={structureDialogOpen} onOpenChange={setStructureDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <CreditCard className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <DialogTitle>
                  {structureDialogMode === "edit"
                    ? "Edit Fee Structure"
                    : "Add Fee Structure"}
                </DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {structureDialogMode === "edit"
                    ? "Update the fee for this class"
                    : "Define fees for a class"}
                </p>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Class</Label>
                <NativeSelect
                  value={structureForm.class_name}
                  onChange={(e) =>
                    setStructureForm({
                      ...structureForm,
                      class_name: e.target.value,
                      stream_id: STREAM_CLASSES.includes(e.target.value)
                        ? structureForm.stream_id
                        : "",
                    })
                  }
                  className="w-full"
                >
                  {CLASS_NAMES.map((cn) => (
                    <option key={cn} value={cn}>
                      {cn}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Fee Type</Label>
                <NativeSelect
                  value={structureForm.fee_type}
                  onChange={(e) =>
                    setStructureForm({ ...structureForm, fee_type: e.target.value })
                  }
                  className="w-full"
                >
                  {FEE_TYPES.map((ft) => (
                    <option key={ft} value={ft}>
                      {ft}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {supportsStream && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Stream (optional)</Label>
                <NativeSelect
                  value={structureForm.stream_id}
                  onChange={(e) =>
                    setStructureForm({ ...structureForm, stream_id: e.target.value })
                  }
                  className="w-full"
                >
                  <option value="">All streams (applies to everyone)</option>
                  {streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.code ? ` (${s.code})` : ""}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Leave blank to apply the same fee to every stream in this class.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Amount</Label>
                <Input
                  className="h-9"
                  type="number"
                  placeholder="Enter amount"
                  value={structureForm.amount}
                  onChange={(e) =>
                    setStructureForm({ ...structureForm, amount: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Frequency</Label>
                <NativeSelect
                  value={structureForm.frequency}
                  onChange={(e) =>
                    setStructureForm({
                      ...structureForm,
                      frequency: e.target.value as (typeof FREQUENCIES)[number],
                    })
                  }
                  className="w-full"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f.charAt(0).toUpperCase() + f.slice(1).replace("_", " ")}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Due Date (optional)</Label>
                <Input
                  className="h-9"
                  type="date"
                  value={structureForm.due_date}
                  onChange={(e) =>
                    setStructureForm({ ...structureForm, due_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Late Fee Start Date (optional)
                </Label>
                <Input
                  className="h-9"
                  type="date"
                  min={structureForm.due_date || undefined}
                  value={structureForm.late_fee_start_date}
                  onChange={(e) =>
                    setStructureForm({
                      ...structureForm,
                      late_fee_start_date: e.target.value,
                    })
                  }
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Blank = the late fee starts on the due date.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Instalment Name (optional)
                </Label>
                <Input
                  className="h-9"
                  placeholder="1st Instalment (Tuition Fee)"
                  value={structureForm.instalment_name}
                  onChange={(e) =>
                    setStructureForm({
                      ...structureForm,
                      instalment_name: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Month Name (optional)
                </Label>
                <Input
                  className="h-9"
                  placeholder="April, 2026"
                  value={structureForm.month_label}
                  onChange={(e) =>
                    setStructureForm({
                      ...structureForm,
                      month_label: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Student Type</Label>
              <NativeSelect
                value={structureForm.student_type}
                onChange={(e) =>
                  setStructureForm({
                    ...structureForm,
                    student_type: e.target.value as FeeStudentType,
                  })
                }
                className="w-full"
              >
                {STUDENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Admission and registration fees usually bill new students only.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Late Fee % (optional)
                </Label>
                <Input
                  className="h-9"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  placeholder="0"
                  value={structureForm.late_fee_percent}
                  onChange={(e) =>
                    setStructureForm({
                      ...structureForm,
                      late_fee_percent: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Late Fee per Day ₹ (optional)
                </Label>
                <Input
                  className="h-9"
                  type="number"
                  min={0}
                  step="1"
                  placeholder="0"
                  value={structureForm.late_fee_per_day}
                  onChange={(e) =>
                    setStructureForm({
                      ...structureForm,
                      late_fee_per_day: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">
                Max Late Fee ₹ (optional)
              </Label>
              <Input
                className="h-9"
                type="number"
                min={0}
                step="1"
                placeholder="No cap"
                value={structureForm.late_fee_max}
                onChange={(e) =>
                  setStructureForm({
                    ...structureForm,
                    late_fee_max: e.target.value,
                  })
                }
              />
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-1">
              Charged per overdue structure: max(amount × %, days late × ₹/day),
              capped at the max if set. Leave % and ₹/day at 0 for no surcharge.
            </p>
            <Button
              onClick={handleSaveStructure}
              disabled={structureSubmitting}
              className="w-full h-10 rounded-xl font-medium bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
            >
              {structureSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : structureDialogMode === "edit" ? (
                "Save Changes"
              ) : (
                "Add Fee Structure"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog open={recordPaymentOpen} onOpenChange={setRecordPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10">
                <Banknote className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <DialogTitle>Record Payment</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Log a fee payment from a student</p>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Fee</Label>
              <NativeSelect
                value={newPayment.fee_target}
                onChange={(e) => {
                  // A scheduled instalment already says which period it
                  // covers ("April, 2026"), so prefill Month from it rather
                  // than making the clerk retype what the schedule states.
                  const [kind, id] = e.target.value.split(":");
                  const picked =
                    kind === "fs"
                      ? applicableFeeStructures.find((fs) => fs.id === id)
                      : undefined;
                  setNewPayment({
                    ...newPayment,
                    fee_target: e.target.value,
                    month: picked?.month_label ?? newPayment.month,
                  });
                }}
                className="w-full"
              >
                <option value="">Select fee</option>
                {applicableFeeLines.map((line) => {
                  const isTransport = line.kind === "transport_stop";
                  const value = `${isTransport ? "stop" : "fs"}:${line.id}`;
                  const amountText = new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  }).format(line.amount);
                  // Instalments of the same head are otherwise
                  // indistinguishable in this list — name and due date are
                  // what tells the 2nd instalment from the 3rd.
                  const label = isTransport
                    ? `Transport — ${line.stop_name} (${amountText})`
                    : `${feeLineLabel(line)}${
                        line.stream_id && streamById[line.stream_id]
                          ? ` (${streamById[line.stream_id]})`
                          : ""
                      }${line.due_date ? ` · due ${line.due_date}` : ""} - ${amountText}`;
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Amount</Label>
                <Input
                  className="h-9"
                  type="number"
                  placeholder="Enter amount"
                  value={newPayment.amount_paid}
                  onChange={(e) =>
                    setNewPayment({ ...newPayment, amount_paid: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Payment Method</Label>
                <NativeSelect
                  value={newPayment.payment_method}
                  onChange={(e) =>
                    setNewPayment({
                      ...newPayment,
                      payment_method: e.target.value as (typeof PAYMENT_METHODS)[number],
                    })
                  }
                  className="w-full"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.charAt(0).toUpperCase() + m.slice(1).replace("_", " ")}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Month (optional)</Label>
              <Input
                className="h-9"
                type="month"
                value={newPayment.month}
                onChange={(e) =>
                  setNewPayment({ ...newPayment, month: e.target.value })
                }
              />
            </div>

            {/* Method-specific fields. Only what's relevant to the chosen
                payment method is rendered, and the corresponding required
                fields are validated server-side via feePaymentSchema. */}
            {newPayment.payment_method === "cheque" && (
              <div className="rounded-xl border border-gray-200 dark:border-border p-3 space-y-3">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Cheque details
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Cheque No.</Label>
                    <Input
                      className="h-9"
                      placeholder="e.g. 412309"
                      value={newPayment.cheque_number}
                      onChange={(e) =>
                        setNewPayment({ ...newPayment, cheque_number: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cheque Date</Label>
                    <Input
                      className="h-9"
                      type="date"
                      value={newPayment.cheque_date}
                      onChange={(e) =>
                        setNewPayment({ ...newPayment, cheque_date: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Drawee Bank</Label>
                    <Input
                      className="h-9"
                      placeholder="e.g. SBI"
                      value={newPayment.bank_name}
                      onChange={(e) =>
                        setNewPayment({ ...newPayment, bank_name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Payee Name (optional)</Label>
                    <Input
                      className="h-9"
                      placeholder="As on cheque"
                      value={newPayment.payer_name}
                      onChange={(e) =>
                        setNewPayment({ ...newPayment, payer_name: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {newPayment.payment_method === "bank_transfer" && (
              <div className="rounded-xl border border-gray-200 dark:border-border p-3 space-y-3">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Bank transfer details
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Originating Bank</Label>
                    <Input
                      className="h-9"
                      placeholder="e.g. HDFC"
                      value={newPayment.bank_name}
                      onChange={(e) =>
                        setNewPayment({ ...newPayment, bank_name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Payer Name (optional)</Label>
                    <Input
                      className="h-9"
                      placeholder="As on transfer"
                      value={newPayment.payer_name}
                      onChange={(e) =>
                        setNewPayment({ ...newPayment, payer_name: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Transaction Reference (UTR / NEFT)</Label>
                  <Input
                    className="h-9"
                    placeholder="e.g. SBIN0123456789"
                    value={newPayment.transaction_ref}
                    onChange={(e) =>
                      setNewPayment({ ...newPayment, transaction_ref: e.target.value })
                    }
                  />
                </div>
              </div>
            )}

            {newPayment.payment_method === "online" && (
              <div className="rounded-xl border border-gray-200 dark:border-border p-3 space-y-3">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Online payment details
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Provider</Label>
                    <Input
                      className="h-9"
                      placeholder="PhonePe / GPay / Paytm / Razorpay"
                      list="payment-providers"
                      value={newPayment.payment_provider}
                      onChange={(e) =>
                        setNewPayment({ ...newPayment, payment_provider: e.target.value })
                      }
                    />
                    <datalist id="payment-providers">
                      <option value="PhonePe" />
                      <option value="Google Pay" />
                      <option value="Paytm" />
                      <option value="BHIM" />
                      <option value="Razorpay" />
                      <option value="Other" />
                    </datalist>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Transaction ID</Label>
                    <Input
                      className="h-9"
                      placeholder="UPI / order id"
                      value={newPayment.transaction_ref}
                      onChange={(e) =>
                        setNewPayment({ ...newPayment, transaction_ref: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={handleRecordPayment}
              disabled={paymentSubmitting}
              className="w-full h-10 rounded-xl font-medium bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
            >
              {paymentSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                "Record Payment"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Refund Dialog (M9) — also serves the editor "request refund" flow */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isEditor ? "Request Refund" : "Refund Payment"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isEditor
                ? "Editors can't refund directly — your request goes to an admin for review. They'll see the original payment and your reason side by side before approving."
                : "One refund per payment. The amount can be partial (≤ original receipt) but cannot be split across multiple refund events."}
            </p>
            <div>
              <Label className="text-sm font-medium">
                Refund amount (max ₹{refundMaxAmount})
              </Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={refundMaxAmount}
                value={refundForm.amount}
                onChange={(e) =>
                  setRefundForm((p) => ({ ...p, amount: e.target.value }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Reason</Label>
              <textarea
                value={refundForm.reason}
                onChange={(e) =>
                  setRefundForm((p) => ({ ...p, reason: e.target.value }))
                }
                rows={3}
                placeholder="e.g. Duplicate payment, parent dispute…"
                className="mt-1 w-full rounded-md border border-gray-200 dark:border-border bg-white dark:bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Min 5 chars. Logged with your user id and timestamp.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={handleRefund}
              disabled={refundSubmitting || userRole === null}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {refundSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isEditor ? "Filing request..." : "Refunding..."}
                </>
              ) : isEditor ? (
                "Submit Refund Request"
              ) : (
                "Confirm Refund"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Waiver Dialog (M9) */}
      <Dialog open={waiverOpen} onOpenChange={setWaiverOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Fee Waiver</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-sm font-medium">Fee structure</Label>
              <NativeSelect
                value={waiverForm.fee_structure_id}
                onChange={(e) =>
                  setWaiverForm((p) => ({
                    ...p,
                    fee_structure_id: e.target.value,
                  }))
                }
                className="mt-1 block w-full"
              >
                <option value="">Select…</option>
                {applicableFeeStructures.map((fs) => (
                  <option key={fs.id} value={fs.id}>
                    {feeLineLabel(fs)} — ₹{fs.amount}
                    {fs.frequency !== "one_time" ? ` / ${fs.frequency}` : ""}
                    {fs.due_date ? ` · due ${fs.due_date}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label className="text-sm font-medium">Waiver amount</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={waiverForm.waiver_amount}
                onChange={(e) =>
                  setWaiverForm((p) => ({
                    ...p,
                    waiver_amount: e.target.value,
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Reason</Label>
              <textarea
                value={waiverForm.waiver_reason}
                onChange={(e) =>
                  setWaiverForm((p) => ({
                    ...p,
                    waiver_reason: e.target.value,
                  }))
                }
                rows={3}
                placeholder="e.g. Scholarship, principal-approved hardship…"
                className="mt-1 w-full rounded-md border border-gray-200 dark:border-border bg-white dark:bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Min 5 chars. Counts toward dues but is tagged as a waiver.
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Month (optional)</Label>
              <Input
                type="month"
                value={waiverForm.month}
                onChange={(e) =>
                  setWaiverForm((p) => ({ ...p, month: e.target.value }))
                }
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Stored as YYYY-MM to match payment-month reporting.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={handleRecordWaiver}
              disabled={waiverSubmitting}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {waiverSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recording...
                </>
              ) : (
                "Record Waiver"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Each /fees/<section> route renders this wrapper with a different section
// prop. Suspense is required because the inner component reads
// useSearchParams, which Next.js wants statically bounded.
export function AdminFeesContent({ section }: { section: FeesSection }) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-navy-900 dark:text-white" />
        </div>
      }
    >
      <AdminFeesContentInner section={section} />
    </Suspense>
  );
}
