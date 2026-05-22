"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import {
  Save,
  Loader2,
  MessageSquare,
  Calendar as CalendarIcon,
  FileDown,
  Upload,
} from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType } from "@nkps/shared/types";
import { PtmImportDialog } from "@/components/PtmImportDialog";

interface EnrolledStudent {
  student_id: string;
  roll_number: number | null;
  admission_no: string;
  full_name: string;
}

interface RowEntry {
  attendance: "present" | "absent";
  teacher_remarks: string;
  parent_remarks: string;
  action_points: string;
  // server ids to know whether we're updating an existing row (informational)
  existing_id: string | null;
}

type EntriesMap = Record<string, RowEntry>; // by student_id

type OrderBy = "roll" | "name" | "admission_no";

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function PtmNotesWorkbench({
  scope,
}: {
  scope: "teacher" | "admin";
}) {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [entries, setEntries] = useState<EntriesMap>({});

  const [classId, setClassId] = useState("");
  const [examTypeId, setExamTypeId] = useState<string>("__none__");
  const [meetingDate, setMeetingDate] = useState<string>(todayLocal());
  const [orderBy, setOrderBy] = useState<OrderBy>("roll");

  const [academicYearId, setAcademicYearId] = useState<string>("");
  const [totalSchoolMeetings, setTotalSchoolMeetings] = useState<string>("");
  const [savingCounter, setSavingCounter] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [saving, setSaving] = useState(false);

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
        .select("teacher_id, role")
        .eq("id", user.id)
        .single();
      const tid = profile?.teacher_id as string | undefined;

      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();
      if (currentYear) setAcademicYearId(currentYear.id as string);

      // Scope-dependent class fetch:
      //  - "teacher": only classes where this teacher has a subject assignment
      //  - "admin": every class in the current academic year
      if (scope === "teacher") {
        if (!tid) {
          setLoading(false);
          return;
        }
        const { data: classSubjects } = await supabase
          .from("class_subjects")
          .select(
            "class_id, classes(id, name, section, academic_year_id, sort_order, streams:stream_id(name))"
          )
          .eq("teacher_id", tid);
        const uniq = new Map<string, Class>();
        for (const cs of classSubjects ?? []) {
          const cls = cs.classes as unknown as Class;
          if (cls && !uniq.has(cls.id)) uniq.set(cls.id, cls);
        }
        setClasses(
          Array.from(uniq.values()).sort(
            (a, b) => a.sort_order - b.sort_order
          )
        );
      } else if (currentYear) {
        const { data: allClasses } = await supabase
          .from("classes")
          .select(
            "id, name, section, academic_year_id, sort_order, streams:stream_id(name)"
          )
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        setClasses((allClasses ?? []) as unknown as Class[]);
      }

      if (currentYear) {
        const { data: examTypesData } = await supabase
          .from("exam_types")
          .select("*")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        if (examTypesData) setExamTypes(examTypesData as ExamType[]);
      }

      setLoading(false);
    }
    bootstrap();
  }, [scope]);

  const fetchGrid = useCallback(async () => {
    if (!classId || !meetingDate) {
      setStudents([]);
      setEntries({});
      return;
    }
    setLoadingGrid(true);
    const supabase = createClient();

    const { data: enrollments } = await supabase
      .from("student_enrollments")
      .select(
        "student_id, roll_number, students(id, full_name, admission_no)"
      )
      .eq("class_id", classId)
      .eq("status", "active");

    const rows: EnrolledStudent[] = (enrollments ?? []).map((e) => {
      const s = e.students as unknown as {
        id: string;
        full_name: string;
        admission_no: string;
      } | null;
      return {
        student_id: s?.id ?? (e.student_id as string),
        roll_number: (e.roll_number as number | null) ?? null,
        admission_no: s?.admission_no ?? "",
        full_name: s?.full_name ?? "",
      };
    });
    setStudents(rows);

    const { data: notes } = await supabase
      .from("ptm_notes")
      .select(
        "id, student_id, attendance, teacher_remarks, parent_remarks, action_points"
      )
      .eq("meeting_date", meetingDate)
      .in(
        "student_id",
        rows.length > 0 ? rows.map((r) => r.student_id) : ["__none__"]
      );

    const map: EntriesMap = {};
    for (const r of rows) {
      const existing = notes?.find((n) => n.student_id === r.student_id);
      map[r.student_id] = {
        attendance: (existing?.attendance as "present" | "absent") ?? "present",
        teacher_remarks: (existing?.teacher_remarks as string | null) ?? "",
        parent_remarks: (existing?.parent_remarks as string | null) ?? "",
        action_points: (existing?.action_points as string | null) ?? "",
        existing_id: (existing?.id as string | null) ?? null,
      };
    }
    setEntries(map);
    setLoadingGrid(false);
  }, [classId, meetingDate]);

  useEffect(() => {
    void fetchGrid();
  }, [fetchGrid]);

  // Load current total_school_meetings counter for the active scope.
  const counterScopeKey = useMemo(
    () => `${academicYearId}|${examTypeId}|${classId}`,
    [academicYearId, examTypeId, classId]
  );

  useEffect(() => {
    if (!academicYearId || !classId) {
      setTotalSchoolMeetings("");
      return;
    }
    let cancelled = false;
    async function load() {
      const examParam = examTypeId === "__none__" ? "null" : examTypeId;
      const url = `/api/school-meeting-counts?academic_year_id=${encodeURIComponent(
        academicYearId
      )}&exam_type_id=${encodeURIComponent(examParam)}&class_id=${encodeURIComponent(classId)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const body = (await res.json()) as {
        data: Array<{ total_meetings: number }>;
      };
      if (cancelled) return;
      const first = body.data[0];
      setTotalSchoolMeetings(
        first ? String(first.total_meetings) : ""
      );
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [counterScopeKey, academicYearId, classId, examTypeId]);

  const orderedStudents = useMemo(() => {
    const copy = [...students];
    switch (orderBy) {
      case "name":
        copy.sort((a, b) => a.full_name.localeCompare(b.full_name));
        break;
      case "admission_no":
        copy.sort((a, b) => a.admission_no.localeCompare(b.admission_no));
        break;
      case "roll":
      default:
        copy.sort((a, b) => {
          const ra = a.roll_number ?? Number.POSITIVE_INFINITY;
          const rb = b.roll_number ?? Number.POSITIVE_INFINITY;
          return ra - rb;
        });
        break;
    }
    return copy;
  }, [students, orderBy]);

  function updateEntry(studentId: string, patch: Partial<RowEntry>) {
    setEntries((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] ?? {
          attendance: "present",
          teacher_remarks: "",
          parent_remarks: "",
          action_points: "",
          existing_id: null,
        }),
        ...patch,
      },
    }));
  }

  async function handleSave() {
    if (!classId || !meetingDate) return;
    setSaving(true);
    try {
      const entriesPayload = students.map((s) => {
        const e = entries[s.student_id] ?? {
          attendance: "present" as const,
          teacher_remarks: "",
          parent_remarks: "",
          action_points: "",
          existing_id: null,
        };
        return {
          student_id: s.student_id,
          meeting_date: meetingDate,
          attendance: e.attendance,
          teacher_remarks: e.teacher_remarks.trim() || null,
          parent_remarks: e.parent_remarks.trim() || null,
          action_points: e.action_points.trim() || null,
        };
      });
      const body = {
        exam_type_id: examTypeId === "__none__" ? null : examTypeId,
        entries: entriesPayload,
      };
      const res = await fetch("/api/ptm-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error ?? "Failed to save");
        return;
      }
      toast.success("Meeting notes saved");
      void fetchGrid();
    } finally {
      setSaving(false);
    }
  }

  async function saveCounter() {
    if (!academicYearId || !classId) return;
    const val = Number.parseInt(totalSchoolMeetings, 10);
    if (Number.isNaN(val) || val < 0) {
      toast.error("Total meetings must be a non-negative whole number");
      return;
    }
    setSavingCounter(true);
    try {
      const res = await fetch("/api/school-meeting-counts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academic_year_id: academicYearId,
          exam_type_id: examTypeId === "__none__" ? null : examTypeId,
          class_id: classId,
          total_meetings: val,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to save counter");
        return;
      }
      toast.success("Meeting counter updated");
    } finally {
      setSavingCounter(false);
    }
  }

  async function downloadReport() {
    if (!classId) return;
    const qs = new URLSearchParams({ class_id: classId });
    if (examTypeId !== "__none__") qs.set("exam_type_id", examTypeId);
    const res = await fetch(`/api/ptm-notes/report?${qs.toString()}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to generate report");
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ptm-notes-report.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-gold-500" />
      </div>
    );
  }

  const canEdit = Boolean(classId && meetingDate);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Parent-Teacher Meetings
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Record attendance, teacher remarks, parent remarks, and action
          points from each PTM. One entry per student per meeting date.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-navy-900 dark:text-gold-500" />
            Scope
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
              <label className="text-sm font-medium mb-1.5 block">Exam</label>
              <Select
                value={examTypeId}
                onValueChange={(v) => setExamTypeId(v ?? "__none__")}
                items={[
                  { value: "__none__", label: "(Not tied to an exam)" },
                  ...examTypes.map((e) => ({ value: e.id, label: e.name })),
                ]}
              >
                <SelectTrigger>
                  <SelectValue placeholder="(Not tied to an exam)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" label="(Not tied to an exam)">
                    (Not tied to an exam)
                  </SelectItem>
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
                Meeting date
              </label>
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-gray-500" />
                <Input
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Order by
              </label>
              <Select
                value={orderBy}
                onValueChange={(v) => setOrderBy((v as OrderBy) ?? "roll")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="roll">Roll Number</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="admission_no">Admission No.</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-800 flex flex-wrap items-end gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Total School Meetings
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  className="w-32"
                  value={totalSchoolMeetings}
                  onChange={(e) => setTotalSchoolMeetings(e.target.value)}
                  disabled={!academicYearId || !classId}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveCounter}
                  disabled={
                    !academicYearId ||
                    !classId ||
                    savingCounter ||
                    totalSchoolMeetings === ""
                  }
                >
                  {savingCounter ? "Saving…" : "Save counter"}
                </Button>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Per year + class (+ exam when chosen).
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <PtmImportDialog
                classId={classId || undefined}
                examTypeId={
                  examTypeId === "__none__" ? undefined : examTypeId
                }
                onImported={() => void fetchGrid()}
                triggerLabel="Import CSV"
                disabled={!classId}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={downloadReport}
                disabled={!classId}
              >
                <FileDown className="h-4 w-4 mr-2" />
                Report PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-navy-900 dark:text-gold-500" />
              {meetingDate} · {orderedStudents.length} students
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingGrid ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-gold-500" />
              </div>
            ) : orderedStudents.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
                No active students in this class.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Roll</TableHead>
                        <TableHead className="w-[220px]">Student</TableHead>
                        <TableHead className="w-28">Attendance</TableHead>
                        <TableHead>Teacher remarks</TableHead>
                        <TableHead>Parent remarks</TableHead>
                        <TableHead>Action points</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderedStudents.map((s) => {
                        const e = entries[s.student_id] ?? {
                          attendance: "present" as const,
                          teacher_remarks: "",
                          parent_remarks: "",
                          action_points: "",
                          existing_id: null,
                        };
                        return (
                          <TableRow key={s.student_id}>
                            <TableCell className="font-medium">
                              {s.roll_number ?? "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span>{s.full_name}</span>
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                  {s.admission_no}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={e.attendance}
                                onValueChange={(v) =>
                                  updateEntry(s.student_id, {
                                    attendance:
                                      (v as "present" | "absent") ??
                                      "present",
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="present">
                                    Present
                                  </SelectItem>
                                  <SelectItem value="absent">Absent</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <textarea
                                rows={2}
                                className="w-full min-h-[52px] rounded-md border border-gray-200 dark:border-border bg-white dark:bg-muted px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gold-500 resize-y"
                                value={e.teacher_remarks}
                                onChange={(ev) =>
                                  updateEntry(s.student_id, {
                                    teacher_remarks: ev.target.value,
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <textarea
                                rows={2}
                                className="w-full min-h-[52px] rounded-md border border-gray-200 dark:border-border bg-white dark:bg-muted px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gold-500 resize-y"
                                value={e.parent_remarks}
                                onChange={(ev) =>
                                  updateEntry(s.student_id, {
                                    parent_remarks: ev.target.value,
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <textarea
                                rows={2}
                                className="w-full min-h-[52px] rounded-md border border-gray-200 dark:border-border bg-white dark:bg-muted px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gold-500 resize-y"
                                value={e.action_points}
                                onChange={(ev) =>
                                  updateEntry(s.student_id, {
                                    action_points: ev.target.value,
                                  })
                                }
                              />
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
                    {saving ? "Saving…" : "Save meeting"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
