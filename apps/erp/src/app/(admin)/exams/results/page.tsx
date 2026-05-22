"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Badge } from "@nkps/shared/components/ui/badge";
import { BarChart3, TrendingUp, Users, Award, Pencil } from "lucide-react";
import Link from "next/link";
import { formatClassName } from "@nkps/shared/lib/utils";
import { computeGrade, type GradeBand } from "@/lib/grading";
import type { Class, ExamType } from "@nkps/shared/types";
import { HistoricalResultsImportDialog } from "@/components/HistoricalResultsImportDialog";

interface SubjectBreakdown {
  subject_id: string;
  subject_name: string;
  avg_marks: number;
  max_marks: number;
  avg_percentage: number;
  pass_count: number;
  total_count: number;
  pass_percentage: number;
}

interface ClassSummary {
  avg_percentage: number;
  pass_percentage: number;
  total_students: number;
  top_performers: { name: string; percentage: number }[];
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
  A: "bg-green-50 text-green-600 border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-800",
  "B+": "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  B: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800",
  C: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800",
  D: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800",
  F: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
};


export default function AdminResultsPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [gradeBands, setGradeBands] = useState<GradeBand[]>([]);
  const getGradeFromPct = (pct: number) =>
    computeGrade(pct, gradeBands) ?? "";
  const [selectedExamTypeId, setSelectedExamTypeId] = useUrlState("exam_type_id");

  const [summary, setSummary] = useState<ClassSummary | null>(null);
  const [subjectBreakdown, setSubjectBreakdown] = useState<SubjectBreakdown[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);

  // Fetch classes and exam types
  useEffect(() => {
    async function fetchInitial() {
      const supabase = createClient();

      // Current academic year
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

        if (classesData) setClasses(classesData);

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

  // Load the grade scale (override → default scholastic) for the selected
  // class so admin dashboards grade the same way report cards do.
  useEffect(() => {
    if (!selectedClassId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Fetch results data when class and exam type are selected
  const fetchResultsData = useCallback(async () => {
    if (!selectedClassId || !selectedExamTypeId) {
      setSummary(null);
      setSubjectBreakdown([]);
      return;
    }

    setLoadingData(true);
    const supabase = createClient();

    // Fetch all results for this class + exam type
    const { data: results } = await supabase
      .from("results")
      .select(
        "student_id, subject_id, marks_obtained, max_marks, grade, subjects(id, name)"
      )
      .eq("class_id", selectedClassId)
      .eq("exam_type_id", selectedExamTypeId);

    if (!results || results.length === 0) {
      setSummary(null);
      setSubjectBreakdown([]);
      setLoadingData(false);
      return;
    }

    // Group by subject for breakdown
    const subjectMap = new Map<
      string,
      {
        subject_name: string;
        marks: number[];
        max_marks: number;
        pass_count: number;
      }
    >();

    // Group by student for overall summary
    const studentTotals = new Map<
      string,
      { total_obtained: number; total_max: number }
    >();

    for (const r of results) {
      const subject = r.subjects as unknown as { id: string; name: string };
      if (!subject) continue;

      // Subject breakdown
      if (!subjectMap.has(subject.id)) {
        subjectMap.set(subject.id, {
          subject_name: subject.name,
          marks: [],
          max_marks: r.max_marks,
          pass_count: 0,
        });
      }
      const subj = subjectMap.get(subject.id)!;
      subj.marks.push(r.marks_obtained);
      const pct = (r.marks_obtained / r.max_marks) * 100;
      if (pct >= 40) subj.pass_count++;

      // Student totals
      if (!studentTotals.has(r.student_id)) {
        studentTotals.set(r.student_id, { total_obtained: 0, total_max: 0 });
      }
      const st = studentTotals.get(r.student_id)!;
      st.total_obtained += r.marks_obtained;
      st.total_max += r.max_marks;
    }

    // Build subject breakdown
    const breakdown: SubjectBreakdown[] = [];
    for (const [subjectId, data] of subjectMap) {
      const avg =
        data.marks.reduce((a, b) => a + b, 0) / data.marks.length;
      const avgPct = (avg / data.max_marks) * 100;
      breakdown.push({
        subject_id: subjectId,
        subject_name: data.subject_name,
        avg_marks: Math.round(avg * 10) / 10,
        max_marks: data.max_marks,
        avg_percentage: Math.round(avgPct),
        pass_count: data.pass_count,
        total_count: data.marks.length,
        pass_percentage: Math.round((data.pass_count / data.marks.length) * 100),
      });
    }

    setSubjectBreakdown(breakdown);

    // Build class summary
    const studentPercentages: { student_id: string; percentage: number }[] = [];
    let passCount = 0;

    for (const [studentId, totals] of studentTotals) {
      const pct =
        totals.total_max > 0
          ? (totals.total_obtained / totals.total_max) * 100
          : 0;
      studentPercentages.push({ student_id: studentId, percentage: pct });
      if (pct >= 40) passCount++;
    }

    const avgPct =
      studentPercentages.length > 0
        ? studentPercentages.reduce((a, b) => a + b.percentage, 0) /
          studentPercentages.length
        : 0;

    // Top 5 performers
    const topStudentIds = studentPercentages
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5);

    // Fetch names for top performers
    const topIds = topStudentIds.map((s) => s.student_id);
    let topPerformers: { name: string; percentage: number }[] = [];

    if (topIds.length > 0) {
      const { data: studentRecords } = await supabase
        .from("students")
        .select("id, full_name")
        .in("id", topIds);

      const nameMap = new Map<string, string>();
      for (const p of studentRecords ?? []) {
        nameMap.set(p.id, p.full_name);
      }

      topPerformers = topStudentIds.map((s) => ({
        name: nameMap.get(s.student_id) ?? "Unknown",
        percentage: Math.round(s.percentage),
      }));
    }

    setSummary({
      avg_percentage: Math.round(avgPct),
      pass_percentage: Math.round(
        (passCount / studentPercentages.length) * 100
      ),
      total_students: studentPercentages.length,
      top_performers: topPerformers,
    });

    setLoadingData(false);
  }, [selectedClassId, selectedExamTypeId]);

  useEffect(() => {
    fetchResultsData();
  }, [fetchResultsData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900 dark:border-white border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Results Overview
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            View class-wise performance summary and subject breakdown.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <HistoricalResultsImportDialog />
          <Link
            href={
              selectedClassId && selectedExamTypeId
                ? `/exams/results/edit?class_id=${encodeURIComponent(selectedClassId)}&exam_type_id=${encodeURIComponent(selectedExamTypeId)}`
                : "/exams/results/edit"
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-white dark:bg-card px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors"
          >
            <Pencil className="h-4 w-4" />
            Edit student results
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                Exam Type
              </label>
              <Select
                value={selectedExamTypeId}
                items={examTypes.map((et) => ({ value: et.id, label: et.name }))}
                onValueChange={(val) => val && setSelectedExamTypeId(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select exam type" />
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
          </div>
        </CardContent>
      </Card>

      {/* Loading / Empty state */}
      {loadingData && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900 dark:border-white border-t-transparent" />
        </div>
      )}

      {!loadingData &&
        selectedClassId &&
        selectedExamTypeId &&
        !summary && (
          <Card className="bg-white dark:bg-card rounded-2xl">
            <CardContent className="flex items-center justify-center py-16">
              <div className="text-center text-gray-400 dark:text-gray-500">
                <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">
                  No results found for this combination
                </p>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Summary Cards */}
      {summary && !loadingData && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-white dark:bg-card rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white text-base">
                  <TrendingUp className="h-5 w-5 text-gold-500" />
                  Average Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-navy-900 dark:text-white">
                  {summary.avg_percentage}%
                </p>
                <Badge
                  className={`mt-2 text-xs ${GRADE_COLORS[getGradeFromPct(summary.avg_percentage)] ?? ""}`}
                >
                  Grade {getGradeFromPct(summary.avg_percentage)}
                </Badge>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-card rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white text-base">
                  <Users className="h-5 w-5 text-gold-500" />
                  Pass Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-navy-900 dark:text-white">
                  {summary.pass_percentage}%
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {summary.total_students} students evaluated
                </p>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-card rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white text-base">
                  <Award className="h-5 w-5 text-gold-500" />
                  Top Performers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {summary.top_performers.slice(0, 3).map((tp, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-navy-900 dark:text-white truncate mr-2">
                        {i + 1}. {tp.name}
                      </span>
                      <Badge
                        className={`text-xs shrink-0 ${GRADE_COLORS[getGradeFromPct(tp.percentage)] ?? ""}`}
                      >
                        {tp.percentage}%
                      </Badge>
                    </div>
                  ))}
                  {summary.top_performers.length === 0 && (
                    <p className="text-sm text-gray-400 dark:text-gray-500">No data</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Subject Breakdown */}
          <Card className="bg-white dark:bg-card rounded-2xl">
            <CardHeader>
              <CardTitle className="text-navy-900 dark:text-white">
                Subject-wise Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subjectBreakdown.length === 0 ? (
                <p className="text-center text-gray-400 dark:text-gray-500 py-8">
                  No subject data available
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead className="text-center">
                          Avg Marks
                        </TableHead>
                        <TableHead className="text-center">
                          Max Marks
                        </TableHead>
                        <TableHead className="text-center">
                          Avg %
                        </TableHead>
                        <TableHead className="text-center">
                          Pass %
                        </TableHead>
                        <TableHead className="text-center">Grade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subjectBreakdown.map((sub) => (
                        <TableRow key={sub.subject_id}>
                          <TableCell className="font-medium">
                            {sub.subject_name}
                          </TableCell>
                          <TableCell className="text-center">
                            {sub.avg_marks}
                          </TableCell>
                          <TableCell className="text-center">
                            {sub.max_marks}
                          </TableCell>
                          <TableCell className="text-center">
                            {sub.avg_percentage}%
                          </TableCell>
                          <TableCell className="text-center">
                            <span
                              className={
                                sub.pass_percentage >= 80
                                  ? "text-green-600"
                                  : sub.pass_percentage >= 60
                                    ? "text-yellow-600"
                                    : "text-red-600"
                              }
                            >
                              {sub.pass_percentage}%
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={`text-xs ${GRADE_COLORS[getGradeFromPct(sub.avg_percentage)] ?? ""}`}
                            >
                              {getGradeFromPct(sub.avg_percentage)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
