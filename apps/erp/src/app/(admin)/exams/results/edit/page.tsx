"use client";

import { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { adminFetch, adminPatch } from "@nkps/shared/lib/admin-api";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import { Input } from "@nkps/shared/components/ui/input";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
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
  Search,
  Loader2,
  Save,
  Trash2,
  Lock,
  Unlock,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType } from "@nkps/shared/types";

interface StudentRow {
  id: string;
  full_name: string;
  admission_no: string;
  class_id: string | null;
  class_label: string | null;
}

interface SubjectResult {
  id: string;
  subject_id: string;
  subject_name: string;
  subject_code: string | null;
  marks_obtained: number;
  max_marks: number;
  grade: string | null;
  is_published: boolean;
  updated_at: string;
}

interface SubjectRosterEntry {
  subject_id: string;
  subject_name: string;
  subject_code: string | null;
}

interface ExamGroup {
  exam_type_id: string;
  exam_name: string;
  exam_max_marks: number;
  class_id: string;
  class_name: string;
  class_section: string | null;
  class_stream: string | null;
  subjects: SubjectResult[];
  subject_roster: SubjectRosterEntry[];
}

interface StudentDetailResponse {
  data: {
    student: {
      id: string;
      full_name: string;
      admission_no: string;
      photo_url: string | null;
      is_active: boolean;
    };
    primary_class: {
      id: string;
      name: string;
      section: string | null;
      stream: string | null;
    } | null;
    exams: ExamGroup[];
  };
}

function classLabel(name: string, section: string | null, stream: string | null): string {
  let label = section ? `${name} - ${section}` : name;
  if (stream) label += ` (${stream})`;
  return label;
}

