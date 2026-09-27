"use client";

// Day Book (Head wise) import wizard.
//
// Flow, all in one dialog — sections appear as the state fills in, matching
// FeeScheduleImportDialog rather than a step machine:
//   1. Pick the session, choose the .xls exactly as the old software exports
//      it, press Preview. Nothing is written.
//   2. The preview leads with the reconciliation: what the file's own footer
//      claims, what we parsed, and what a commit would write. The office signs
//      off on that number before anything moves.
//   3. Anything needing a decision — unmapped classes, unmapped fee heads,
//      students who would be created, receipts held back for review — gets its
//      own panel. Errors and conflicts block the commit outright.
//   4. Import. The batch appears in the history list underneath, with a revert.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Label } from "@nkps/shared/components/ui/label";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { adminUpload } from "@nkps/shared/lib/admin-api";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { csvEscape } from "@nkps/shared/lib/utils";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";
import { CLASS_ORDER } from "@nkps/shared/lib/constants";

// The class list is CLASS_ORDER from shared constants. It used to be
// retyped in this file (and two others), which is three places for the
// school's class list to disagree with itself.
const CLASS_NAMES: readonly string[] = CLASS_ORDER;
const STREAMS = ["", "Science", "Commerce", "Arts"] as const;

type RowStatus =
  | "ok" | "error" | "skip_zero" | "already_imported" | "conflict" | "needs_review";

interface RowResult {
  source_row: number;
  receipt_no: string;
  payment_date: string | null;
  admission_no: string | null;
  student_name: string;
  raw_class: string;
  raw_section: string;
  payment_method: string;
  total: number;
  status: RowStatus;
  message?: string;
  matched_by?: "admission_no" | "name_fallback" | "will_create";
  slices?: number;
  over_allocated?: boolean;
}

interface StudentToCreate {
  admission_no: string;
  full_name: string;
  father_name: string;
  class_name: string;
  section: string;
  stream_name: string | null;
  receipts: number;
  amount: number;
}

interface Reconciliation {
  file: { by_mode: Record<string, number>; by_head: Record<string, number>; grand: number | null };
  parsed: { by_mode: Record<string, number>; grand: number; rows: number };
  imported: { by_mode: Record<string, number>; grand: number; rows: number };
  excluded: Record<string, number>;
  parse_matches_file: boolean;
}

interface Summary {
  ok: number;
  error: number;
  skip_zero: number;
  already_imported: number;
  conflict: number;
  needs_review: number;
  total_rows: number;
  heads?: string[];
  period_start?: string | null;
  period_end?: string | null;
  will_create_streams?: string[];
  will_create_classes?: Array<{ name: string; section: string; stream_name: string | null }>;
  students_to_create?: number;
  payments_to_create?: number;
  over_allocated_rows?: number;
  payments_created?: number;
  students_created?: number;
  amount_total?: number;
  dry_run: boolean;
  committed: boolean;
  blocked: boolean;
  batch_id?: string;
}

interface Response {
  summary: Summary;
  rows: RowResult[];
  unmapped_classes: string[];
  unmapped_heads: string[];
  known_heads?: string[];
  students_to_create: StudentToCreate[];
  reconciliation: Reconciliation | null;
  warnings: string[];
}

interface AcademicYear {
  id: string;
  name: string;
  is_current?: boolean;
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: "Will import",
  error: "Error",
  conflict: "Conflict",
  needs_review: "Needs review",
  already_imported: "Already imported",
  skip_zero: "Zero value",
};

interface Props {
  triggerLabel?: string;
  onImported?: () => void;
}

