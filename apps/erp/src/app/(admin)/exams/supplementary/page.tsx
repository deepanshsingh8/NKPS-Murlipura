"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Input } from "@nkps/shared/components/ui/input";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType } from "@nkps/shared/types";
import type { SupplementaryEligibleResult } from "@/lib/supplementary";

interface RowState {
  retest_marks: string;
  retest_max: string;
  passed: boolean;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AdminSupplementaryPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [classId, setClassId] = useState("");
  const [examTypeId, setExamTypeId] = useState("");
  const [retestDate, setRetestDate] = useState(todayISO());

  const [data, setData] = useState<SupplementaryEligibleResult | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const supabase = createClient();
      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();
      if (currentYear) {
        const { data: cls } = await supabase
          .from("classes")
          .select("*, streams:stream_id(name)")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        setClasses((cls ?? []) as unknown as Class[]);

        const { data: et } = await supabase
          .from("exam_types")
          .select("*")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        setExamTypes((et ?? []) as ExamType[]);
      }
      setLoading(false);
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!classId || !examTypeId) {
      setData(null);
      setRows({});
      return;
    }
    let cancelled = false;
    async function load() {
      setLoadingData(true);
      try {
        const res = await fetch(
          `/api/supplementary/eligible?class_id=${encodeURIComponent(
            classId
          )}&exam_type_id=${encodeURIComponent(examTypeId)}`
        );
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error ?? "Failed to load eligibility list");
          setData(null);
          return;
        }
        const body = (await res.json()) as SupplementaryEligibleResult;
        setData(body);
        // Seed row state from existing attempts (or sensible defaults).
        const map: Record<string, RowState> = {};
        for (const e of body.entries) {
          const key = `${e.student_id}|${e.subject_id}`;
          map[key] = {
            retest_marks: e.attempt_marks !== null ? String(e.attempt_marks) : "",
            retest_max: String(e.max_marks),
            passed: e.attempt_passed ?? false,
          };
        }
        setRows(map);
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [classId, examTypeId]);

  const passThresholdMarks = useMemo(
    () =>
      new Map(
        (data?.entries ?? []).map((e) => [
          `${e.student_id}|${e.subject_id}`,
          e.pass_threshold_marks,
        ])
      ),
    [data]
  );

  function patch(key: string, patchObj: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [key]: {
        retest_marks: prev[key]?.retest_marks ?? "",
        retest_max: prev[key]?.retest_max ?? "",
        passed: prev[key]?.passed ?? false,
        ...patchObj,
      },
    }));
  }

  function autoComputePassed(key: string) {
    const r = rows[key];
    if (!r) return;
    const obtained = Number(r.retest_marks);
    const max = Number(r.retest_max);
    const threshold = passThresholdMarks.get(key) ?? 0;
    if (Number.isNaN(obtained) || Number.isNaN(max) || max <= 0) return;
    // Threshold from eligibility lib is in original-exam marks; if retest
    // uses a different max, scale the threshold proportionally.
    const original = data?.entries.find(
      (e) => `${e.student_id}|${e.subject_id}` === key
    );
    const scaledThreshold =
      original && original.max_marks > 0
        ? (threshold / original.max_marks) * max
        : threshold;
    patch(key, { passed: obtained >= scaledThreshold });
  }

  async function handleSave() {
    if (!data || !classId || !examTypeId) return;
    const entries = data.entries
      .map((e) => {
        const key = `${e.student_id}|${e.subject_id}`;
        const r = rows[key];
        if (!r) return null;
        const marks = Number(r.retest_marks);
        const max = Number(r.retest_max);
        if (
          r.retest_marks === "" ||
          Number.isNaN(marks) ||
          Number.isNaN(max) ||
          max <= 0
        ) {
          return null;
        }
        return {
          student_id: e.student_id,
          subject_id: e.subject_id,
          marks_obtained: marks,
          max_marks: max,
          passed: r.passed,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (entries.length === 0) {
      toast.error("No retest marks to save");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/supplementary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: classId,
          parent_exam_type_id: examTypeId,
          retest_date: retestDate || null,
          entries,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Save failed");
        return;
      }
      toast.success(`Saved ${body.count} retest entries`);
      // Reload
      const reload = await fetch(
        `/api/supplementary/eligible?class_id=${encodeURIComponent(
          classId
        )}&exam_type_id=${encodeURIComponent(examTypeId)}`
      );
      if (reload.ok) setData(await reload.json());
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-gold-500" />
      </div>
    );
  }

  const canAct = Boolean(classId && examTypeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Supplementary Exams
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Identify students who failed one or two subjects but qualify for a
          retest, record the retest marks, and let the final result
          recompute automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-navy-900 dark:text-gold-500" />
            Pick class and exam
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Class</label>
              <Select
                value={classId}
                onValueChange={(v) => setClassId(v ?? "")}
                items={classes.map((c) => ({
                  value: c.id,
                  label: formatClassName(c),
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id} label={formatClassName(c)}>
                      {formatClassName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Parent exam
              </label>
              <Select
                value={examTypeId}
                onValueChange={(v) => setExamTypeId(v ?? "")}
                items={examTypes.map((e) => ({ value: e.id, label: e.name }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select exam" />
                </SelectTrigger>
                <SelectContent>
                  {examTypes.map((e) => (
                    <SelectItem key={e.id} value={e.id} label={e.name}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Retest date
              </label>
              <Input
                type="date"
                value={retestDate}
                onChange={(e) => setRetestDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {data && data.meta.has_result_master === false ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              No Result Master configured for this class — eligibility falls
              back to the global pass mark default ({data.meta.pass_mark_value}
              {data.meta.pass_mark_mode === "percentage" ? "%" : " marks"}).
            </p>
          </CardContent>
        </Card>
      ) : null}

      {data && data.meta.min_for_supplementary === null ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              No <code>min_for_supplementary</code> threshold set on Result
              Master — every failing student is shown as eligible. Set a
              threshold (e.g. 25
              {data.meta.pass_mark_mode === "percentage" ? "%" : " marks"}) on
              the Result Master page to restrict eligibility.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {canAct && loadingData ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-gold-500" />
        </div>
      ) : data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Eligibility — {data.entries.length} candidate
              {data.entries.length === 1 ? "" : "s"}
            </CardTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Cap per student: {data.meta.max_supplementary_subjects} subject
              {data.meta.max_supplementary_subjects === 1 ? "" : "s"} ·
              Pass action:{" "}
              <code>{data.meta.supplementary_pass_action}</code>
            </p>
          </CardHeader>
          <CardContent>
            {data.entries.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
                No students currently eligible for supplementary in this
                exam.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Roll</TableHead>
                        <TableHead className="min-w-[180px]">Student</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead className="w-28 text-right">
                          Original
                        </TableHead>
                        <TableHead className="w-28 text-right">
                          Pass cutoff
                        </TableHead>
                        <TableHead className="w-32">Retest marks</TableHead>
                        <TableHead className="w-24">Out of</TableHead>
                        <TableHead className="w-32">Outcome</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.entries.map((e) => {
                        const key = `${e.student_id}|${e.subject_id}`;
                        const r = rows[key] ?? {
                          retest_marks: "",
                          retest_max: String(e.max_marks),
                          passed: false,
                        };
                        return (
                          <TableRow key={key}>
                            <TableCell className="font-medium">
                              {e.roll_number ?? "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span>{e.full_name}</span>
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                  {e.admission_no}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{e.subject_name}</TableCell>
                            <TableCell className="text-right">
                              <span
                                className={
                                  e.marks_obtained < e.pass_threshold_marks
                                    ? "text-red-600 dark:text-red-400 font-medium"
                                    : ""
                                }
                              >
                                {e.marks_obtained}/{e.max_marks}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              {e.pass_threshold_marks.toFixed(1)}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                max={Number(r.retest_max) || e.max_marks}
                                step="0.5"
                                className="h-8 text-xs"
                                value={r.retest_marks}
                                onChange={(ev) => {
                                  patch(key, {
                                    retest_marks: ev.target.value,
                                  });
                                }}
                                onBlur={() => autoComputePassed(key)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                step="0.5"
                                className="h-8 text-xs"
                                value={r.retest_max}
                                onChange={(ev) =>
                                  patch(key, { retest_max: ev.target.value })
                                }
                                onBlur={() => autoComputePassed(key)}
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={r.passed ? "passed" : "failed"}
                                onValueChange={(v) =>
                                  patch(key, { passed: v === "passed" })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="passed">
                                    <span className="flex items-center gap-1">
                                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                                      Passed
                                    </span>
                                  </SelectItem>
                                  <SelectItem value="failed">
                                    <span className="flex items-center gap-1">
                                      <XCircle className="h-3 w-3 text-red-600" />
                                      Failed
                                    </span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              {e.has_attempt ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] mt-1"
                                >
                                  saved
                                </Badge>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-end mt-4">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    {saving ? "Saving…" : "Save retest marks"}
                  </Button>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 text-right">
                  Passed entries are substituted into final-result computation
                  using the configured action ({data.meta.supplementary_pass_action}).
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
