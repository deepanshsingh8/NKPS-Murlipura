"use client";

import { useEffect, useState } from "react";
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
import { Button } from "@nkps/shared/components/ui/button";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType } from "@nkps/shared/types";
import type { WhiteSheetData } from "@/lib/white-sheet";

export default function AdminWhiteSheetPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [classId, setClassId] = useState("");
  const [examTypeId, setExamTypeId] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "csv" | null>(null);
  const [preview, setPreview] = useState<WhiteSheetData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInitial() {
      const supabase = createClient();
      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .single();

      if (currentYear) {
        const { data: classesData } = await supabase
          .from("classes")
          .select("*, streams:stream_id(name)")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        if (classesData) setClasses(classesData as unknown as Class[]);

        const { data: examTypesData } = await supabase
          .from("exam_types")
          .select("*")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        if (examTypesData) setExamTypes(examTypesData);
      }
      setLoading(false);
    }
    fetchInitial();
  }, []);

  useEffect(() => {
    if (!classId || !examTypeId) {
      setPreview(null);
      setError(null);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoadingPreview(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/white-sheet?class_id=${encodeURIComponent(
            classId
          )}&exam_type_id=${encodeURIComponent(examTypeId)}`
        );
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Failed to load");
          setPreview(null);
          return;
        }
        const data = (await res.json()) as WhiteSheetData;
        if (!cancelled) setPreview(data);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [classId, examTypeId]);

  async function handleDownload(format: "pdf" | "csv") {
    if (!classId || !examTypeId) return;
    setDownloading(format);
    try {
      const url = `/api/white-sheet/${format}?class_id=${encodeURIComponent(
        classId
      )}&exam_type_id=${encodeURIComponent(examTypeId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to generate");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `white-sheet.${format}`;
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } finally {
      setDownloading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
      </div>
    );
  }

  const canAct = Boolean(classId && examTypeId);
  const hasOptional = preview?.subjects.some((s) => s.role === "optional");
  const splitTotals = hasOptional && preview?.meta.show_extra_separately;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          White Sheet
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Class-wide marks grid for a single exam — subjects across, students
          down — with totals, percentage, and grade.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-navy-900 dark:text-gold-500" />
            Pick class and exam
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                Class
              </label>
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
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                Exam
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
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => handleDownload("csv")}
              disabled={!canAct || downloading !== null}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              {downloading === "csv" ? "Exporting…" : "CSV"}
            </Button>
            <Button
              onClick={() => handleDownload("pdf")}
              disabled={!canAct || downloading !== null}
            >
              <Download className="h-4 w-4 mr-2" />
              {downloading === "pdf" ? "Generating…" : "PDF"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      {canAct && loadingPreview ? (
        <div className="flex items-center justify-center h-40">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
        </div>
      ) : preview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {preview.meta.class_name}
              {preview.meta.section ? ` — ${preview.meta.section}` : ""} ·{" "}
              {preview.meta.exam_name}
            </CardTitle>
            {!preview.meta.has_result_master ? (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                No result master configured for this class/year — every subject
                is treated as main.
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
                    <th className="px-2 py-2 text-center border-r border-gray-200 dark:border-gray-800 w-12">
                      Roll
                    </th>
                    <th className="px-2 py-2 text-left border-r border-gray-200 dark:border-gray-800 min-w-[160px]">
                      Student
                    </th>
                    {preview.subjects.map((s) => (
                      <th
                        key={s.subject_id}
                        className={`px-2 py-2 text-center border-r border-gray-200 dark:border-gray-800 min-w-[60px] ${
                          s.role === "optional"
                            ? "bg-amber-50 dark:bg-amber-950/20"
                            : "bg-sky-50 dark:bg-sky-950/20"
                        }`}
                        title={s.name}
                      >
                        {s.code ?? s.name}
                      </th>
                    ))}
                    {splitTotals ? (
                      <>
                        <th className="px-2 py-2 text-right border-r border-gray-200 dark:border-gray-800">
                          Main
                        </th>
                        <th className="px-2 py-2 text-right border-r border-gray-200 dark:border-gray-800">
                          Optional
                        </th>
                        <th className="px-2 py-2 text-right border-r border-gray-200 dark:border-gray-800">
                          Total
                        </th>
                      </>
                    ) : (
                      <th className="px-2 py-2 text-right border-r border-gray-200 dark:border-gray-800">
                        Total
                      </th>
                    )}
                    <th className="px-2 py-2 text-right border-r border-gray-200 dark:border-gray-800">
                      %
                    </th>
                    <th className="px-2 py-2 text-center">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          3 + preview.subjects.length + (splitTotals ? 3 : 1)
                        }
                        className="px-4 py-6 text-center text-gray-500 dark:text-gray-400"
                      >
                        No students enrolled.
                      </td>
                    </tr>
                  ) : (
                    preview.rows.map((r) => (
                      <tr
                        key={r.student_id}
                        className="border-b border-gray-100 dark:border-gray-900 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                      >
                        <td className="px-2 py-1.5 text-center border-r border-gray-100 dark:border-gray-900">
                          {r.roll_number ?? ""}
                        </td>
                        <td className="px-2 py-1.5 border-r border-gray-100 dark:border-gray-900">
                          {r.full_name}
                        </td>
                        {preview.subjects.map((s) => {
                          const m = r.marks_by_subject[s.subject_id];
                          return (
                            <td
                              key={s.subject_id}
                              className="px-2 py-1.5 text-center border-r border-gray-100 dark:border-gray-900"
                            >
                              {m === null || m === undefined ? (
                                <span className="text-gray-300 dark:text-gray-700">
                                  —
                                </span>
                              ) : (
                                m
                              )}
                            </td>
                          );
                        })}
                        {splitTotals ? (
                          <>
                            <td className="px-2 py-1.5 text-right border-r border-gray-100 dark:border-gray-900">
                              {r.main_obtained}
                            </td>
                            <td className="px-2 py-1.5 text-right border-r border-gray-100 dark:border-gray-900">
                              {r.optional_obtained}
                            </td>
                            <td className="px-2 py-1.5 text-right font-medium border-r border-gray-100 dark:border-gray-900">
                              {r.total_obtained}
                            </td>
                          </>
                        ) : (
                          <td className="px-2 py-1.5 text-right font-medium border-r border-gray-100 dark:border-gray-900">
                            {r.total_obtained}
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-right border-r border-gray-100 dark:border-gray-900">
                          {r.percentage === null
                            ? "—"
                            : r.percentage.toFixed(1)}
                        </td>
                        <td className="px-2 py-1.5 text-center font-medium">
                          {r.grade ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
