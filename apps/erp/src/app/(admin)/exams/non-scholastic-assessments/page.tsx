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
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { toast } from "sonner";
import { Save, Loader2, Sparkles } from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType } from "@nkps/shared/types";

interface EnrolledStudent {
  student_id: string;
  roll_number: number | null;
  full_name: string;
}

interface ParentSubject {
  id: string;
  name: string;
}

interface SubSubject {
  id: string;
  parent_subject_id: string;
  name: string;
  grade_scale_id: string | null;
}

interface GradeBandLite {
  label: string;
  sort_order: number;
}

type EntriesMap = Record<string, string>;
const cellKey = (studentId: string, subSubjectId: string) =>
  `${studentId}::${subSubjectId}`;

export default function AdminNonScholasticAssessmentsPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [parentSubjects, setParentSubjects] = useState<ParentSubject[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [subSubjects, setSubSubjects] = useState<SubSubject[]>([]);

  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [selectedExamTypeId, setSelectedExamTypeId] = useUrlState("exam_type_id");
  const [selectedParentSubjectId, setSelectedParentSubjectId] = useUrlState("subject_id");

  const [entries, setEntries] = useState<EntriesMap>({});
  const [bandsByScale, setBandsByScale] = useState<Record<string, GradeBandLite[]>>({});
  const [defaultScaleId, setDefaultScaleId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const supabase = createClient();

      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (currentYear?.id) {
        const [{ data: cls }, { data: ets }] = await Promise.all([
          supabase
            .from("classes")
            .select("id, name, section, academic_year_id, sort_order, streams:stream_id(name)")
            .eq("academic_year_id", currentYear.id)
            .order("sort_order", { ascending: true }),
          supabase
            .from("exam_types")
            .select("*")
            .eq("academic_year_id", currentYear.id)
            .order("sort_order", { ascending: true }),
        ]);
        setClasses((cls ?? []) as unknown as Class[]);
        setExamTypes((ets ?? []) as ExamType[]);
      }

      const { data: ps } = await supabase
        .from("non_scholastic_subjects")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      setParentSubjects((ps ?? []) as ParentSubject[]);

      const { data: defScale } = await supabase
        .from("grade_scales")
        .select("id")
        .eq("scope", "non_scholastic")
        .eq("is_default", true)
        .maybeSingle();
      setDefaultScaleId((defScale?.id as string | undefined) ?? null);

      setLoading(false);
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedParentSubjectId) {
      setSubSubjects([]);
      return;
    }
    let cancelled = false;
    async function fetchSubs() {
      const supabase = createClient();
      const { data } = await supabase
        .from("non_scholastic_sub_subjects")
        .select("id, parent_subject_id, name, grade_scale_id")
        .eq("parent_subject_id", selectedParentSubjectId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (cancelled) return;
      const subs = (data ?? []) as SubSubject[];
      setSubSubjects(subs);

      const scaleIds = new Set<string>();
      for (const s of subs) {
        scaleIds.add(s.grade_scale_id ?? (defaultScaleId ?? ""));
      }
      scaleIds.delete("");
      if (scaleIds.size === 0) {
        setBandsByScale({});
        return;
      }
      const { data: bands } = await supabase
        .from("grade_bands")
        .select("grade_scale_id, label, sort_order")
        .in("grade_scale_id", Array.from(scaleIds))
        .order("sort_order", { ascending: true });
      const bs: Record<string, GradeBandLite[]> = {};
      for (const b of bands ?? []) {
        const sid = b.grade_scale_id as string;
        if (!bs[sid]) bs[sid] = [];
        bs[sid].push({ label: b.label as string, sort_order: b.sort_order as number });
      }
      setBandsByScale(bs);
    }
    fetchSubs();
    return () => {
      cancelled = true;
    };
  }, [selectedParentSubjectId, defaultScaleId]);

  const fetchStudentsAndGrid = useCallback(async () => {
    if (!selectedClassId || !selectedExamTypeId || !selectedParentSubjectId) {
      setStudents([]);
      setEntries({});
      return;
    }
    setLoadingGrid(true);
    const supabase = createClient();

    const { data: enrollments } = await supabase
      .from("student_enrollments")
      .select("student_id, roll_number, students(full_name)")
      .eq("class_id", selectedClassId)
      .eq("status", "active")
      .order("roll_number", { ascending: true });

    const enrolled: EnrolledStudent[] = (enrollments ?? []).map((e) => ({
      student_id: e.student_id as string,
      roll_number: (e.roll_number as number | null) ?? null,
      full_name:
        (e.students as unknown as { full_name: string })?.full_name ?? "Unknown",
    }));
    setStudents(enrolled);

    if (subSubjects.length > 0) {
      const subIds = subSubjects.map((s) => s.id);
      const { data: existing } = await supabase
        .from("non_scholastic_assessments")
        .select("student_id, sub_subject_id, grade_label")
        .eq("class_id", selectedClassId)
        .eq("exam_type_id", selectedExamTypeId)
        .in("sub_subject_id", subIds);
      const next: EntriesMap = {};
      for (const row of existing ?? []) {
        next[cellKey(row.student_id as string, row.sub_subject_id as string)] =
          row.grade_label as string;
      }
      setEntries(next);
    } else {
      setEntries({});
    }

    setLoadingGrid(false);
  }, [selectedClassId, selectedExamTypeId, selectedParentSubjectId, subSubjects]);

  useEffect(() => {
    fetchStudentsAndGrid();
  }, [fetchStudentsAndGrid]);

  const scaleForSub = useCallback(
    (sub: SubSubject): string | null => sub.grade_scale_id ?? defaultScaleId,
    [defaultScaleId]
  );

  const labelsForSub = useCallback(
    (sub: SubSubject): string[] => {
      const scaleId = scaleForSub(sub);
      if (!scaleId) return [];
      return (bandsByScale[scaleId] ?? []).map((b) => b.label);
    },
    [bandsByScale, scaleForSub]
  );

  const handleCellChange = (studentId: string, subSubjectId: string, label: string) => {
    setEntries((prev) => ({
      ...prev,
      [cellKey(studentId, subSubjectId)]: label,
    }));
  };

  const totalCells = students.length * subSubjects.length;
  const filledCells = useMemo(() => {
    let n = 0;
    for (const s of students) {
      for (const sub of subSubjects) {
        if (entries[cellKey(s.student_id, sub.id)]) n++;
      }
    }
    return n;
  }, [entries, students, subSubjects]);

  async function handleSave() {
    if (!selectedClassId || !selectedExamTypeId) return;
    const payloadEntries: Array<{
      student_id: string;
      sub_subject_id: string;
      grade_label: string | null;
    }> = [];
    for (const s of students) {
      for (const sub of subSubjects) {
        const val = entries[cellKey(s.student_id, sub.id)] ?? "";
        payloadEntries.push({
          student_id: s.student_id,
          sub_subject_id: sub.id,
          grade_label: val ? val : null,
        });
      }
    }

    if (payloadEntries.length === 0) {
      toast.error("Nothing to save");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/non-scholastic-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: selectedClassId,
          exam_type_id: selectedExamTypeId,
          entries: payloadEntries,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save assessments");
        return;
      }
      toast.success(
        `Saved ${data.saved ?? 0} · cleared ${data.cleared ?? 0}`
      );
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Non-Scholastic Assessments
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          View and override co-scholastic grades across any class.
        </p>
      </div>

      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                Exam Type
              </label>
              <Select
                value={selectedExamTypeId}
                items={examTypes.map((et) => ({ value: et.id, label: et.name }))}
                onValueChange={(v) => v && setSelectedExamTypeId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select exam" />
                </SelectTrigger>
                <SelectContent>
                  {examTypes.map((et) => (
                    <SelectItem key={et.id} value={et.id} label={et.name}>
                      {et.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-900 dark:text-white">
                Co-scholastic Subject
              </label>
              <Select
                value={selectedParentSubjectId}
                items={parentSubjects.map((p) => ({ value: p.id, label: p.name }))}
                onValueChange={(v) => v && setSelectedParentSubjectId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {parentSubjects.map((p) => (
                    <SelectItem key={p.id} value={p.id} label={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedClassId && selectedExamTypeId && selectedParentSubjectId && (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-navy-900 dark:text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-gold-500" />
                Grade Grid
              </CardTitle>
              {totalCells > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {filledCells} of {totalCells} cells filled
                </p>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={saving || students.length === 0 || subSubjects.length === 0}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save All
            </Button>
          </CardHeader>
          <CardContent>
            {loadingGrid ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : subSubjects.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 py-12">
                No active sub-subjects configured for this co-scholastic subject.
              </p>
            ) : students.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 py-12">
                No active enrollments found for this class.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Roll</TableHead>
                      <TableHead className="min-w-[220px]">Student</TableHead>
                      {subSubjects.map((sub) => (
                        <TableHead key={sub.id} className="min-w-[150px]">
                          <div className="flex items-center gap-1">
                            {sub.name}
                            {!sub.grade_scale_id && (
                              <Badge variant="outline" className="text-[9px] tracking-wide">
                                default
                              </Badge>
                            )}
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((student) => (
                      <TableRow key={student.student_id}>
                        <TableCell className="font-medium">
                          {student.roll_number ?? "-"}
                        </TableCell>
                        <TableCell>{student.full_name}</TableCell>
                        {subSubjects.map((sub) => {
                          const labels = labelsForSub(sub);
                          const current = entries[cellKey(student.student_id, sub.id)] ?? "";
                          return (
                            <TableCell key={sub.id}>
                              <Select
                                value={current}
                                items={[
                                  { value: "", label: "—" },
                                  ...labels.map((l) => ({ value: l, label: l })),
                                ]}
                                onValueChange={(v) =>
                                  handleCellChange(student.student_id, sub.id, v ?? "")
                                }
                              >
                                <SelectTrigger className="w-full h-8 text-sm">
                                  <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="" label="—">
                                    —
                                  </SelectItem>
                                  {labels.map((l) => (
                                    <SelectItem key={l} value={l} label={l}>
                                      {l}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
