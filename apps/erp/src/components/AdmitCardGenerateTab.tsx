"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Label } from "@nkps/shared/components/ui/label";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
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
  Download,
  Loader2,
  Users,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType } from "@nkps/shared/types";

interface TemplateOption {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
}

interface StudentRow {
  student_id: string;
  full_name: string;
  father_name: string | null;
  admission_no: string;
  phone: string | null;
  roll_number: number | null;
}

interface ScheduleCheck {
  exists: boolean;
  count: number;
}

// Triggers a file download from a fetch Response.
async function downloadFromResponse(res: Response, fallbackName: string) {
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AdmitCardGenerateTab({
  templates,
}: {
  templates: TemplateOption[];
}) {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [selectedExamTypeId, setSelectedExamTypeId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scheduleCheck, setScheduleCheck] = useState<ScheduleCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const activeTemplates = useMemo(
    () => templates.filter((t) => t.is_active),
    [templates]
  );

  // Pre-select the default template if one exists.
  useEffect(() => {
    if (!selectedTemplateId && activeTemplates.length > 0) {
      const def = activeTemplates.find((t) => t.is_default);
      setSelectedTemplateId(def?.id ?? activeTemplates[0].id);
    }
  }, [activeTemplates, selectedTemplateId]);

  const fetchInitial = useCallback(async () => {
    const supabase = createClient();
    const { data: current } = await supabase
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    if (!current) return;

    const [classesRes, examsRes] = await Promise.all([
      supabase
        .from("classes")
        .select("*, streams:stream_id(name)")
        .eq("academic_year_id", current.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("exam_types")
        .select("*")
        .eq("academic_year_id", current.id)
        .order("sort_order", { ascending: true }),
    ]);
    setClasses((classesRes.data as Class[]) ?? []);
    setExamTypes((examsRes.data as ExamType[]) ?? []);
  }, []);

  useEffect(() => {
    fetchInitial().finally(() => setLoading(false));
  }, [fetchInitial]);

  const loadStudents = useCallback(async () => {
    if (!selectedClassId || !selectedExamTypeId) {
      setStudents([]);
      setScheduleCheck(null);
      return;
    }
    setLoadingStudents(true);
    try {
      const supabase = createClient();

      // Students first.
      const { data: enrollments, error } = await supabase
        .from("student_enrollments")
        .select(
          "student_id, roll_number, students(id, full_name, father_name, admission_no, phone)"
        )
        .eq("class_id", selectedClassId)
        .eq("status", "active")
        .order("roll_number", { ascending: true, nullsFirst: false });

      if (error) {
        toast.error("Failed to load students");
        setStudents([]);
      } else {
        const rows: StudentRow[] = (enrollments ?? []).map((e) => {
          const s = e.students as unknown as {
            id: string;
            full_name: string;
            father_name: string | null;
            admission_no: string;
            phone: string | null;
          };
          return {
            student_id: s.id,
            full_name: s.full_name,
            father_name: s.father_name,
            admission_no: s.admission_no,
            phone: s.phone,
            roll_number: e.roll_number ?? null,
          };
        });
        setStudents(rows);
        setSelectedIds(new Set());
      }

      // Schedule sanity check so admin knows if the admit card will have
      // an empty schedule table.
      const { count } = await supabase
        .from("exam_schedules")
        .select("id", { count: "exact", head: true })
        .eq("class_id", selectedClassId)
        .eq("exam_type_id", selectedExamTypeId);
      setScheduleCheck({ exists: (count ?? 0) > 0, count: count ?? 0 });
    } finally {
      setLoadingStudents(false);
    }
  }, [selectedClassId, selectedExamTypeId]);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) =>
      prev.size === students.length
        ? new Set()
        : new Set(students.map((s) => s.student_id))
    );
  };

  const downloadBulk = async (mode: "selected" | "all") => {
    if (!selectedExamTypeId || !selectedClassId) {
      toast.error("Pick exam, class, and template first.");
      return;
    }
    if (!selectedTemplateId) {
      toast.error("Pick a template (or set a default).");
      return;
    }
    if (mode === "selected" && selectedIds.size === 0) {
      toast.error("Select at least one student.");
      return;
    }
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      params.set("class_id", selectedClassId);
      params.set("exam_type_id", selectedExamTypeId);
      params.set("template_id", selectedTemplateId);
      if (mode === "selected") {
        // Send as a comma-joined string (the API accepts both forms).
        params.set("student_ids", Array.from(selectedIds).join(","));
      }
      const res = await adminFetch(
        `/api/admit-cards/bulk?${params.toString()}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(
          body.error ??
            `Failed to generate admit cards (${res.status})`
        );
        return;
      }
      await downloadFromResponse(res, "admit-cards.pdf");
      toast.success("Admit cards downloaded");
    } finally {
      setDownloading(false);
    }
  };

  const downloadOne = async (studentId: string) => {
    if (!selectedExamTypeId) {
      toast.error("Pick an exam first.");
      return;
    }
    if (!selectedTemplateId) {
      toast.error("Pick a template first.");
      return;
    }
    const params = new URLSearchParams({
      student_id: studentId,
      exam_type_id: selectedExamTypeId,
      template_id: selectedTemplateId,
    });
    const res = await adminFetch(
      `/api/admit-cards/pdf?${params.toString()}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to generate admit card");
      return;
    }
    await downloadFromResponse(res, `admit-card-${studentId}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const allSelected =
    students.length > 0 && selectedIds.size === students.length;

  return (
    <div className="space-y-4">
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="pt-6 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Exam</Label>
              <Select
                value={selectedExamTypeId}
                items={examTypes.map((e) => ({ value: e.id, label: e.name }))}
                onValueChange={(v) => v && setSelectedExamTypeId(v)}
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
            <div className="space-y-1">
              <Label>Class</Label>
              <Select
                value={selectedClassId}
                items={classes.map((c) => ({
                  value: c.id,
                  label: formatClassName(c),
                }))}
                onValueChange={(v) => v && setSelectedClassId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      label={formatClassName(c)}
                    >
                      {formatClassName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Template</Label>
              <Select
                value={selectedTemplateId}
                items={activeTemplates.map((t) => ({
                  value: t.id,
                  label: t.is_default ? `${t.name} (default)` : t.name,
                }))}
                onValueChange={(v) => v && setSelectedTemplateId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {activeTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id} label={t.name}>
                      {t.name} {t.is_default ? "· Default" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={loadStudents}
              disabled={!selectedExamTypeId || !selectedClassId}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {loadingStudents && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Display students
            </Button>
          </div>

          {scheduleCheck && !scheduleCheck.exists && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                No exam schedule rows exist for this class &amp; exam. The admit
                card will still generate, but the schedule table will be empty.
                Add rows on{" "}
                <a
                  href="/exams/timetable"
                  className="underline font-medium"
                >
                  /exams/timetable
                </a>{" "}
                first for a complete card.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {students.length > 0 && (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-sm text-gray-500 flex items-center gap-2">
                <Users className="h-4 w-4" />
                {students.length} student{students.length === 1 ? "" : "s"}
                {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadBulk("selected")}
                  disabled={downloading || selectedIds.size === 0}
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download Selected ({selectedIds.size})
                </Button>
                <Button
                  onClick={() => downloadBulk("all")}
                  disabled={downloading}
                  className="bg-navy-900 text-white hover:bg-navy-900/90"
                  size="sm"
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download Class ({students.length})
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead className="w-14">SR</TableHead>
                  <TableHead className="w-24">Roll</TableHead>
                  <TableHead>Student Name</TableHead>
                  <TableHead>Father Name</TableHead>
                  <TableHead className="w-32">Admission No.</TableHead>
                  <TableHead className="w-32">Phone</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s, idx) => (
                  <TableRow key={s.student_id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(s.student_id)}
                        onCheckedChange={() => toggleOne(s.student_id)}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {idx + 1}
                    </TableCell>
                    <TableCell>{s.roll_number ?? "—"}</TableCell>
                    <TableCell className="font-medium">{s.full_name}</TableCell>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-300">
                      {s.father_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{s.admission_no}</TableCell>
                    <TableCell className="text-xs">
                      {s.phone ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadOne(s.student_id)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTemplates.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <p className="text-sm text-gray-500">
            No active admit card templates. Create one on the{" "}
            <span className="font-medium">Templates</span> tab first.
          </p>
        </div>
      )}
    </div>
  );
}
