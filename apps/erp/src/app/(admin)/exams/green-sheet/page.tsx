"use client";

import { Fragment, useEffect, useState } from "react";
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
import type { Class } from "@nkps/shared/types";
import type { GreenSheetData } from "@/lib/green-sheet";

interface AcademicYear {
  id: string;
  name: string;
  is_current: boolean;
}

export default function AdminGreenSheetPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "csv" | null>(null);
  const [preview, setPreview] = useState<GreenSheetData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchYears() {
      const supabase = createClient();
      const { data } = await supabase
        .from("academic_years")
        .select("id, name, is_current")
        .order("name", { ascending: false });
      const rows = (data ?? []) as AcademicYear[];
      setYears(rows);
      const current = rows.find((y) => y.is_current) ?? rows[0];
      if (current) setYearId(current.id);
      setLoading(false);
    }
    fetchYears();
  }, []);

  useEffect(() => {
    if (!yearId) {
      setClasses([]);
      setClassId("");
      return;
    }
    async function fetchClasses() {
      const supabase = createClient();
      const { data } = await supabase
        .from("classes")
        .select("*, streams:stream_id(name)")
        .eq("academic_year_id", yearId)
        .order("sort_order", { ascending: true });
      setClasses((data ?? []) as unknown as Class[]);
      setClassId("");
    }
    fetchClasses();
  }, [yearId]);

  useEffect(() => {
    if (!classId || !yearId) {
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
          `/api/green-sheet?class_id=${encodeURIComponent(
            classId
          )}&academic_year_id=${encodeURIComponent(yearId)}`
        );
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Failed to load");
          setPreview(null);
          return;
        }
        const data = (await res.json()) as GreenSheetData;
        if (!cancelled) setPreview(data);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [classId, yearId]);

  async function handleDownload(format: "pdf" | "csv") {
    if (!classId || !yearId) return;
    setDownloading(format);
    try {
      const url = `/api/green-sheet/${format}?class_id=${encodeURIComponent(
        classId
      )}&academic_year_id=${encodeURIComponent(yearId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to generate");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `green-sheet.${format}`;
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

  const canAct = Boolean(classId && yearId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Green Sheet
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Consolidated year view — per-exam totals plus weighted final result
          across all applicable exams for the class.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-green-700 dark:text-green-400" />
            Pick academic year and class
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                Academic Year
              </label>
              <Select
                value={yearId}
                onValueChange={(v) => setYearId(v ?? "")}
                items={years.map((y) => ({
                  value: y.id,
                  label: `${y.name}${y.is_current ? " (current)" : ""}`,
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem
                      key={y.id}
                      value={y.id}
                      label={`${y.name}${y.is_current ? " (current)" : ""}`}
                    >
                      {y.name}
                      {y.is_current ? " (current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                Class
              </label>
              <Select
                value={classId}
                onValueChange={(v) => setClassId(v ?? "")}
                disabled={!yearId || classes.length === 0}
                items={classes.map((c) => ({
                  value: c.id,
                  label: formatClassName(c),
                }))}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={!yearId ? "Pick year first" : "Select class"}
                  />
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
              {preview.meta.academic_year_label}
            </CardTitle>
            {!preview.meta.has_result_master ? (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                No result master configured — final-result columns will be
                blank. Configure a result master on this class to populate
                them.
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-green-50 dark:bg-green-950/20 border-b border-gray-200 dark:border-gray-800">
                    <th
                      className="px-2 py-2 text-center border-r border-gray-200 dark:border-gray-800"
                      rowSpan={2}
                    >
                      Roll
                    </th>
                    <th
                      className="px-2 py-2 text-left border-r border-gray-200 dark:border-gray-800 min-w-[160px]"
                      rowSpan={2}
                    >
                      Student
                    </th>
                    {preview.exams.map((e) => (
                      <th
                        key={e.exam_type_id}
                        className="px-2 py-2 text-center border-r border-gray-200 dark:border-gray-800"
                        colSpan={2}
                      >
                        {e.exam_name}
                        {e.weightage ? (
                          <span className="text-[10px] text-gray-500 ml-1">
                            ({e.weightage}%)
                          </span>
                        ) : null}
                      </th>
                    ))}
                    <th
                      className="px-2 py-2 text-center bg-green-100 dark:bg-green-900/30"
                      colSpan={preview.meta.show_rank ? 3 : 2}
                    >
                      Final
                    </th>
                  </tr>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 text-[11px]">
                    {preview.exams.map((e) => (
                      <Fragment key={e.exam_type_id}>
                        <th className="px-2 py-1.5 text-right border-r border-gray-200 dark:border-gray-800 font-normal text-gray-600 dark:text-gray-400">
                          Obt.
                        </th>
                        <th className="px-2 py-1.5 text-right border-r border-gray-200 dark:border-gray-800 font-normal text-gray-600 dark:text-gray-400">
                          %
                        </th>
                      </Fragment>
                    ))}
                    <th className="px-2 py-1.5 text-right border-r border-gray-200 dark:border-gray-800 font-normal text-gray-600 dark:text-gray-400 bg-green-50 dark:bg-green-950/20">
                      %
                    </th>
                    <th className="px-2 py-1.5 text-center border-r border-gray-200 dark:border-gray-800 font-normal text-gray-600 dark:text-gray-400 bg-green-50 dark:bg-green-950/20">
                      Grade
                    </th>
                    {preview.meta.show_rank ? (
                      <th className="px-2 py-1.5 text-center font-normal text-gray-600 dark:text-gray-400 bg-green-50 dark:bg-green-950/20">
                        Rank
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          2 +
                          preview.exams.length * 2 +
                          (preview.meta.show_rank ? 3 : 2)
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
                        {preview.exams.map((e) => {
                          const cell = r.per_exam[e.exam_type_id];
                          return (
                            <Fragment key={e.exam_type_id}>
                              <td className="px-2 py-1.5 text-right border-r border-gray-100 dark:border-gray-900">
                                {cell && cell.total_max > 0 ? (
                                  <span>
                                    {cell.total_obtained}
                                    <span className="text-gray-400">
                                      /{cell.total_max}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-700">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right border-r border-gray-100 dark:border-gray-900">
                                {cell && cell.percentage !== null
                                  ? cell.percentage.toFixed(1)
                                  : "—"}
                              </td>
                            </Fragment>
                          );
                        })}
                        <td className="px-2 py-1.5 text-right font-medium border-r border-gray-100 dark:border-gray-900 bg-green-50/50 dark:bg-green-950/10">
                          {r.final
                            ? r.final.overall.main_total_pct.toFixed(1)
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center border-r border-gray-100 dark:border-gray-900 bg-green-50/50 dark:bg-green-950/10">
                          {r.final?.overall.grade ?? "—"}
                        </td>
                        {preview.meta.show_rank ? (
                          <td className="px-2 py-1.5 text-center bg-green-50/50 dark:bg-green-950/10">
                            {r.final?.rank ?? "—"}
                          </td>
                        ) : null}
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
