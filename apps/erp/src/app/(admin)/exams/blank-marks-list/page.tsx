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
import { Download, FileText } from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType, Subject } from "@nkps/shared/types";

export default function AdminBlankMarksListPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const [classId, setClassId] = useState("");
  const [examTypeId, setExamTypeId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [downloading, setDownloading] = useState(false);

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
    if (!classId) {
      setSubjects([]);
      setSubjectId("");
      return;
    }

    async function fetchSubjects() {
      setLoadingSubjects(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("class_subjects")
        .select("subject_id, subjects(id, name, code, is_active)")
        .eq("class_id", classId);

      const subs = (data ?? [])
        .map((cs) => cs.subjects as unknown as Subject)
        .filter((s): s is Subject => Boolean(s) && s.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name));

      setSubjects(subs);
      setSubjectId("");
      setLoadingSubjects(false);
    }
    fetchSubjects();
  }, [classId]);

  const canDownload = Boolean(classId && examTypeId && subjectId);

  async function handleDownload() {
    if (!canDownload) return;
    setDownloading(true);
    try {
      const url = `/api/blank-marks-list/pdf?class_id=${encodeURIComponent(
        classId
      )}&exam_type_id=${encodeURIComponent(
        examTypeId
      )}&subject_id=${encodeURIComponent(subjectId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to generate PDF");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? "blank-marks-list.pdf";

      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Blank Marks List
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Print-ready list of students for a class + subject + exam — with an
          empty marks column ready for manual entry during grading.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-navy-900 dark:text-gold-500" />
            Pick class, exam and subject
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                Subject
              </label>
              <Select
                value={subjectId}
                onValueChange={(v) => setSubjectId(v ?? "")}
                disabled={!classId || loadingSubjects}
                items={subjects.map((s) => ({
                  value: s.id,
                  label: `${s.name}${s.code ? ` (${s.code})` : ""}`,
                }))}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !classId
                        ? "Pick class first"
                        : loadingSubjects
                          ? "Loading…"
                          : subjects.length === 0
                            ? "No subjects"
                            : "Select subject"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem
                      key={s.id}
                      value={s.id}
                      label={`${s.name}${s.code ? ` (${s.code})` : ""}`}
                    >
                      {s.name}
                      {s.code ? ` (${s.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end">
            <Button
              onClick={handleDownload}
              disabled={!canDownload || downloading}
            >
              <Download className="h-4 w-4 mr-2" />
              {downloading ? "Generating…" : "Download PDF"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
