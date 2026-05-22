"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import {
  AlertTriangle,
  Download,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import type {
  FinalResult,
  FinalSubject,
  ResultMaster,
  ResultMasterSubject,
} from "@nkps/shared/types";

// Shape used for the student picker dropdown. We fetch via student_enrollments
// because the `students` table has no `current_class_id` column — class
// membership lives in the enrollment row for the active academic year.
interface RosterRow {
  student_id: string;
  roll_number: number | null;
  full_name: string;
  admission_no: string | null;
}

interface PreviewResponseBody {
  final_result: FinalResult | null;
  student: {
    id: string;
    full_name: string;
    roll_number: number | null;
  };
}

function pct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function PreviewTab({
  resultMaster,
  subjects,
  classId,
  academicYearId,
  classLabel,
  yearLabel,
}: {
  resultMaster: ResultMaster;
  subjects: ResultMasterSubject[];
  classId: string;
  academicYearId: string;
  classLabel: string;
  yearLabel: string;
}) {
  // ---------- Gate: zero-main-subjects config is a no-op ----------
  // `computeFinalResult` returns null BOTH for "no master" AND for "master with
  // zero main subjects". Since this tab only renders with a master, a null
  // response here would be ambiguous. Detect zero-main locally before any
  // student fetch so we can flag the config directly.
  const mainCount = useMemo(
    () => subjects.filter((s) => s.role === "main").length,
    [subjects]
  );
  const incompleteConfig = mainCount === 0;

  // ---------- Roster state ----------
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  // ---------- Preview state ----------
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponseBody | null>(null);

  // Load the class roster (for the master's academic year) — only if the
  // config is workable. Skip for incomplete config to avoid an unnecessary
  // query when the admin still has work to do on the Subjects tab.
  useEffect(() => {
    if (incompleteConfig) {
      setRoster([]);
      setSelectedStudentId("");
      return;
    }
    let cancelled = false;
    (async () => {
      setRosterLoading(true);
      setRosterError(null);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("student_enrollments")
        .select(
          "roll_number, student:students(id, full_name, admission_no)"
        )
        .eq("class_id", classId)
        .eq("academic_year_id", academicYearId)
        .eq("status", "active")
        .order("roll_number", { ascending: true });
      if (cancelled) return;
      if (error) {
        setRoster([]);
        setRosterError(error.message);
        setRosterLoading(false);
        return;
      }
      // Supabase picks an array shape for the embedded relation but the FK is
      // singular — runtime value is one row per enrollment. Mirror the
      // SubjectsTab cast pattern.
      const rows = (
        (data ?? []) as unknown as {
          roll_number: number | null;
          student: {
            id: string;
            full_name: string;
            admission_no: string | null;
          } | null;
        }[]
      )
        .filter((r) => r.student !== null)
        .map((r) => ({
          student_id: r.student!.id,
          roll_number: r.roll_number,
          full_name: r.student!.full_name,
          admission_no: r.student!.admission_no ?? null,
        }));
      // Secondary sort by name when roll_number is missing.
      rows.sort((a, b) => {
        const ar = a.roll_number ?? Number.POSITIVE_INFINITY;
        const br = b.roll_number ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return a.full_name.localeCompare(b.full_name);
      });
      setRoster(rows);
      setRosterLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [classId, academicYearId, incompleteConfig]);

  // Clear selection / preview when class or year changes.
  useEffect(() => {
    setSelectedStudentId("");
    setPreview(null);
    setPreviewError(null);
  }, [classId, academicYearId]);

  // ---------- Preview fetch ----------
  const runPreview = useCallback(
    async (studentId: string) => {
      if (!studentId) return;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await adminFetch(
          `/api/result-masters/${resultMaster.id}/preview?student_id=${studentId}`
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPreview(null);
          setPreviewError(
            (body as { error?: string }).error ?? "Failed to compute preview"
          );
          return;
        }
        setPreview(body as PreviewResponseBody);
      } finally {
        setPreviewLoading(false);
      }
    },
    [resultMaster.id]
  );

  // Re-fetch when the selection changes (no manual refresh needed on pick).
  useEffect(() => {
    if (!selectedStudentId) {
      setPreview(null);
      return;
    }
    runPreview(selectedStudentId);
  }, [selectedStudentId, runPreview]);

  // ---------- Render: incomplete config ----------
  if (incompleteConfig) {
    return (
      <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 rounded-2xl">
        <CardContent className="py-6 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Incomplete config
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300/90">
              The final result can&apos;t be computed yet. Add at least one
              main subject on the{" "}
              <span className="font-medium">Subjects tab</span>, then come back
              here to preview a student.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------- Render: main ----------
  const selectedStudent = roster.find(
    (r) => r.student_id === selectedStudentId
  );

  // Final-result PDF link. The route auto-routes to its final-result branch
  // when academic_year_id is present and exam_type_id is omitted, so this
  // URL works as long as a result_master exists for the class/year (which
  // is guaranteed inside this tab).
  const previewPdfHref = selectedStudent
    ? `/api/results/report-card/pdf?student_id=${selectedStudent.student_id}&academic_year_id=${academicYearId}`
    : undefined;

  return (
    <div className="space-y-6">
      {/* -------- Picker bar -------- */}
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading">
            Preview a student&apos;s final result
          </CardTitle>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Pick any actively-enrolled student in {classLabel || "this class"}{" "}
            · {yearLabel || "this year"} to see the live computation. Use this
            to validate your Basic, Subjects, and Advanced configuration
            before publishing report cards.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1 flex-1 min-w-[260px]">
              <Label className="text-xs font-medium">Student</Label>
              <Select
                value={selectedStudentId || undefined}
                items={roster.map((r) => ({
                  value: r.student_id,
                  label: `${r.roll_number !== null ? `#${r.roll_number} · ` : ""}${r.full_name}${r.admission_no ? ` (Adm ${r.admission_no})` : ""}`,
                }))}
                onValueChange={(v) => v && setSelectedStudentId(v)}
                disabled={rosterLoading || roster.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      rosterLoading
                        ? "Loading roster..."
                        : roster.length === 0
                          ? "No enrolled students"
                          : "Choose a student..."
                    }
                  >
                    {(() => {
                      const r = roster.find(
                        (r) => r.student_id === selectedStudentId
                      );
                      if (!r) return null;
                      return `${r.roll_number !== null ? `#${r.roll_number} · ` : ""}${r.full_name}${r.admission_no ? ` (Adm ${r.admission_no})` : ""}`;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {roster.map((r) => {
                    const label = `${r.roll_number !== null ? `#${r.roll_number} · ` : ""}${r.full_name}${r.admission_no ? ` (Adm ${r.admission_no})` : ""}`;
                    return (
                      <SelectItem
                        key={r.student_id}
                        value={r.student_id}
                        label={label}
                      >
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              disabled={!selectedStudentId || previewLoading}
              onClick={() => runPreview(selectedStudentId)}
              title="Re-compute (useful after editing another tab)"
            >
              {previewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCcw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>
          {rosterError && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Failed to load roster: {rosterError}
            </p>
          )}
          {!rosterLoading && roster.length === 0 && !rosterError && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No students are actively enrolled in this class for{" "}
              {yearLabel || "this academic year"}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* -------- Preview body -------- */}
      {selectedStudentId && (
        <div className="space-y-6">
          {previewLoading ? (
            <Card className="bg-white dark:bg-card rounded-2xl">
              <CardContent className="py-10 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-navy-900 dark:text-white" />
              </CardContent>
            </Card>
          ) : previewError ? (
            <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 rounded-2xl">
              <CardContent className="py-6 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                    Preview failed
                  </p>
                  <p className="text-xs text-red-800 dark:text-red-300/90 mt-1">
                    {previewError}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : preview && preview.final_result === null ? (
            // Already-gated: master exists AND main subjects configured, so a
            // null here means the student has no published/entered results.
            <Card className="bg-white dark:bg-card rounded-2xl">
              <CardContent className="py-8 text-center space-y-1">
                <p className="text-sm font-medium text-navy-900 dark:text-white">
                  No results recorded
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {preview.student.full_name} has no results for{" "}
                  {yearLabel || "this academic year"} yet. Enter marks under
                  Exams → Results first.
                </p>
              </CardContent>
            </Card>
          ) : preview && preview.final_result ? (
            <PreviewBody
              finalResult={preview.final_result}
              studentName={preview.student.full_name}
              rollNumber={preview.student.roll_number}
              admissionNo={selectedStudent?.admission_no ?? null}
              classLabel={classLabel}
              yearLabel={yearLabel}
              previewPdfHref={previewPdfHref}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation — broken out so the fetch/gate logic above stays skimmable.
// ---------------------------------------------------------------------------

function PreviewBody({
  finalResult,
  studentName,
  rollNumber,
  admissionNo,
  classLabel,
  yearLabel,
  previewPdfHref,
}: {
  finalResult: FinalResult;
  studentName: string;
  rollNumber: number | null;
  admissionNo: string | null;
  classLabel: string;
  yearLabel: string;
  previewPdfHref?: string;
}) {
  const overall = finalResult.overall;
  const cfg = finalResult.config_applied;

  return (
    <>
      {/* Header strip */}
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-heading text-lg font-semibold text-navy-900 dark:text-white">
              {studentName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {admissionNo ? `Adm ${admissionNo}` : "No admission number"}
              {rollNumber !== null ? ` · Roll #${rollNumber}` : ""}
              {classLabel ? ` · ${classLabel}` : ""}
              {yearLabel ? ` · ${yearLabel}` : ""}
            </p>
          </div>
          <Badge
            className={
              overall.passed
                ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
                : "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800"
            }
          >
            {overall.passed ? "PASS" : "FAIL"}
          </Badge>
        </CardContent>
      </Card>

      {/* Overall block */}
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading">
            Overall result
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Main total" value={pct(overall.main_total_pct)} />
            <Stat label="Grade" value={overall.grade ?? "—"} />
            <Stat
              label="Result"
              value={overall.passed ? "Pass" : "Fail"}
              tone={overall.passed ? "ok" : "bad"}
            />
            {overall.grace_applied_total > 0 ? (
              <Stat
                label="Grace applied"
                value={`+${overall.grace_applied_total.toFixed(2)} pct pts`}
                tone="warn"
              />
            ) : (
              <Stat label="Grace applied" value="None" />
            )}
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted/40 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-0.5">
              Pass reason
            </p>
            <p className="text-sm text-navy-900 dark:text-white">
              {overall.pass_reason}
            </p>
          </div>
          {overall.main_total_pct_raw !== overall.main_total_pct && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Raw aggregate (pre-rounding):{" "}
              <span className="font-mono">
                {overall.main_total_pct_raw.toFixed(4)}%
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Main subjects */}
      <SubjectTable
        title={`Main subjects (${finalResult.main_subjects.length})`}
        rows={finalResult.main_subjects}
        showPassBadge
      />

      {/* Optional subjects — hidden when empty */}
      {finalResult.optional_subjects.length > 0 && (
        <SubjectTable
          title={`Optional subjects (${finalResult.optional_subjects.length})`}
          rows={finalResult.optional_subjects}
          showPassBadge={false}
          footnote="Optional subjects don't contribute to the main aggregate or pass/fail decision."
        />
      )}

      {/* Config applied summary */}
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading">
            Config applied
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <InfoChip
              label="Grade scale"
              value={cfg.grade_scale_name ?? "(none)"}
            />
            <InfoChip
              label="Best-of applied"
              value={cfg.best_of_applied ? "Yes" : "No"}
              tone={cfg.best_of_applied ? "warn" : undefined}
            />
            <InfoChip label="Rounding" value={cfg.rounding_summary} />
          </div>
          <div className="flex justify-between items-end pt-2 gap-3 flex-wrap">
            <div className="space-y-1">
              {previewPdfHref && (
                <a href={previewPdfHref} target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="outline"
                    className="text-navy-900 dark:text-white"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download sample PDF
                  </Button>
                </a>
              )}
              <p className="text-[11px] text-gray-500 dark:text-gray-400 max-w-md">
                Renders the final-result layout for this student using the
                same engine the public report card will use. Useful for
                eyeballing rounding, grace, and grade-scale config end-to-end.
              </p>
            </div>
            <p className="text-[10px] font-mono text-gray-400 dark:text-gray-500 break-all">
              rm: {cfg.result_master_id}
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "bad" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-green-700 dark:text-green-400"
      : tone === "bad"
        ? "text-red-700 dark:text-red-400"
        : tone === "warn"
          ? "text-amber-700 dark:text-amber-400"
          : "text-navy-900 dark:text-white";
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className={`text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function InfoChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`text-sm mt-0.5 ${
          tone === "warn"
            ? "text-amber-700 dark:text-amber-400"
            : "text-navy-900 dark:text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SubjectTable({
  title,
  rows,
  showPassBadge,
  footnote,
}: {
  title: string;
  rows: FinalSubject[];
  showPassBadge: boolean;
  footnote?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-gray-200 dark:border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">Subject</th>
                <th className="text-left px-3 py-2">Exam contributions</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">
                  Raw %
                </th>
                <th className="text-right px-3 py-2 whitespace-nowrap">
                  Grace
                </th>
                <th className="text-right px-3 py-2 whitespace-nowrap">
                  Final %
                </th>
                <th className="text-left px-3 py-2 w-16">Grade</th>
                {showPassBadge && (
                  <th className="text-left px-3 py-2 w-16">Pass?</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-border">
              {rows.map((s, i) => (
                <tr key={s.subject_id} className="align-top">
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2 font-medium text-navy-900 dark:text-white">
                    {s.subject_name}
                  </td>
                  <td className="px-3 py-2">
                    {s.exam_contributions.length === 0 ? (
                      <span className="text-xs italic text-gray-400 dark:text-gray-500">
                        no contributing exams
                      </span>
                    ) : (
                      <ul className="space-y-0.5">
                        {s.exam_contributions.map((c) => (
                          <li
                            key={c.exam_type_id}
                            className="text-xs text-gray-600 dark:text-gray-300 font-mono"
                            title={`${c.exam_name}: ${c.marks_obtained}/${c.max_marks} (${c.pct.toFixed(2)}%) × weight ${c.weight}`}
                          >
                            <span className="font-sans text-gray-500 dark:text-gray-400">
                              {c.exam_name}:
                            </span>{" "}
                            {c.marks_obtained}/{c.max_marks} ={" "}
                            {c.pct.toFixed(2)}% × w{c.weight}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {s.raw_pct.toFixed(2)}%
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${s.grace_applied > 0 ? "text-amber-700 dark:text-amber-400" : "text-gray-400 dark:text-gray-500"}`}
                  >
                    {s.grace_applied > 0
                      ? `+${s.grace_applied.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {s.final_pct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2">{s.grade ?? "—"}</td>
                  {showPassBadge && (
                    <td className="px-3 py-2">
                      <Badge
                        className={
                          s.passed
                            ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
                            : "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800"
                        }
                      >
                        {s.passed ? "Pass" : "Fail"}
                      </Badge>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footnote && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
            {footnote}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
