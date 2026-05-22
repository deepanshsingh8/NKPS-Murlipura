"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import { Input } from "@nkps/shared/components/ui/input";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { toast } from "sonner";
import { Save, Loader2, Download, Info, FileText } from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import { computeGrade, type GradeBand } from "@/lib/grading";
import { MarksImportDialog } from "@/components/MarksImportDialog";
import type { Class, Subject, ExamType } from "@nkps/shared/types";

interface EnrolledStudent {
  student_id: string;
  roll_number: number | null;
  full_name: string;
  admission_no: string | null;
}

type OrderBy = "roll" | "name" | "admission";

interface ExamScheduleInfo {
  exam_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  invigilator_name: string | null;
  notes: string | null;
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface MarksEntry {
  student_id: string;
  marks_obtained: number | "";
}


const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
  A: "bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800",
  "B+": "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  B: "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  C: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  D: "bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800",
  F: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
};

export default function TeacherResultsPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [marksEntries, setMarksEntries] = useState<MarksEntry[]>([]);

  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [selectedSubjectId, setSelectedSubjectId] = useUrlState("subject_id");
  const [selectedExamTypeId, setSelectedExamTypeId] = useUrlState("exam_type_id");

  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);

  const [maxMarks, setMaxMarks] = useState(100);
  const [gradeBands, setGradeBands] = useState<GradeBand[]>([]);

  const [orderBy, setOrderBy] = useState<OrderBy>("roll");
  const [examInfoOpen, setExamInfoOpen] = useState(false);
  const [examInfo, setExamInfo] = useState<ExamScheduleInfo | null>(null);
  const [examInfoLoading, setExamInfoLoading] = useState(false);

  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [classTeacherMap, setClassTeacherMap] = useState<
    Record<string, string | null>
  >({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [remarksLoading, setRemarksLoading] = useState(false);

  const isClassTeacher = Boolean(
    selectedClassId &&
      teacherId &&
      classTeacherMap[selectedClassId] === teacherId
  );

  // Lookup the selected class so the per-row "Preview Final Result" link can
  // resolve the academic_year_id without an extra API call.
  const selectedClassRow = useMemo(
    () => classes.find((c) => c.id === selectedClassId) ?? null,
    [classes, selectedClassId]
  );

  // Fetch teacher's assigned classes
  useEffect(() => {
    async function fetchClasses() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Resolve teacher_id from profiles
      const { data: profileData } = await supabase
        .from("profiles")
        .select("teacher_id")
        .eq("id", user.id)
        .single();

      const tid = profileData?.teacher_id;
      if (!tid) {
        setLoading(false);
        return;
      }
      setTeacherId(tid);

      // Get classes where this teacher has subject assignments
      const { data: classSubjects } = await supabase
        .from("class_subjects")
        .select("class_id, classes(id, name, section, academic_year_id, sort_order, class_teacher_id, streams:stream_id(name))")
        .eq("teacher_id", tid);

      if (classSubjects) {
        const uniqueClasses = new Map<string, Class>();
        const teacherByClass: Record<string, string | null> = {};
        for (const cs of classSubjects) {
          const cls = cs.classes as unknown as Class & {
            class_teacher_id: string | null;
          };
          if (cls && !uniqueClasses.has(cls.id)) {
            uniqueClasses.set(cls.id, cls);
            teacherByClass[cls.id] = cls.class_teacher_id ?? null;
          }
        }
        setClasses(
          Array.from(uniqueClasses.values()).sort(
            (a, b) => a.sort_order - b.sort_order
          )
        );
        setClassTeacherMap(teacherByClass);
      }

      // Fetch exam types for current academic year
      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .single();

      if (currentYear) {
        const { data: examTypesData } = await supabase
          .from("exam_types")
          .select("*")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });

        if (examTypesData) setExamTypes(examTypesData);
      }

      setLoading(false);
    }

    fetchClasses();
  }, []);

  // Fetch subjects for selected class (only those assigned to this teacher)
  useEffect(() => {
    if (!selectedClassId) {
      setSubjects([]);
      setSelectedSubjectId("");
      return;
    }

    async function fetchSubjects() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Resolve teacher_id from profiles
      const { data: profileData } = await supabase
        .from("profiles")
        .select("teacher_id")
        .eq("id", user.id)
        .single();

      const tid = profileData?.teacher_id;
      if (!tid) return;

      const { data: classSubjects } = await supabase
        .from("class_subjects")
        .select("subject_id, subjects(id, name, code, is_active)")
        .eq("class_id", selectedClassId)
        .eq("teacher_id", tid);

      if (classSubjects) {
        const subs = classSubjects
          .map((cs) => cs.subjects as unknown as Subject)
          .filter(Boolean);
        setSubjects(subs);
      }

      setSelectedSubjectId("");
    }

    fetchSubjects();
  }, [selectedClassId]);

  // Resolve the grade scale for the selected class (override → default
  // scholastic scale). Keeps grade chips in sync with the Grade Master.
  useEffect(() => {
    if (!selectedClassId) {
      setGradeBands([]);
      return;
    }
    async function fetchScale() {
      const supabase = createClient();
      const { data: override } = await supabase
        .from("class_grade_scales")
        .select("grade_scale_id")
        .eq("class_id", selectedClassId)
        .maybeSingle();

      let scaleId = override?.grade_scale_id as string | undefined;
      if (!scaleId) {
        const { data: def } = await supabase
          .from("grade_scales")
          .select("id")
          .eq("scope", "scholastic")
          .eq("is_default", true)
          .maybeSingle();
        scaleId = def?.id as string | undefined;
      }

      if (!scaleId) {
        setGradeBands([]);
        return;
      }

      const { data: bands } = await supabase
        .from("grade_bands")
        .select("label, min_pct, max_pct, remark, sort_order")
        .eq("grade_scale_id", scaleId)
        .order("sort_order", { ascending: true });

      setGradeBands((bands ?? []) as GradeBand[]);
    }
    fetchScale();
  }, [selectedClassId]);

  // Fetch students and existing marks when all 3 selectors are set
  const fetchStudentsAndMarks = useCallback(async () => {
    if (!selectedClassId || !selectedSubjectId || !selectedExamTypeId) {
      setStudents([]);
      setMarksEntries([]);
      return;
    }

    setLoadingStudents(true);
    const supabase = createClient();

    // Fetch enrolled students
    const { data: enrollments } = await supabase
      .from("student_enrollments")
      .select("student_id, roll_number, students(full_name, admission_no)")
      .eq("class_id", selectedClassId)
      .order("roll_number", { ascending: true });

    const enrolledStudents: EnrolledStudent[] = (enrollments ?? []).map(
      (e) => {
        const s = e.students as unknown as {
          full_name: string;
          admission_no: string;
        };
        return {
          student_id: e.student_id,
          roll_number: e.roll_number,
          full_name: s?.full_name ?? "Unknown",
          admission_no: s?.admission_no ?? null,
        };
      }
    );

    setStudents(enrolledStudents);

    // Fetch existing results
    const studentIds = enrolledStudents.map((s) => s.student_id);
    const { data: existingResults } = await supabase
      .from("results")
      .select("student_id, marks_obtained")
      .eq("subject_id", selectedSubjectId)
      .eq("exam_type_id", selectedExamTypeId)
      .in("student_id", studentIds.length > 0 ? studentIds : ["__none__"]);

    const existingMap = new Map<string, number>();
    for (const r of existingResults ?? []) {
      existingMap.set(r.student_id, r.marks_obtained);
    }

    // Pre-fill marks
    setMarksEntries(
      enrolledStudents.map((s) => ({
        student_id: s.student_id,
        marks_obtained: existingMap.get(s.student_id) ?? "",
      }))
    );

    // Get max_marks from exam type
    const examType = examTypes.find((et) => et.id === selectedExamTypeId);
    if (examType) setMaxMarks(examType.max_marks);

    setLoadingStudents(false);
  }, [selectedClassId, selectedSubjectId, selectedExamTypeId, examTypes]);

  useEffect(() => {
    fetchStudentsAndMarks();
  }, [fetchStudentsAndMarks]);

  // Fetch existing class-teacher remarks for the (class, exam) pair whenever
  // the teacher is the class teacher of the selected class and an exam is
  // picked. Independent of subject selection.
  useEffect(() => {
    if (!isClassTeacher || !selectedClassId || !selectedExamTypeId) {
      setRemarks({});
      return;
    }

    let cancelled = false;
    async function fetchRemarks() {
      setRemarksLoading(true);
      try {
        const res = await fetch(
          `/api/results/remarks?class_id=${selectedClassId}&exam_type_id=${selectedExamTypeId}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const r of data.remarks ?? []) {
          map[r.student_id] = r.remark;
        }
        setRemarks(map);
      } finally {
        if (!cancelled) setRemarksLoading(false);
      }
    }
    fetchRemarks();
    return () => {
      cancelled = true;
    };
  }, [isClassTeacher, selectedClassId, selectedExamTypeId]);

  function handleRemarkChange(studentId: string, value: string) {
    setRemarks((prev) => ({ ...prev, [studentId]: value }));
  }

  function handleMarksChange(studentId: string, value: string) {
    const numVal = value === "" ? "" : Number(value);
    setMarksEntries((prev) =>
      prev.map((e) =>
        e.student_id === studentId ? { ...e, marks_obtained: numVal } : e
      )
    );
  }

  async function handleSave() {
    // Validate marks entries
    const entries = marksEntries
      .filter((e) => e.marks_obtained !== "")
      .map((e) => ({
        student_id: e.student_id,
        marks_obtained: Number(e.marks_obtained),
      }));

    if (entries.length === 0 && !isClassTeacher) {
      toast.error("Please enter marks for at least one student");
      return;
    }

    // Check max marks
    const invalid = entries.find(
      (e) => e.marks_obtained > maxMarks || e.marks_obtained < 0
    );
    if (invalid) {
      toast.error(`Marks must be between 0 and ${maxMarks}`);
      return;
    }

    setSaving(true);

    // Build both API requests so they can run in parallel.
    const requests: Promise<{ ok: boolean; kind: "marks" | "remarks"; data: Record<string, unknown> }>[] = [];

    if (entries.length > 0) {
      requests.push(
        fetch("/api/results/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_id: selectedClassId,
            subject_id: selectedSubjectId,
            exam_type_id: selectedExamTypeId,
            entries,
          }),
        }).then(async (res) => ({
          ok: res.ok,
          kind: "marks" as const,
          data: await res.json(),
        }))
      );
    }

    if (isClassTeacher) {
      const remarkEntries = students.map((s) => ({
        student_id: s.student_id,
        remark: remarks[s.student_id] ?? "",
      }));
      requests.push(
        fetch("/api/results/remarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_id: selectedClassId,
            exam_type_id: selectedExamTypeId,
            entries: remarkEntries,
          }),
        }).then(async (res) => ({
          ok: res.ok,
          kind: "remarks" as const,
          data: await res.json(),
        }))
      );
    }

    try {
      const results = await Promise.all(requests);
      for (const r of results) {
        if (!r.ok) {
          toast.error(
            (r.data as { error?: string }).error ||
              `Failed to save ${r.kind}`
          );
        }
      }

      const marksResult = results.find((r) => r.kind === "marks");
      const remarksResult = results.find((r) => r.kind === "remarks");
      const parts: string[] = [];
      if (marksResult?.ok) {
        parts.push(
          `Marks saved for ${(marksResult.data as { count?: number }).count ?? entries.length} students`
        );
      }
      if (remarksResult?.ok) {
        const saved = (remarksResult.data as { saved?: number }).saved ?? 0;
        const cleared = (remarksResult.data as { cleared?: number }).cleared ?? 0;
        if (saved + cleared > 0) {
          parts.push(`Remarks updated for ${saved + cleared} students`);
        }
      }
      if (parts.length > 0) toast.success(parts.join(" · "));
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const hasInvalidMarks = marksEntries.some((e) => {
    if (e.marks_obtained === "") return false;
    const n = Number(e.marks_obtained);
    return n < 0 || n > maxMarks;
  });

  const marksByStudent = useMemo(() => {
    const m = new Map<string, number | "">();
    for (const e of marksEntries) m.set(e.student_id, e.marks_obtained);
    return m;
  }, [marksEntries]);

  const sortedStudents = useMemo(() => {
    const arr = [...students];
    arr.sort((a, b) => {
      if (orderBy === "name") return a.full_name.localeCompare(b.full_name);
      if (orderBy === "admission") {
        return (a.admission_no ?? "").localeCompare(b.admission_no ?? "");
      }
      // roll (default) — nulls go last
      const ra = a.roll_number ?? Number.MAX_SAFE_INTEGER;
      const rb = b.roll_number ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
    return arr;
  }, [students, orderBy]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
      </div>
    );
  }

  async function openExamInfo() {
    if (!selectedClassId || !selectedSubjectId || !selectedExamTypeId) return;
    setExamInfoOpen(true);
    setExamInfoLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("exam_schedules")
        .select(
          "exam_date, start_time, end_time, room, notes, teachers:invigilator_teacher_id(full_name)"
        )
        .eq("class_id", selectedClassId)
        .eq("subject_id", selectedSubjectId)
        .eq("exam_type_id", selectedExamTypeId)
        .maybeSingle();
      if (!data) {
        setExamInfo(null);
        return;
      }
      const teacher = data.teachers as unknown as { full_name: string } | null;
      setExamInfo({
        exam_date: (data.exam_date as string | null) ?? null,
        start_time: (data.start_time as string | null) ?? null,
        end_time: (data.end_time as string | null) ?? null,
        room: (data.room as string | null) ?? null,
        invigilator_name: teacher?.full_name ?? null,
        notes: (data.notes as string | null) ?? null,
      });
    } finally {
      setExamInfoLoading(false);
    }
  }

  function downloadExport() {
    if (!selectedClassId || !selectedSubjectId || !selectedExamTypeId) return;
    const url = `/api/results/export?class_id=${selectedClassId}&subject_id=${selectedSubjectId}&exam_type_id=${selectedExamTypeId}`;
    window.open(url, "_blank");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Enter Results
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Select class, subject, and exam type to enter student marks.
        </p>
      </div>

      {/* Selectors */}
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-900 dark:text-white">Class</label>
              <Select
                value={selectedClassId}
                items={classes.map((cls) => ({ value: cls.id, label: formatClassName(cls) }))}
                onValueChange={(val) => val && setSelectedClassId(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id} label={formatClassName(cls)}>
                      {formatClassName(cls)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-900 dark:text-white">
                Subject
              </label>
              <Select
                value={selectedSubjectId}
                items={subjects.map((sub) => ({ value: sub.id, label: sub.name + (sub.code ? ` (${sub.code})` : "") }))}
                onValueChange={(val) => val && setSelectedSubjectId(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((sub) => (
                    <SelectItem key={sub.id} value={sub.id} label={sub.name + (sub.code ? ` (${sub.code})` : "")}>
                      {sub.name}
                      {sub.code ? ` (${sub.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-900 dark:text-white">
                Exam Type
              </label>
              <Select
                value={selectedExamTypeId}
                items={examTypes.map((et) => ({ value: et.id, label: `${et.name} (Max: ${et.max_marks})` }))}
                onValueChange={(val) => val && setSelectedExamTypeId(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select exam" />
                </SelectTrigger>
                <SelectContent>
                  {examTypes.map((et) => (
                    <SelectItem key={et.id} value={et.id} label={`${et.name} (Max: ${et.max_marks})`}>
                      {et.name} (Max: {et.max_marks})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Marks Entry Table */}
      {selectedClassId && selectedSubjectId && selectedExamTypeId && (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <CardTitle className="text-navy-900 dark:text-white">
                Marks Entry
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                  (Max: {maxMarks})
                </span>
              </CardTitle>
              {isClassTeacher && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  As class teacher, add report-card remarks alongside each
                  student. Remarks are shared across all subjects for this exam.
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Order by
                  </span>
                  <Select
                    value={orderBy}
                    items={[
                      { value: "roll", label: "Roll" },
                      { value: "name", label: "Name" },
                      { value: "admission", label: "Admission" },
                    ]}
                    onValueChange={(v) => v && setOrderBy(v as OrderBy)}
                  >
                    <SelectTrigger className="h-8 w-[110px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roll" label="Roll">
                        Roll
                      </SelectItem>
                      <SelectItem value="name" label="Name">
                        Name
                      </SelectItem>
                      <SelectItem value="admission" label="Admission">
                        Admission
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openExamInfo}
                >
                  <Info className="h-4 w-4 mr-2" />
                  Exam Info
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadExport}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <MarksImportDialog
                  classId={selectedClassId}
                  examTypeId={selectedExamTypeId}
                  subjectId={selectedSubjectId}
                  onImported={fetchStudentsAndMarks}
                />
                <Button
                  onClick={handleSave}
                  disabled={saving || hasInvalidMarks}
                  className="bg-navy-900 text-white hover:bg-navy-900/90"
                  size="sm"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save All
                </Button>
              </div>
              {hasInvalidMarks && (
                <span className="text-xs font-medium text-red-600 dark:text-red-400">
                  Fix marks exceeding {maxMarks} to save
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingStudents || (isClassTeacher && remarksLoading) ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
              </div>
            ) : students.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 py-12">
                No students enrolled in this class.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Roll No.</TableHead>
                      <TableHead>Student Name</TableHead>
                      <TableHead className="w-32">Marks</TableHead>
                      <TableHead className="w-24">Grade</TableHead>
                      {isClassTeacher && (
                        <TableHead className="min-w-[260px]">
                          Class Teacher Remarks
                        </TableHead>
                      )}
                      {isClassTeacher && selectedClassRow?.academic_year_id ? (
                        <TableHead className="w-28 text-right">
                          Final Result
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedStudents.map((student) => {
                      const value = marksByStudent.get(student.student_id);
                      const marks =
                        value === undefined || value === ""
                          ? null
                          : Number(value);
                      const isInvalid =
                        marks !== null && (marks < 0 || marks > maxMarks);
                      const grade =
                        marks !== null && !isInvalid
                          ? computeGrade((marks / maxMarks) * 100, gradeBands)
                          : null;

                      return (
                        <TableRow key={student.student_id}>
                          <TableCell className="font-medium">
                            {student.roll_number ?? "-"}
                          </TableCell>
                          <TableCell>{student.full_name}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={maxMarks}
                              value={value ?? ""}
                              onChange={(e) =>
                                handleMarksChange(
                                  student.student_id,
                                  e.target.value
                                )
                              }
                              aria-invalid={isInvalid || undefined}
                              className={`w-24 h-8 ${
                                isInvalid
                                  ? "border-red-500 text-red-600 focus-visible:ring-red-500 dark:text-red-400"
                                  : ""
                              }`}
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell>
                            {grade ? (
                              <Badge
                                className={`text-xs ${GRADE_COLORS[grade] ?? ""}`}
                              >
                                {grade}
                              </Badge>
                            ) : isInvalid ? (
                              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                                &gt; {maxMarks}
                              </span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-500">--</span>
                            )}
                          </TableCell>
                          {isClassTeacher && (
                            <TableCell>
                              <textarea
                                value={remarks[student.student_id] ?? ""}
                                onChange={(e) =>
                                  handleRemarkChange(
                                    student.student_id,
                                    e.target.value
                                  )
                                }
                                placeholder="Optional report-card remark…"
                                rows={2}
                                className="w-full min-h-[44px] rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-muted px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500 resize-y"
                              />
                            </TableCell>
                          )}
                          {isClassTeacher && selectedClassRow?.academic_year_id ? (
                            <TableCell className="text-right">
                              <a
                                href={`/api/results/report-card/pdf?student_id=${student.student_id}&academic_year_id=${selectedClassRow.academic_year_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Preview the year-final report card (uses the live result master)"
                                className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-border px-2.5 py-1 text-xs font-medium text-navy-900 dark:text-white hover:bg-gray-50 dark:hover:bg-muted/50"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                Preview
                              </a>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={examInfoOpen} onOpenChange={setExamInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exam Info</DialogTitle>
          </DialogHeader>
          {examInfoLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !examInfo ? (
            <div className="py-4 text-sm text-gray-500 dark:text-gray-400">
              No schedule found for this class · subject · exam. Ask the admin
              to set one on the Timetable page.
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500 dark:text-gray-400">Date</span>
                <span className="font-medium text-navy-900 dark:text-white">
                  {formatDateShort(examInfo.exam_date)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500 dark:text-gray-400">Time</span>
                <span className="font-medium text-navy-900 dark:text-white">
                  {examInfo.start_time && examInfo.end_time
                    ? `${examInfo.start_time} – ${examInfo.end_time}`
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500 dark:text-gray-400">Room</span>
                <span className="font-medium text-navy-900 dark:text-white">
                  {examInfo.room ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500 dark:text-gray-400">Invigilator</span>
                <span className="font-medium text-navy-900 dark:text-white">
                  {examInfo.invigilator_name ?? "—"}
                </span>
              </div>
              {examInfo.notes && (
                <div className="pt-2 border-t border-gray-100 dark:border-border">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Notes
                  </p>
                  <p className="text-sm text-navy-900 dark:text-white whitespace-pre-wrap">
                    {examInfo.notes}
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
