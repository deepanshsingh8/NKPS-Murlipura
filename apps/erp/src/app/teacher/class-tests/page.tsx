"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Plus,
  Save,
  Loader2,
  Pencil,
  Trash2,
  ArrowLeft,
  Eye,
  EyeOff,
  ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";
import { formatClassName } from "@nkps/shared/lib/utils";
import { computeGrade, type GradeBand } from "@/lib/grading";
import type { Class, Subject } from "@nkps/shared/types";

interface ClassTest {
  id: string;
  class_id: string;
  subject_id: string;
  name: string;
  test_date: string | null;
  max_marks: number;
  weightage: number | null;
  is_published: boolean;
}

interface EnrolledStudent {
  student_id: string;
  roll_number: number | null;
  full_name: string;
}

interface MarksEntry {
  student_id: string;
  marks_obtained: number | "";
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

export default function TeacherClassTestsPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tests, setTests] = useState<ClassTest[]>([]);

  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [selectedSubjectId, setSelectedSubjectId] = useUrlState("subject_id");

  const [loading, setLoading] = useState(true);
  const [loadingTests, setLoadingTests] = useState(false);

  const [mode, setMode] = useState<"list" | "entry">("list");
  const [activeTest, setActiveTest] = useState<ClassTest | null>(null);

  // Create/edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTest, setEditingTest] = useState<ClassTest | null>(null);
  const [form, setForm] = useState({
    name: "",
    test_date: "",
    max_marks: "20",
    weightage: "",
  });
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingTest, setDeletingTest] = useState<ClassTest | null>(null);

  // Marks entry state
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [marksEntries, setMarksEntries] = useState<MarksEntry[]>([]);
  const [gradeBands, setGradeBands] = useState<GradeBand[]>([]);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [savingMarks, setSavingMarks] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("teacher_id")
        .eq("id", user.id)
        .single();

      const tid = profile?.teacher_id as string | undefined;
      if (!tid) {
        setLoading(false);
        return;
      }

      const { data: classSubjects } = await supabase
        .from("class_subjects")
        .select(
          "class_id, subject_id, classes(id, name, section, academic_year_id, sort_order, streams:stream_id(name)), subjects(id, name, code, is_active)"
        )
        .eq("teacher_id", tid);

      const uniqueClasses = new Map<string, Class>();
      for (const cs of classSubjects ?? []) {
        const cls = cs.classes as unknown as Class;
        if (cls && !uniqueClasses.has(cls.id)) uniqueClasses.set(cls.id, cls);
      }
      setClasses(
        Array.from(uniqueClasses.values()).sort(
          (a, b) => a.sort_order - b.sort_order
        )
      );

      setLoading(false);
    }
    bootstrap();
  }, []);

  // Fetch subjects for the selected class (restricted to this teacher's
  // class-subject assignments).
  useEffect(() => {
    if (!selectedClassId) {
      setSubjects([]);
      setSelectedSubjectId("");
      return;
    }
    let cancelled = false;
    async function fetch() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("teacher_id")
        .eq("id", user.id)
        .single();
      const tid = profile?.teacher_id as string | undefined;
      if (!tid) return;
      const { data } = await supabase
        .from("class_subjects")
        .select("subject_id, subjects(id, name, code, is_active)")
        .eq("class_id", selectedClassId)
        .eq("teacher_id", tid);
      if (cancelled) return;
      const subs = (data ?? [])
        .map((r) => r.subjects as unknown as Subject)
        .filter(Boolean);
      setSubjects(subs);
    }
    fetch();
    return () => {
      cancelled = true;
    };
  }, [selectedClassId]);

  // Fetch grade bands for the selected class (used by the marks grid).
  useEffect(() => {
    if (!selectedClassId) {
      setGradeBands([]);
      return;
    }
    async function fetch() {
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
    fetch();
  }, [selectedClassId]);

  const fetchTests = useCallback(async () => {
    if (!selectedClassId || !selectedSubjectId) {
      setTests([]);
      return;
    }
    setLoadingTests(true);
    try {
      const res = await fetch(
        `/api/class-tests?class_id=${selectedClassId}&subject_id=${selectedSubjectId}`
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to load class tests");
        return;
      }
      setTests((data.data ?? []) as ClassTest[]);
    } finally {
      setLoadingTests(false);
    }
  }, [selectedClassId, selectedSubjectId]);

  useEffect(() => {
    fetchTests();
  }, [fetchTests]);

  // ── Create / Edit dialog ───────────────────────────────────────────────────
  function openCreateDialog() {
    setEditingTest(null);
    setForm({ name: "", test_date: "", max_marks: "20", weightage: "" });
    setDialogOpen(true);
  }
  function openEditDialog(test: ClassTest) {
    setEditingTest(test);
    setForm({
      name: test.name,
      test_date: test.test_date ?? "",
      max_marks: String(test.max_marks),
      weightage: test.weightage === null ? "" : String(test.weightage),
    });
    setDialogOpen(true);
  }

  async function submitDialog() {
    if (!selectedClassId || !selectedSubjectId) return;
    const name = form.name.trim();
    const max = Number(form.max_marks);
    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (!Number.isFinite(max) || max <= 0) {
      toast.error("Max marks must be a positive number");
      return;
    }
    const weightage = form.weightage.trim() === "" ? null : Number(form.weightage);
    if (weightage !== null && (!Number.isFinite(weightage) || weightage < 0 || weightage > 100)) {
      toast.error("Weightage must be between 0 and 100");
      return;
    }

    setSaving(true);
    try {
      if (editingTest) {
        const res = await fetch(`/api/class-tests/${editingTest.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            test_date: form.test_date || null,
            max_marks: max,
            weightage,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to update class test");
          return;
        }
        toast.success("Class test updated");
      } else {
        const res = await fetch("/api/class-tests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_id: selectedClassId,
            subject_id: selectedSubjectId,
            name,
            test_date: form.test_date || null,
            max_marks: max,
            weightage,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to create class test");
          return;
        }
        toast.success("Class test created");
      }
      setDialogOpen(false);
      fetchTests();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deletingTest) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/class-tests/${deletingTest.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to delete");
        return;
      }
      toast.success("Class test deleted");
      setDeleteDialogOpen(false);
      setDeletingTest(null);
      fetchTests();
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish(test: ClassTest) {
    const res = await fetch(`/api/class-tests/${test.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_published: !test.is_published }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Failed to toggle publish");
      return;
    }
    toast.success(test.is_published ? "Unpublished" : "Published");
    fetchTests();
  }

  // ── Marks entry ────────────────────────────────────────────────────────────
  async function openMarksEntry(test: ClassTest) {
    setActiveTest(test);
    setMode("entry");
    setLoadingEntry(true);
    try {
      const supabase = createClient();
      const [{ data: enrollments }, marksRes] = await Promise.all([
        supabase
          .from("student_enrollments")
          .select("student_id, roll_number, students(full_name)")
          .eq("class_id", test.class_id)
          .eq("status", "active")
          .order("roll_number", { ascending: true }),
        fetch(`/api/class-tests/${test.id}/marks`),
      ]);
      const marksData = await marksRes.json();
      const enrolled: EnrolledStudent[] = (enrollments ?? []).map((e) => ({
        student_id: e.student_id as string,
        roll_number: (e.roll_number as number | null) ?? null,
        full_name:
          (e.students as unknown as { full_name: string })?.full_name ?? "Unknown",
      }));
      setStudents(enrolled);
      const existingMap = new Map<string, number>();
      for (const r of (marksData.data ?? []) as Array<{
        student_id: string;
        marks_obtained: number;
      }>) {
        existingMap.set(r.student_id, r.marks_obtained);
      }
      setMarksEntries(
        enrolled.map((s) => ({
          student_id: s.student_id,
          marks_obtained: existingMap.get(s.student_id) ?? "",
        }))
      );
    } finally {
      setLoadingEntry(false);
    }
  }

  function handleMarksChange(studentId: string, value: string) {
    const numVal = value === "" ? "" : Number(value);
    setMarksEntries((prev) =>
      prev.map((e) =>
        e.student_id === studentId ? { ...e, marks_obtained: numVal } : e
      )
    );
  }

  const hasInvalidMarks = useMemo(() => {
    if (!activeTest) return false;
    return marksEntries.some((e) => {
      if (e.marks_obtained === "") return false;
      const n = Number(e.marks_obtained);
      return n < 0 || n > activeTest.max_marks;
    });
  }, [marksEntries, activeTest]);

  async function saveMarks() {
    if (!activeTest) return;
    // Send both set and null entries so cleared cells get deleted.
    const entries = marksEntries.map((e) => ({
      student_id: e.student_id,
      marks_obtained: e.marks_obtained === "" ? null : Number(e.marks_obtained),
    }));
    if (entries.length === 0) {
      toast.error("Nothing to save");
      return;
    }
    setSavingMarks(true);
    try {
      const res = await fetch(`/api/class-tests/${activeTest.id}/marks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save marks");
        return;
      }
      toast.success(`Saved ${data.saved ?? 0} · cleared ${data.cleared ?? 0}`);
    } finally {
      setSavingMarks(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // ── Entry mode (marks grid for activeTest) ─────────────────────────────────
  if (mode === "entry" && activeTest) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setMode("list");
                setActiveTest(null);
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back
            </Button>
            <h1 className="mt-1 font-heading text-2xl font-bold text-navy-900 dark:text-white">
              {activeTest.name}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Max marks: {activeTest.max_marks} · {formatDateShort(activeTest.test_date)}
              {activeTest.weightage !== null && ` · Weightage: ${activeTest.weightage}%`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button
              onClick={saveMarks}
              disabled={savingMarks || hasInvalidMarks}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {savingMarks ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Marks
            </Button>
            {hasInvalidMarks && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                Fix marks exceeding {activeTest.max_marks} to save
              </span>
            )}
          </div>
        </div>

        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardContent className="pt-6">
            {loadingEntry ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : students.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 py-12">
                No active enrollments for this class.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Roll</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead className="w-32">Marks</TableHead>
                      <TableHead className="w-24">Grade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((student) => {
                      const entry = marksEntries.find(
                        (e) => e.student_id === student.student_id
                      );
                      const value = entry?.marks_obtained ?? "";
                      const marks = value === "" ? null : Number(value);
                      const isInvalid =
                        marks !== null &&
                        (marks < 0 || marks > activeTest.max_marks);
                      const grade =
                        marks !== null && !isInvalid
                          ? computeGrade(
                              (marks / activeTest.max_marks) * 100,
                              gradeBands
                            )
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
                              max={activeTest.max_marks}
                              value={value}
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
                                &gt; {activeTest.max_marks}
                              </span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-500">
                                --
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── List mode ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Class Tests
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Quick unit tests and formative assessments for your class-subject
          combos.
        </p>
      </div>

      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-900 dark:text-white">
                Class
              </label>
              <Select
                value={selectedClassId}
                items={classes.map((cls) => ({
                  value: cls.id,
                  label: formatClassName(cls),
                }))}
                onValueChange={(v) => v && setSelectedClassId(v)}
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
                items={subjects.map((s) => ({
                  value: s.id,
                  label: s.name + (s.code ? ` (${s.code})` : ""),
                }))}
                onValueChange={(v) => v && setSelectedSubjectId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem
                      key={s.id}
                      value={s.id}
                      label={s.name + (s.code ? ` (${s.code})` : "")}
                    >
                      {s.name}
                      {s.code ? ` (${s.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedClassId && selectedSubjectId && (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-navy-900 dark:text-white">
              Tests
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                {tests.length} {tests.length === 1 ? "test" : "tests"}
              </span>
            </CardTitle>
            <Button
              type="button"
              onClick={openCreateDialog}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Test
            </Button>
          </CardHeader>
          <CardContent>
            {loadingTests ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : tests.length === 0 ? (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <ClipboardCheck className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No class tests yet for this pair.</p>
                <p className="text-xs mt-1">
                  Click &quot;New Test&quot; to create one.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-32">Date</TableHead>
                      <TableHead className="w-24">Max</TableHead>
                      <TableHead className="w-24">Weight</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-[260px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tests.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                          {formatDateShort(t.test_date)}
                        </TableCell>
                        <TableCell>{t.max_marks}</TableCell>
                        <TableCell>
                          {t.weightage === null ? "—" : `${t.weightage}%`}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              t.is_published
                                ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                                : "text-gray-500 dark:text-gray-400"
                            }
                          >
                            {t.is_published ? "Published" : "Draft"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openMarksEntry(t)}
                            >
                              Enter Marks
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => togglePublish(t)}
                              title={t.is_published ? "Unpublish" : "Publish"}
                            >
                              {t.is_published ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openEditDialog(t)}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                setDeletingTest(t);
                                setDeleteDialogOpen(true);
                              }}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingTest ? "Edit class test" : "New class test"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Unit 1 Test"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={form.test_date}
                  onChange={(e) => setForm({ ...form, test_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Max marks</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.max_marks}
                  onChange={(e) => setForm({ ...form, max_marks: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Weightage (%, optional)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.weightage}
                onChange={(e) => setForm({ ...form, weightage: e.target.value })}
                placeholder="Leave blank if not contributing"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                For later integration into the final result. Not yet consumed by
                the Result Master engine.
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={submitDialog}
              disabled={saving}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {editingTest ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete class test?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {deletingTest
              ? `This will delete "${deletingTest.name}" and all marks recorded for it. This cannot be undone.`
              : ""}
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={confirmDelete}
              disabled={saving}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