export function DayBookImportDialog({
  triggerLabel = "Import Day Book (Head wise)",
  onImported,
}: Props) {
  const [open, setOpen] = useState(false);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [academicYearId, setAcademicYearId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<Response | null>(null);

  const [classMappings, setClassMappings] = useState<
    Record<string, { class_name: string; stream_name: string | null }>
  >({});
  const [headMappings, setHeadMappings] = useState<Record<string, string>>({});
  const [createMissingStudents, setCreateMissingStudents] = useState(true);
  const [nameFallback, setNameFallback] = useState(true);
  const [includeNeedsReview, setIncludeNeedsReview] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("academic_years")
        .select("id, name, is_current")
        .order("name", { ascending: false });
      const list = (data ?? []) as AcademicYear[];
      setYears(list);
      if (!academicYearId) {
        // Default to the live session: this backfills the year money is being
        // collected in, not an archive.
        setAcademicYearId(list.find((y) => y.is_current)?.id ?? list[0]?.id ?? "");
      }
    })();
    // academicYearId is intentionally not a dependency: re-running on every
    // pick would refetch the list each time the operator changes session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reset = useCallback(() => {
    setFile(null);
    setResult(null);
    setClassMappings({});
    setHeadMappings({});
    setIncludeNeedsReview(false);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const send = useCallback(
    async (dryRun: boolean) => {
      if (!file || !academicYearId) return;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("academic_year_id", academicYearId);
      fd.append("dry_run", dryRun ? "true" : "false");
      fd.append("name_fallback", nameFallback ? "true" : "false");
      fd.append("create_missing_students", createMissingStudents ? "true" : "false");
      fd.append("include_needs_review", includeNeedsReview ? "true" : "false");
      fd.append("class_mappings", JSON.stringify(classMappings));
      fd.append("head_mappings", JSON.stringify(headMappings));

      const res = await adminUpload("/api/fees/day-book-import", fd);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          [json.error, Array.isArray(json.details) ? json.details.join(" ") : json.details]
            .filter(Boolean)
            .join(" — ") || "Request failed"
        );
      }
      return json as Response;
    },
    [
      file,
      academicYearId,
      nameFallback,
      createMissingStudents,
      includeNeedsReview,
      classMappings,
      headMappings,
    ]
  );

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const json = await send(true);
      if (json) setResult(json);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommit = async () => {
    setCommitting(true);
    try {
      const json = await send(false);
      if (!json) return;
      setResult(json);
      if (json.summary.committed) {
        toast.success(
          `Imported ${json.summary.payments_created ?? 0} payment row(s) — ` +
            `${inr(json.summary.amount_total ?? 0)}`
        );
        onImported?.();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  };

  const canCommit = useMemo(() => {
    if (!result || committing || previewing) return false;
    if (result.summary.committed) return false;
    return !result.summary.blocked && result.summary.ok > 0;
  }, [result, committing, previewing]);

  const downloadIssues = () => {
    if (!result) return;
    const issues = result.rows.filter((r) => r.status !== "ok" && r.status !== "already_imported");
    const header = [
      "Excel Row", "Receipt No", "Date", "SR No", "Student", "Class", "Section",
      "Mode", "Amount", "Status", "Message",
    ];
    const body = issues.map((r) =>
      [
        r.source_row, r.receipt_no, r.payment_date ?? "", r.admission_no ?? "",
        r.student_name, r.raw_class, r.raw_section, r.payment_method, r.total,
        STATUS_LABEL[r.status], r.message ?? "",
      ]
        .map(csvEscape)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `day-book-import-issues-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = result?.summary;
  const rec = result?.reconciliation;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-5xl max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Day Book (Head wise)</DialogTitle>
          <DialogDescription>
            Upload the previous software&apos;s Day Book export exactly as it comes —
            no editing. Receipts already imported are skipped, so re-uploading a
            later export that overlaps this one is safe.
          </DialogDescription>
        </DialogHeader>

        {/* ── Inputs ─────────────────────────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Session</Label>
            <Select value={academicYearId} onValueChange={(v) => setAcademicYearId(String(v))}>
              <SelectTrigger>
                <SelectValue placeholder="Select a session" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y.id} value={y.id} label={y.name}>
                    {y.name}
                    {y.is_current ? " (current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="day-book-file">Day Book file (.xls / .xlsx)</Label>
            <input
              id="day-book-file"
              ref={fileRef}
              type="file"
              accept=".xls,.xlsx"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={createMissingStudents}
              onCheckedChange={(v) => setCreateMissingStudents(Boolean(v))}
            />
            Create students who paid but are not on the roster
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={nameFallback}
              onCheckedChange={(v) => setNameFallback(Boolean(v))}
            />
            Match on name when the SR No is unknown
          </label>
        </div>

        {file ? (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </span>
            </div>
            <Button size="sm" onClick={handlePreview} disabled={previewing || !academicYearId}>
              {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview
            </Button>
          </div>
        ) : null}

        {/* ── Reconciliation ─────────────────────────────────────────────── */}
        {rec ? (
          <div
            className={`rounded-lg border p-4 ${
              rec.parse_matches_file
                ? "border-green-300 bg-green-50/60 dark:bg-green-950/10"
                : "border-red-300 bg-red-50/60 dark:bg-red-950/10"
            }`}
          >
            <div className="mb-2 flex items-center gap-2 font-medium">
              {rec.parse_matches_file ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
              )}
              Reconciliation
              {s?.period_start ? (
                <span className="text-sm font-normal text-muted-foreground">
                  {s.period_start} to {s.period_end}
                </span>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-normal">Source</th>
                    <th className="py-1 text-right font-normal">Cash</th>
                    <th className="py-1 text-right font-normal">Cheque</th>
                    <th className="py-1 text-right font-normal">Online</th>
                    <th className="py-1 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <ReconRow
                    label="The file says"
                    modes={rec.file.by_mode}
                    grand={rec.file.grand ?? 0}
                  />
                  <ReconRow
                    label={`We read (${rec.parsed.rows} receipts)`}
                    modes={rec.parsed.by_mode}
                    grand={rec.parsed.grand}
                  />
                  <ReconRow
                    label={`Will import (${rec.imported.rows} receipts)`}
                    modes={rec.imported.by_mode}
                    grand={rec.imported.grand}
                    strong
                  />
                </tbody>
              </table>
            </div>
            {!rec.parse_matches_file ? (
              <p className="mt-2 text-sm text-red-700 dark:text-red-400">
                What we read does not match the file&apos;s own total row. Do not
                import — send the file over so the mismatch can be traced.
              </p>
            ) : null}
            {Object.keys(rec.excluded).length > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Held back:{" "}
                {Object.entries(rec.excluded)
                  .map(([k, v]) => `${STATUS_LABEL[k as RowStatus]} ${inr(v)}`)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ── Counters ───────────────────────────────────────────────────── */}
        {s ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-green-400 text-green-700 dark:text-green-400">
              {s.ok} will import
            </Badge>
            {s.already_imported > 0 ? (
              <Badge variant="outline">{s.already_imported} already imported</Badge>
            ) : null}
            {s.skip_zero > 0 ? (
              <Badge variant="outline">{s.skip_zero} zero value</Badge>
            ) : null}
            {s.needs_review > 0 ? (
              <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                {s.needs_review} need review
              </Badge>
            ) : null}
            {s.conflict > 0 ? (
              <Badge variant="outline" className="border-red-400 text-red-700 dark:text-red-400">
                {s.conflict} conflicts
              </Badge>
            ) : null}
            {s.error > 0 ? (
              <Badge variant="outline" className="border-red-400 text-red-700 dark:text-red-400">
                {s.error} errors
              </Badge>
            ) : null}
            {s.payments_to_create ? (
              <Badge variant="outline">
                {s.payments_to_create} instalment row(s)
              </Badge>
            ) : null}
            {s.over_allocated_rows ? (
              <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                {s.over_allocated_rows} paid beyond the schedule
              </Badge>
            ) : null}
            {s.students_to_create ? (
              <Badge variant="outline" className="border-blue-400 text-blue-700 dark:text-blue-400">
                {s.students_to_create} students to create
              </Badge>
            ) : null}
            {s.will_create_classes?.length ? (
              <Badge variant="outline" className="border-blue-400 text-blue-700 dark:text-blue-400">
                {s.will_create_classes.length} classes to create
              </Badge>
            ) : null}
          </div>
        ) : null}

        {/* ── Mapping panels ─────────────────────────────────────────────── */}
        {result && result.unmapped_classes.length > 0 ? (
          <MappingPanel title="These class names are not recognised">
            {result.unmapped_classes.map((raw) => (
              <div key={raw} className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-center">
                <span className="truncate text-sm font-medium">{raw}</span>
                <NativeSelect
                  value={classMappings[raw]?.class_name ?? ""}
                  onChange={(e) =>
                    setClassMappings((m) => ({
                      ...m,
                      [raw]: {
                        class_name: e.target.value,
                        stream_name: m[raw]?.stream_name ?? null,
                      },
                    }))
                  }
                >
                  <option value="">Pick a class…</option>
                  {CLASS_NAMES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  value={classMappings[raw]?.stream_name ?? ""}
                  onChange={(e) =>
                    setClassMappings((m) => ({
                      ...m,
                      [raw]: {
                        class_name: m[raw]?.class_name ?? "",
                        stream_name: e.target.value || null,
                      },
                    }))
                  }
                >
                  {STREAMS.map((st) => (
                    <option key={st} value={st}>{st || "No stream"}</option>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </MappingPanel>
        ) : null}

        {result && result.unmapped_heads.length > 0 ? (
          <MappingPanel title="These fee heads do not match the published schedule">
            {result.unmapped_heads.map((raw) => (
              <div key={raw} className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-center">
                <span className="truncate text-sm font-medium">{raw}</span>
                <NativeSelect
                  value={headMappings[raw] ?? ""}
                  onChange={(e) =>
                    setHeadMappings((m) => ({ ...m, [raw]: e.target.value }))
                  }
                >
                  <option value="">Pick a fee head…</option>
                  {(result.known_heads ?? []).map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </NativeSelect>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Nothing here? Publish the fee schedule for this session first — money
              can only be attached to an instalment that exists.
            </p>
          </MappingPanel>
        ) : null}

        {result && result.summary.needs_review > 0 && !result.summary.committed ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/10">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              {result.summary.needs_review} receipt(s) belong to students who already
              have payments entered directly in the ERP
            </div>
            <p className="mb-2 text-sm text-muted-foreground">
              They are held back because the file and the ERP may be describing the
              same money. Check those students, then tick below to include them.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeNeedsReview}
                onCheckedChange={(v) => setIncludeNeedsReview(Boolean(v))}
              />
              I have checked these students — import their receipts too
            </label>
          </div>
        ) : null}

        {result && (result.summary.over_allocated_rows ?? 0) > 0 ? (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            {result.summary.over_allocated_rows} receipt(s) carry more money than
            the published schedule asks for. They are still imported in full —
            the rupees were received — and the surplus is attached to that
            head&apos;s last instalment. Worth a look if the number is large:
            it usually means the schedule in the ERP does not match what the
            office actually charged.
          </p>
        ) : null}

        {result && result.students_to_create.length > 0 ? (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {result.students_to_create.length} student(s) will be created and marked
              as having left
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              They paid this session but are not on the roster. Each is created with
              only what the Day Book knows — SR No, name, father, class — marked
              &quot;Exited&quot;, and listed under People → Students → Exited, where
              anyone still enrolled can be put back to Active.
            </p>
            <div className="mt-2 max-h-56 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SR No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Father</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Receipts</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.students_to_create.map((st) => (
                    <TableRow key={st.admission_no}>
                      <TableCell>{st.admission_no}</TableCell>
                      <TableCell>{st.full_name}</TableCell>
                      <TableCell>{st.father_name}</TableCell>
                      <TableCell>
                        {st.class_name}
                        {st.stream_name ? `-${st.stream_name}` : ""}-{st.section}
                      </TableCell>
                      <TableCell className="text-right">{st.receipts}</TableCell>
                      <TableCell className="text-right">{inr(st.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        ) : null}

        {/* ── Rows needing attention ─────────────────────────────────────── */}
        {result ? <IssueTable rows={result.rows} onDownload={downloadIssues} /> : null}

        {result && result.warnings.length > 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/10">
            <div className="mb-1 font-medium">Notes</div>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {result?.summary.committed ? (
          <div className="rounded-lg border border-green-300 bg-green-50/60 p-3 text-sm dark:bg-green-950/10">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              Imported {result.summary.payments_created ?? 0} payment row(s),{" "}
              {inr(result.summary.amount_total ?? 0)}
              {result.summary.students_created
                ? `, and created ${result.summary.students_created} student(s)`
                : ""}
              .
            </div>
            <p className="mt-1 text-muted-foreground">
              This batch can be undone from the import history on the Fees page.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
          <Button onClick={handleCommit} disabled={!canCommit}>
            {committing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Import {s?.ok ? `${s.ok} receipt(s)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReconRow({
  label,
  modes,
  grand,
  strong,
}: {
  label: string;
  modes: Record<string, number>;
  grand: number;
  strong?: boolean;
}) {
  const cell = (v: number | undefined) =>
    v === undefined ? "—" : inr(v);
  return (
    <tr className={strong ? "font-medium" : undefined}>
      <td className="py-1">{label}</td>
      <td className="py-1 text-right tabular-nums">{cell(modes.cash)}</td>
      <td className="py-1 text-right tabular-nums">{cell(modes.cheque)}</td>
      <td className="py-1 text-right tabular-nums">{cell(modes.online)}</td>
      <td className="py-1 text-right tabular-nums">{inr(grand)}</td>
    </tr>
  );
}

function MappingPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/10">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Only rows that need a human. A clean 1,500-receipt preview shows nothing
 * here, which is the point — the reconciliation panel above is the answer, and
 * a wall of green rows would bury the handful that matter.
 */
function IssueTable({
  rows,
  onDownload,
}: {
  rows: RowResult[];
  onDownload: () => void;
}) {
  const issues = rows.filter((r) => r.status !== "ok" && r.status !== "already_imported");

  // Errors cluster: an unpublished schedule takes out one whole class at once.
  // Leading with that turns "34 rows need attention" into "34 of them are
  // XI-Arts", which is the difference between a list to work through and a
  // single thing to go and fix.
  const topErrorClass = (() => {
    const errs = issues.filter((r) => r.status === "error" && r.raw_class);
    if (errs.length < 3) return null;
    const byClass = new Map<string, number>();
    for (const r of errs) byClass.set(r.raw_class, (byClass.get(r.raw_class) ?? 0) + 1);
    const [label, count] = [...byClass.entries()].sort((a, b) => b[1] - a[1])[0];
    return count >= errs.length / 2 ? { label, count } : null;
  })();

  if (issues.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {issues.length} row(s) need attention
          {topErrorClass ? (
            <span className="ml-1 font-normal text-muted-foreground">
              — {topErrorClass.count} of them in {topErrorClass.label}
            </span>
          ) : null}
        </span>
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" />
          Download as CSV
        </Button>
      </div>
      <div className="max-h-[320px] overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Receipt</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Class</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.slice(0, 300).map((r) => (
              <TableRow
                key={`${r.source_row}-${r.receipt_no}`}
                className={
                  r.status === "error" || r.status === "conflict"
                    ? "bg-red-50/60 dark:bg-red-950/10"
                    : undefined
                }
              >
                <TableCell>{r.source_row}</TableCell>
                <TableCell>{r.receipt_no}</TableCell>
                <TableCell>
                  {r.student_name}
                  {r.admission_no ? (
                    <span className="text-muted-foreground"> · {r.admission_no}</span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.raw_class}
                  {r.raw_section ? `-${r.raw_section}` : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">{inr(r.total)}</TableCell>
                <TableCell>{STATUS_LABEL[r.status]}</TableCell>
                <TableCell className="max-w-[420px] text-sm text-muted-foreground">
                  {r.message}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {issues.length > 300 ? (
        <p className="text-xs text-muted-foreground">
          Showing the first 300. Download the CSV for the rest.
        </p>
      ) : null}
    </div>
  );
}