function AdminResultsEditPageInner() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [selectedExamTypeId, setSelectedExamTypeId] = useUrlState("exam_type_id");

  const [allStudents, setAllStudents] = useState<StudentRow[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [query, setQuery] = useUrlState("q");

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentDetailResponse["data"] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [openExamId, setOpenExamId] = useState<string | null>(null);

  // Load the class and exam-type pickers from the current academic year — same
  // source as the overview page, so labels/IDs match the link they came from.
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .single();
      if (!currentYear) return;

      const { data: classesData } = await supabase
        .from("classes")
        .select("*, streams:stream_id(name)")
        .eq("academic_year_id", currentYear.id)
        .order("sort_order", { ascending: true });
      if (classesData) setClasses(classesData);

      const { data: examTypesData } = await supabase
        .from("exam_types")
        .select("*")
        .eq("academic_year_id", currentYear.id)
        .order("sort_order", { ascending: true });
      if (examTypesData) setExamTypes(examTypesData);
    }
    load();
  }, []);

  // Bootstrap student list (current admin/editor scope already enforced by API).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingStudents(true);
      const res = await adminFetch("/api/students");
      if (cancelled) return;
      if (!res.ok) {
        toast.error("Failed to load students");
        setLoadingStudents(false);
        return;
      }
      const body = (await res.json()) as {
        data: Array<{
          id: string;
          full_name: string;
          admission_no: string;
          class_id?: string | null;
          class_name?: string | null;
          class_section?: string | null;
        }>;
      };
      const rows: StudentRow[] = (body.data ?? []).map((s) => {
        const cl = s.class_name
          ? s.class_section
            ? `${s.class_name} - ${s.class_section}`
            : s.class_name
          : null;
        return {
          id: s.id,
          full_name: s.full_name,
          admission_no: s.admission_no,
          class_id: s.class_id ?? null,
          class_label: cl,
        };
      });
      setAllStudents(rows);
      setLoadingStudents(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filtered student list. Two modes:
  //   - Class selected → list every student in that class (search narrows it).
  //   - No class → require ≥2 chars of free-form search (original behavior),
  //     so direct navigation to /edit still works without forcing a class pick.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const queryFilter = (s: StudentRow) =>
      !q ||
      s.full_name.toLowerCase().includes(q) ||
      s.admission_no.toLowerCase().includes(q);

    if (selectedClassId) {
      return allStudents
        .filter((s) => s.class_id === selectedClassId)
        .filter(queryFilter)
        .slice(0, 200);
    }
    if (q.length < 2) return [];
    return allStudents.filter(queryFilter).slice(0, 20);
  }, [allStudents, query, selectedClassId]);

  const fetchDetail = useCallback(async (studentId: string) => {
    setLoadingDetail(true);
    try {
      const res = await adminFetch(
        `/api/results/by-student?student_id=${encodeURIComponent(studentId)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to load results");
        setDetail(null);
        return;
      }
      const body = (await res.json()) as StudentDetailResponse;
      setDetail(body.data);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStudentId) void fetchDetail(selectedStudentId);
  }, [selectedStudentId, fetchDetail]);

  // Auto-open the right exam group: the pre-selected exam if the student has
  // results for it, otherwise the only exam (if there's just one). Reacts to
  // exam-type changes so flipping the selector pops the matching panel open.
  useEffect(() => {
    if (!detail) return;
    if (
      selectedExamTypeId &&
      detail.exams.some((e) => e.exam_type_id === selectedExamTypeId)
    ) {
      setOpenExamId(selectedExamTypeId);
      return;
    }
    if (detail.exams.length === 1) {
      setOpenExamId(detail.exams[0].exam_type_id);
    }
  }, [detail, selectedExamTypeId]);

  function clearSelection() {
    setSelectedStudentId(null);
    setDetail(null);
    setOpenExamId(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Edit Student Results
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Search any student and edit their per-subject marks across exams.
            Independent of teacher class/subject assignments.
          </p>
        </div>
        <Link
          href="/exams/results"
          className="inline-flex items-center text-sm text-navy-900 dark:text-gold-500 hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to overview
        </Link>
      </div>

      {!selectedStudentId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4 text-navy-900 dark:text-gold-500" />
              Find a student
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-900 dark:text-white">
                  Class
                </label>
                <Select
                  value={selectedClassId}
                  items={[
                    { value: "__all__", label: "All classes" },
                    ...classes.map((cls) => ({
                      value: cls.id,
                      label: formatClassName(cls),
                    })),
                  ]}
                  onValueChange={(val) => {
                    if (!val) return;
                    setSelectedClassId(val === "__all__" ? "" : val);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__" label="All classes">
                      All classes
                    </SelectItem>
                    {classes.map((cls) => (
                      <SelectItem
                        key={cls.id}
                        value={cls.id}
                        label={formatClassName(cls)}
                      >
                        {formatClassName(cls)}
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
                  items={[
                    { value: "__none__", label: "All exams" },
                    ...examTypes.map((et) => ({
                      value: et.id,
                      label: et.name,
                    })),
                  ]}
                  onValueChange={(val) => {
                    if (!val) return;
                    setSelectedExamTypeId(val === "__none__" ? "" : val);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select exam type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" label="All exams">
                      All exams
                    </SelectItem>
                    {examTypes.map((et) => (
                      <SelectItem key={et.id} value={et.id} label={et.name}>
                        {et.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="relative mt-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  selectedClassId
                    ? "Filter by name or admission number…"
                    : "Type at least 2 characters of name or admission number…"
                }
                className="pl-9"
                autoFocus
              />
            </div>

            {loadingStudents ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-gold-500" />
              </div>
            ) : !selectedClassId && query.trim().length < 2 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                {allStudents.length} students loaded. Pick a class to browse,
                or type 2+ characters to search across all classes.
              </p>
            ) : matches.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-4 py-2">
                {selectedClassId
                  ? query.trim()
                    ? `No students in this class match "${query}".`
                    : "No students enrolled in this class."
                  : `No students match "${query}".`}
              </p>
            ) : (
              <div className="mt-4 rounded-md border border-gray-200 dark:border-border overflow-hidden">
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {matches.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedStudentId(s.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-navy-900 dark:text-white truncate">
                            {s.full_name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {s.admission_no}
                            {!selectedClassId && s.class_label
                              ? ` · ${s.class_label}`
                              : ""}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ) : loadingDetail || !detail ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-gold-500" />
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Editing results for
                  </div>
                  <div className="font-heading text-xl font-bold text-navy-900 dark:text-white mt-1">
                    {detail.student.full_name}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {detail.student.admission_no}
                    {detail.primary_class
                      ? ` · ${classLabel(
                          detail.primary_class.name,
                          detail.primary_class.section,
                          detail.primary_class.stream
                        )}`
                      : ""}
                    {!detail.student.is_active ? " · inactive" : ""}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Pick a different student
                </Button>
              </div>
            </CardContent>
          </Card>

          {detail.exams.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  This student has no recorded results yet. Use the regular
                  marks-entry workflow on{" "}
                  <Link
                    href="/exams/marks-entry"
                    className="text-blue-600 dark:text-blue-400 underline"
                  >
                    Marks Entry
                  </Link>{" "}
                  to add marks.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {detail.exams.map((ex) => (
                <ExamCard
                  key={ex.exam_type_id}
                  exam={ex}
                  studentId={detail.student.id}
                  isOpen={openExamId === ex.exam_type_id}
                  onToggle={() =>
                    setOpenExamId(
                      openExamId === ex.exam_type_id ? null : ex.exam_type_id
                    )
                  }
                  onChanged={() => void fetchDetail(detail.student.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminResultsEditPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-gold-500" />
        </div>
      }
    >
      <AdminResultsEditPageInner />
    </Suspense>
  );
}

interface ExamCardProps {
  exam: ExamGroup;
  studentId: string;
  isOpen: boolean;
  onToggle: () => void;
  onChanged: () => void;
}

function ExamCard({ exam, studentId, isOpen, onToggle, onChanged }: ExamCardProps) {
  const publishedCount = exam.subjects.filter((s) => s.is_published).length;
  const totalCount = exam.subjects.length;
  const allPublished = totalCount > 0 && publishedCount === totalCount;

  // Subjects in the class roster that don't yet have a result row for this
  // exam — admin can add them.
  const missingSubjects = useMemo(() => {
    const have = new Set(exam.subjects.map((s) => s.subject_id));
    return exam.subject_roster.filter((s) => !have.has(s.subject_id));
  }, [exam.subjects, exam.subject_roster]);

  const [unlockingExam, setUnlockingExam] = useState(false);

  async function unlockExam() {
    if (!confirm("Unlock all of this student's published rows for this exam? They will be hidden from the parent/student portal until you re-publish from the Publish & Finalize page.")) {
      return;
    }
    setUnlockingExam(true);
    try {
      const res = await adminPatch("/api/results/by-student", {
        scope: "exam",
        student_id: studentId,
        exam_type_id: exam.exam_type_id,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to unlock");
        return;
      }
      toast.success(`Unlocked ${body.affected} row(s)`);
      onChanged();
    } finally {
      setUnlockingExam(false);
    }
  }

  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-navy-900 dark:text-white truncate">
              {exam.exam_name}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {classLabel(exam.class_name, exam.class_section, exam.class_stream)} ·{" "}
              {totalCount} subject{totalCount === 1 ? "" : "s"} · max {exam.exam_max_marks}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {allPublished ? (
            <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
              <Lock className="h-3 w-3 mr-1" />
              Published
            </Badge>
          ) : publishedCount > 0 ? (
            <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
              {publishedCount}/{totalCount} published
            </Badge>
          ) : (
            <Badge variant="outline">Draft</Badge>
          )}
        </div>
      </button>

      {isOpen ? (
        <CardContent className="pt-0">
          {publishedCount > 0 ? (
            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/20 p-3 mb-4 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <div className="font-medium">
                    {publishedCount} row{publishedCount === 1 ? "" : "s"} published
                  </div>
                  <div>
                    Published rows are locked. Unlock to edit; the published
                    marksheet will become inconsistent until you re-publish from{" "}
                    <Link
                      href="/exams/publish"
                      className="underline"
                    >
                      Publish &amp; Finalize
                    </Link>
                    .
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={unlockExam}
                disabled={unlockingExam}
                className="shrink-0"
              >
                {unlockingExam ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Unlock className="h-3.5 w-3.5 mr-1.5" />
                )}
                Unlock all in this exam
              </Button>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-32 text-right">Obtained</TableHead>
                  <TableHead className="w-24 text-right">Max</TableHead>
                  <TableHead className="w-20 text-center">Grade</TableHead>
                  <TableHead className="w-44 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exam.subjects.map((row) => (
                  <SubjectRow
                    key={row.id}
                    row={row}
                    studentId={studentId}
                    classId={exam.class_id}
                    examTypeId={exam.exam_type_id}
                    examMaxMarks={exam.exam_max_marks}
                    onChanged={onChanged}
                  />
                ))}
                {missingSubjects.map((s) => (
                  <MissingSubjectRow
                    key={s.subject_id}
                    rosterEntry={s}
                    studentId={studentId}
                    classId={exam.class_id}
                    examTypeId={exam.exam_type_id}
                    examMaxMarks={exam.exam_max_marks}
                    onChanged={onChanged}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

interface SubjectRowProps {
  row: SubjectResult;
  studentId: string;
  classId: string;
  examTypeId: string;
  examMaxMarks: number;
  onChanged: () => void;
}

function SubjectRow({
  row,
  studentId,
  classId,
  examTypeId,
  examMaxMarks,
  onChanged,
}: SubjectRowProps) {
  const [marks, setMarks] = useState(String(row.marks_obtained));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Re-sync if parent reloads.
  useEffect(() => {
    setMarks(String(row.marks_obtained));
  }, [row.marks_obtained]);

  const dirty = marks !== String(row.marks_obtained);

  async function save() {
    const value = Number(marks);
    if (Number.isNaN(value) || value < 0) {
      toast.error("Marks must be a non-negative number");
      return;
    }
    if (value > row.max_marks) {
      toast.error(`Marks cannot exceed ${row.max_marks}`);
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch("/api/results/by-student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          class_id: classId,
          subject_id: row.subject_id,
          exam_type_id: examTypeId,
          marks_obtained: value,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save");
        return;
      }
      toast.success("Saved");
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${row.subject_name} mark for this student?`)) return;
    setDeleting(true);
    try {
      const res = await adminFetch(
        `/api/results/by-student?id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to delete");
        return;
      }
      toast.success("Deleted");
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  async function unlock() {
    setUnlocking(true);
    try {
      const res = await adminPatch("/api/results/by-student", {
        scope: "row",
        result_id: row.id,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to unlock");
        return;
      }
      toast.success("Unlocked");
      onChanged();
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-navy-900 dark:text-white">
          {row.subject_name}
        </div>
        {row.subject_code ? (
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {row.subject_code}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <Input
          type="number"
          min={0}
          max={row.max_marks}
          step="0.5"
          className="h-8 text-xs text-right"
          value={marks}
          onChange={(e) => setMarks(e.target.value)}
          disabled={row.is_published || saving}
        />
      </TableCell>
      <TableCell className="text-right text-sm text-gray-600 dark:text-gray-300">
        {row.max_marks}
        {row.max_marks !== examMaxMarks ? (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">
            (exam max {examMaxMarks})
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-center">
        {row.grade ? (
          <Badge variant="outline">{row.grade}</Badge>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          {row.is_published ? (
            <Button
              size="sm"
              variant="outline"
              onClick={unlock}
              disabled={unlocking}
            >
              {unlocking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">Unlock</span>
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={save}
                disabled={!dirty || saving}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">Save</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={remove}
                disabled={deleting}
                className="text-red-600 hover:text-red-700"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

interface MissingSubjectRowProps {
  rosterEntry: SubjectRosterEntry;
  studentId: string;
  classId: string;
  examTypeId: string;
  examMaxMarks: number;
  onChanged: () => void;
}

function MissingSubjectRow({
  rosterEntry,
  studentId,
  classId,
  examTypeId,
  examMaxMarks,
  onChanged,
}: MissingSubjectRowProps) {
  const [marks, setMarks] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    const value = Number(marks);
    if (Number.isNaN(value) || value < 0) {
      toast.error("Marks must be a non-negative number");
      return;
    }
    if (value > examMaxMarks) {
      toast.error(`Marks cannot exceed ${examMaxMarks}`);
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch("/api/results/by-student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          class_id: classId,
          subject_id: rosterEntry.subject_id,
          exam_type_id: examTypeId,
          marks_obtained: value,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to add");
        return;
      }
      toast.success("Added");
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow className="bg-gray-50/60 dark:bg-gray-900/20">
      <TableCell>
        <div className="font-medium text-gray-700 dark:text-gray-300">
          {rosterEntry.subject_name}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          {rosterEntry.subject_code ? `${rosterEntry.subject_code} · ` : ""}
          missing — add marks
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Input
          type="number"
          min={0}
          max={examMaxMarks}
          step="0.5"
          className="h-8 text-xs text-right"
          value={marks}
          onChange={(e) => setMarks(e.target.value)}
          placeholder="—"
        />
      </TableCell>
      <TableCell className="text-right text-sm text-gray-600 dark:text-gray-300">
        {examMaxMarks}
      </TableCell>
      <TableCell className="text-center">
        <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          onClick={add}
          disabled={marks === "" || saving}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">Add</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}
