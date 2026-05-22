"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch, adminPatch, adminDelete } from "@nkps/shared/lib/admin-api";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
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
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType, Subject } from "@nkps/shared/types";

interface ExamSchedule {
  id: string;
  exam_type_id: string;
  class_id: string;
  subject_id: string;
  exam_date: string;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  invigilator_teacher_id: string | null;
  sort_order: number;
  notes: string | null;
  subjects?: { id: string; name: string; code: string | null };
}

interface FormState {
  subject_id: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  room: string;
  notes: string;
}

const emptyForm: FormState = {
  subject_id: "",
  exam_date: "",
  start_time: "",
  end_time: "",
  room: "",
  notes: "",
};

export default function TimetablePage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [classSubjects, setClassSubjects] = useState<Subject[]>([]);
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [selectedExamTypeId, setSelectedExamTypeId] = useUrlState("exam_type_id");
  const [loading, setLoading] = useState(true);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExamSchedule | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<ExamSchedule | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchInitial = useCallback(async () => {
    const supabase = createClient();
    const { data: current } = await supabase
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    if (!current) return;

    const [classesRes, examsRes, subjectsRes] = await Promise.all([
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
      supabase
        .from("subjects")
        .select("id, name, code, is_active, is_elective")
        .eq("is_active", true)
        .order("name", { ascending: true }),
    ]);
    setClasses(classesRes.data ?? []);
    setExamTypes((examsRes.data as ExamType[]) ?? []);
    setAllSubjects((subjectsRes.data as Subject[]) ?? []);
  }, []);

  const fetchSchedules = useCallback(async () => {
    if (!selectedClassId || !selectedExamTypeId) {
      setSchedules([]);
      return;
    }
    setLoadingSchedules(true);
    const res = await adminFetch(
      `/api/exam-schedules?exam_type_id=${selectedExamTypeId}&class_id=${selectedClassId}`
    );
    if (res.ok) {
      const { data } = (await res.json()) as { data: ExamSchedule[] };
      setSchedules(data);
    } else {
      toast.error("Failed to load exam schedule");
    }
    setLoadingSchedules(false);
  }, [selectedClassId, selectedExamTypeId]);

  const fetchClassSubjects = useCallback(async () => {
    if (!selectedClassId) {
      setClassSubjects([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("class_subjects")
      .select("subjects(id, name, code, is_active, is_elective)")
      .eq("class_id", selectedClassId);
    if (data) {
      const subs = data
        .map((cs) => cs.subjects as unknown as Subject)
        .filter(Boolean);
      setClassSubjects(subs);
    }
  }, [selectedClassId]);

  useEffect(() => {
    fetchInitial().finally(() => setLoading(false));
  }, [fetchInitial]);

  useEffect(() => {
    fetchSchedules();
    fetchClassSubjects();
  }, [fetchSchedules, fetchClassSubjects]);

  const usedSubjectIds = useMemo(
    () => new Set(schedules.map((s) => s.subject_id)),
    [schedules]
  );

  // Subjects we can still add = class subjects minus ones already scheduled.
  const availableSubjectsForAdd = useMemo(() => {
    return classSubjects.filter((s) => !usedSubjectIds.has(s.id));
  }, [classSubjects, usedSubjectIds]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      subject_id: availableSubjectsForAdd[0]?.id ?? "",
    });
    setDialogOpen(true);
  };

  const openEdit = (s: ExamSchedule) => {
    setEditing(s);
    setForm({
      subject_id: s.subject_id,
      exam_date: s.exam_date,
      start_time: s.start_time?.slice(0, 5) ?? "",
      end_time: s.end_time?.slice(0, 5) ?? "",
      room: s.room ?? "",
      notes: s.notes ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.subject_id) {
      toast.error("Pick a subject.");
      return;
    }
    if (!form.exam_date) {
      toast.error("Exam date is required.");
      return;
    }
    if (form.start_time && form.end_time && form.end_time <= form.start_time) {
      toast.error("End time must be after start time.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        exam_type_id: selectedExamTypeId,
        class_id: selectedClassId,
        subject_id: form.subject_id,
        exam_date: form.exam_date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        room: form.room.trim() || null,
        notes: form.notes.trim() || null,
      };
      const res = editing
        ? await adminPatch(`/api/exam-schedules/${editing.id}`, payload)
        : await adminFetch("/api/exam-schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save");
        return;
      }
      toast.success(editing ? "Schedule updated" : "Schedule added");
      setDialogOpen(false);
      await fetchSchedules();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await adminDelete(
      `/api/exam-schedules/${deleteTarget.id}`,
      {}
    );
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error ?? "Failed to delete");
      return;
    }
    toast.success("Schedule deleted");
    setDeleteTarget(null);
    await fetchSchedules();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const subjectNameById = new Map(allSubjects.map((s) => [s.id, s]));
  const canAdd =
    selectedClassId && selectedExamTypeId && availableSubjectsForAdd.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Exam Timetable
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Set the date, time, and room for each subject&apos;s paper per class
          and exam. Admit cards embed this schedule automatically.
        </p>
      </div>

      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </CardContent>
      </Card>

      {selectedClassId && selectedExamTypeId ? (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-gray-500">
                {schedules.length} subject
                {schedules.length === 1 ? "" : "s"} scheduled
              </div>
              <Button
                onClick={openCreate}
                disabled={!canAdd}
                className="bg-navy-900 text-white hover:bg-navy-900/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add subject
              </Button>
            </div>

            {!canAdd && availableSubjectsForAdd.length === 0 && schedules.length > 0 && (
              <p className="text-xs text-gray-500 mb-3">
                All class subjects have been scheduled for this exam.
              </p>
            )}

            {loadingSchedules ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : schedules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
                <CalendarClock className="h-8 w-8 mx-auto mb-3 text-gray-400" />
                <p className="text-sm text-gray-500">
                  No subjects scheduled yet for this class + exam.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead className="w-32">Date</TableHead>
                    <TableHead className="w-36">Time</TableHead>
                    <TableHead className="w-24">Room</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((s) => {
                    const subject =
                      s.subjects ?? subjectNameById.get(s.subject_id);
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {subject?.name ?? "—"}
                          {subject?.code && (
                            <span className="text-xs text-gray-500 ml-1">
                              ({subject.code})
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {new Date(s.exam_date).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">
                          {s.start_time && s.end_time
                            ? `${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}`
                            : s.start_time
                            ? s.start_time.slice(0, 5)
                            : "—"}
                        </TableCell>
                        <TableCell>{s.room ?? "—"}</TableCell>
                        <TableCell className="text-xs text-gray-500 max-w-[240px] truncate">
                          {s.notes ?? ""}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(s)}
                              aria-label="Edit timetable slot"
                              className="h-7 w-7 text-blue-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteTarget(s)}
                              aria-label="Delete timetable slot"
                              className="h-7 w-7 text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <p className="text-sm text-gray-500">
            Pick an exam and class to view or edit its schedule.
          </p>
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Schedule Entry" : "Add Schedule Entry"}
            </DialogTitle>
            <DialogDescription>
              Date, time, and room for a subject&apos;s paper in this class.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Subject</Label>
              <Select
                value={form.subject_id}
                items={(editing
                  ? classSubjects
                  : availableSubjectsForAdd
                ).map((s) => ({ value: s.id, label: s.name }))}
                onValueChange={(v) => v && setForm({ ...form, subject_id: v })}
                disabled={Boolean(editing)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick subject" />
                </SelectTrigger>
                <SelectContent>
                  {(editing ? classSubjects : availableSubjectsForAdd).map(
                    (s) => (
                      <SelectItem key={s.id} value={s.id} label={s.name}>
                        {s.name}
                        {s.code ? ` (${s.code})` : ""}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
              {editing && (
                <p className="text-[10px] text-gray-500">
                  To assign a different subject, delete this entry and create a
                  new one.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.exam_date}
                onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start time</Label>
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) =>
                    setForm({ ...form, start_time: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>End time</Label>
                <Input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Room (optional)</Label>
              <Input
                value={form.room}
                onChange={(e) => setForm({ ...form, room: e.target.value })}
                placeholder="e.g. Hall A"
              />
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Bring scientific calculator"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      {deleteTarget && (
        <Dialog
          open={true}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Remove schedule entry?
              </DialogTitle>
              <DialogDescription>
                This removes the scheduled date/time for this subject. Marks
                entry for this subject is not affected.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDelete}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
