"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  Loader2,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Scale,
  Baby,
  BookOpen,
  Backpack,
  GraduationCap,
  Award,
  Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { adminApi } from "@nkps/shared/lib/admin-api";
import { cn } from "@nkps/shared/lib/utils";
import type {
  ExamType,
  ExamKind,
  ExamClassLevel,
  AcademicYear,
} from "@nkps/shared/types";

const KIND_OPTIONS: { value: ExamKind; label: string; hint: string }[] = [
  { value: "term_exam", label: "Term Exam", hint: "Major exams (Half-Yearly, Annual)" },
  { value: "class_test", label: "Class Test", hint: "Periodic tests, weighted into the final result" },
  { value: "practical", label: "Practical", hint: "Lab / practical assessments" },
];

const KIND_LABELS: Record<ExamKind, string> = Object.fromEntries(
  KIND_OPTIONS.map((k) => [k.value, k.label])
) as Record<ExamKind, string>;

type LevelTheme = {
  // Tailwind base color name, used as the key for all its variants (e.g. "rose", "emerald").
  // Referenced via constructed classnames safelisted below.
  color: string;
  icon: LucideIcon;
};

type LevelDef = {
  value: ExamClassLevel;
  label: string;
  short: string;
  range: string;
  hint: string;
  theme: LevelTheme;
};

const LEVEL_DEFS: LevelDef[] = [
  {
    value: "all",
    label: "All Levels",
    short: "All",
    range: "Shared",
    hint: "Exams here count toward every level's total",
    theme: { color: "slate", icon: Layers },
  },
  {
    value: "nursery_ukg",
    label: "Pre-Primary",
    short: "Pre-Primary",
    range: "Nursery – UKG",
    hint: "Nursery, LKG, UKG",
    theme: { color: "rose", icon: Baby },
  },
  {
    value: "i_v",
    label: "Primary",
    short: "Primary",
    range: "I – V",
    hint: "Classes I to V",
    theme: { color: "amber", icon: BookOpen },
  },
  {
    value: "vi_viii",
    label: "Middle",
    short: "Middle",
    range: "VI – VIII",
    hint: "Classes VI to VIII",
    theme: { color: "emerald", icon: Backpack },
  },
  {
    value: "ix_x",
    label: "Secondary",
    short: "Secondary",
    range: "IX – X",
    hint: "Classes IX to X",
    theme: { color: "sky", icon: GraduationCap },
  },
  {
    value: "xi_xii",
    label: "Senior Secondary",
    short: "Sr. Sec.",
    range: "XI – XII",
    hint: "Classes XI to XII",
    theme: { color: "violet", icon: Award },
  },
];

const LEVEL_LABELS: Record<ExamClassLevel, string> = Object.fromEntries(
  LEVEL_DEFS.map((l) => [l.value, l.short])
) as Record<ExamClassLevel, string>;

const LEVEL_MAP: Record<ExamClassLevel, LevelDef> = Object.fromEntries(
  LEVEL_DEFS.map((l) => [l.value, l])
) as Record<ExamClassLevel, LevelDef>;

// Scoped levels (exclude umbrella "all") — coverage totals apply to these.
const SCOPED_LEVELS: ExamClassLevel[] = LEVEL_DEFS.filter(
  (l) => l.value !== "all"
).map((l) => l.value);

// Palette used to color individual exam segments inside the level bar.
// Ordered so adjacent segments contrast well.
const SEGMENT_PALETTE = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-lime-500",
];

function examAppliesToLevel(
  examLevel: ExamClassLevel,
  tab: ExamClassLevel
): boolean {
  if (tab === "all") return true;
  return examLevel === tab || examLevel === "all";
}

function roundToTwo(n: number): number {
  return Math.round(n * 100) / 100;
}

interface CoverageStatus {
  sum: number;
  state: "balanced" | "under" | "over" | "empty";
  diff: number;
  examCount: number;
}

function getCoverage(exams: ExamType[], level: ExamClassLevel): CoverageStatus {
  const visible = exams.filter((e) => examAppliesToLevel(e.class_level, level));
  if (visible.length === 0)
    return { sum: 0, state: "empty", diff: 0, examCount: 0 };
  const sum = roundToTwo(visible.reduce((a, e) => a + (e.weightage ?? 0), 0));
  const examCount = visible.length;
  if (sum === 100) return { sum, state: "balanced", diff: 0, examCount };
  if (sum < 100)
    return { sum, state: "under", diff: roundToTwo(100 - sum), examCount };
  return { sum, state: "over", diff: roundToTwo(sum - 100), examCount };
}

export default function AdminExamTypesPage() {
  const supabase = createClient();

  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [selectedLevel, setSelectedLevel] = useState<ExamClassLevel>("all");

  const [formData, setFormData] = useState({
    name: "",
    academic_year_id: "",
    max_marks: "100",
    weightage: "",
    sort_order: "0",
    kind: "term_exam" as ExamKind,
    upper_header: "",
    class_level: "all" as ExamClassLevel,
  });

  const fetchData = useCallback(async () => {
    const [etRes, ayRes] = await Promise.all([
      supabase
        .from("exam_types")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase
        .from("academic_years")
        .select("*")
        .order("start_date", { ascending: false }),
    ]);

    const exams = (etRes.data as ExamType[]) ?? [];
    const years = (ayRes.data as AcademicYear[]) ?? [];
    setExamTypes(exams);
    setAcademicYears(years);

    setSelectedYearId((prev) => {
      if (prev && years.some((y) => y.id === prev)) return prev;
      return years.find((y) => y.is_current)?.id ?? years[0]?.id ?? "";
    });

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const yearExams = useMemo(
    () => examTypes.filter((e) => e.academic_year_id === selectedYearId),
    [examTypes, selectedYearId]
  );

  const tabExams = useMemo(
    () =>
      yearExams.filter((e) => examAppliesToLevel(e.class_level, selectedLevel)),
    [yearExams, selectedLevel]
  );

  const tabCoverage = useMemo(
    () => getCoverage(yearExams, selectedLevel),
    [yearExams, selectedLevel]
  );

  const levelCoverage = useMemo(() => {
    const map: Partial<Record<ExamClassLevel, CoverageStatus>> = {};
    for (const level of SCOPED_LEVELS) {
      map[level] = getCoverage(yearExams, level);
    }
    map["all"] = getCoverage(yearExams, "all");
    return map as Record<ExamClassLevel, CoverageStatus>;
  }, [yearExams]);

  const unbalancedLevels = useMemo(
    () =>
      SCOPED_LEVELS.filter((lvl) => {
        const c = levelCoverage[lvl];
        return c && c.state !== "balanced" && c.state !== "empty";
      }),
    [levelCoverage]
  );

  // Stable color index per exam id so the same exam paints the same segment
  // color across every level bar it appears in.
  const examSegmentColor = useMemo(() => {
    const colors: Record<string, string> = {};
    const sorted = [...yearExams].sort((a, b) => a.sort_order - b.sort_order);
    sorted.forEach((exam, i) => {
      colors[exam.id] = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length];
    });
    return colors;
  }, [yearExams]);

  const resetForm = () => {
    const currentYear = academicYears.find((ay) => ay.is_current);
    setFormData({
      name: "",
      academic_year_id: selectedYearId || currentYear?.id || "",
      max_marks: "100",
      weightage: "",
      sort_order: "0",
      kind: "term_exam",
      upper_header: "",
      class_level: selectedLevel === "all" ? "i_v" : selectedLevel,
    });
    setEditingId(null);
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (et: ExamType) => {
    setEditingId(et.id);
    setFormData({
      name: et.name,
      academic_year_id: et.academic_year_id,
      max_marks: String(et.max_marks),
      weightage: et.weightage !== null ? String(et.weightage) : "",
      sort_order: String(et.sort_order),
      kind: et.kind ?? "term_exam",
      upper_header: et.upper_header ?? "",
      class_level: et.class_level ?? "all",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!formData.academic_year_id) {
      toast.error("Please select an academic year");
      return;
    }

    setSubmitting(true);

    const data = {
      name: formData.name.trim(),
      academic_year_id: formData.academic_year_id,
      max_marks: parseInt(formData.max_marks) || 100,
      weightage: formData.weightage ? parseFloat(formData.weightage) : null,
      sort_order: parseInt(formData.sort_order) || 0,
      kind: formData.kind,
      upper_header: formData.upper_header.trim() || null,
      class_level: formData.class_level,
    };

    const result = editingId
      ? await adminApi({
          action: "update",
          table: "exam_types",
          data,
          match: { column: "id", value: editingId },
        })
      : await adminApi({ action: "insert", table: "exam_types", data });

    if (!result.success) {
      toast.error(result.error || "Failed to save exam type");
    } else {
      toast.success(editingId ? "Exam type updated" : "Exam type created");
      setDialogOpen(false);
      resetForm();
      await fetchData();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this exam type? This cannot be undone.")) return;

    const result = await adminApi({
      action: "delete",
      table: "exam_types",
      match: { column: "id", value: id },
    });

    if (!result.success) {
      toast.error("Failed to delete exam type");
      return;
    }

    toast.success("Exam type deleted");
    await fetchData();
  };

  const handleAutoBalance = async () => {
    if (selectedLevel === "all") return;
    const scoped = yearExams.filter((e) => e.class_level === selectedLevel);
    if (scoped.length === 0) {
      toast.info("No level-specific exams to balance");
      return;
    }
    const allLevelSum = yearExams
      .filter((e) => e.class_level === "all")
      .reduce((acc, e) => acc + (e.weightage ?? 0), 0);
    const remaining = 100 - allLevelSum;
    if (remaining <= 0) {
      toast.error(
        `"All Levels" exams already use ${allLevelSum}% — reduce those first before auto-balancing`
      );
      return;
    }

    const even = roundToTwo(remaining / scoped.length);
    const drift = roundToTwo(remaining - even * scoped.length);

    if (
      !confirm(
        `Distribute ${remaining}% evenly across ${scoped.length} ${LEVEL_LABELS[selectedLevel]} exam${scoped.length > 1 ? "s" : ""} (~${even}% each)?`
      )
    )
      return;

    setSubmitting(true);
    const updates = scoped.map((exam, i) =>
      adminApi({
        action: "update",
        table: "exam_types",
        data: { weightage: i === 0 ? roundToTwo(even + drift) : even },
        match: { column: "id", value: exam.id },
      })
    );

    const results = await Promise.all(updates);
    const failed = results.filter((r) => !r.success).length;
    if (failed > 0) {
      toast.error(`${failed} exam${failed > 1 ? "s" : ""} failed to update`);
    } else {
      toast.success("Weightages balanced to 100%");
    }
    await fetchData();
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
      </div>
    );
  }

  const selectedYear = academicYears.find((y) => y.id === selectedYearId);
  const selectedDef = LEVEL_MAP[selectedLevel];
  const selectedIsScoped = selectedLevel !== "all";

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Exam Types
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-xl">
            Configure exams per class level. Weightages per level must sum to
            100% — that&apos;s what the final report card and grading math
            depend on.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedYearId}
            items={academicYears.map((ay) => ({
              value: ay.id,
              label: ay.name,
            }))}
            onValueChange={(val) => val && setSelectedYearId(val)}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="Academic Year" />
            </SelectTrigger>
            <SelectContent>
              {academicYears.map((ay) => (
                <SelectItem key={ay.id} value={ay.id} label={ay.name}>
                  {ay.name}
                  {ay.is_current ? " (current)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={openAdd}
            className="bg-navy-900 hover:bg-navy-800 text-white shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Exam Type
          </Button>
        </div>
      </div>

      {/* Unbalanced banner */}
      {unbalancedLevels.length > 0 && selectedYear && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 dark:border-amber-900/40 dark:from-amber-950/20 dark:to-orange-950/10 p-4 flex items-start gap-3 shadow-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {unbalancedLevels.length} level
              {unbalancedLevels.length > 1 ? "s" : ""} unbalanced for{" "}
              {selectedYear.name}
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1">
              Weightages for each level must sum to exactly 100% before results
              can be calculated. Click a level below to review.
            </p>
            <div className="flex flex-wrap gap-2 mt-2.5">
              {unbalancedLevels.map((lvl) => {
                const c = levelCoverage[lvl];
                const Icon = LEVEL_MAP[lvl].theme.icon;
                return (
                  <button
                    key={lvl}
                    onClick={() => setSelectedLevel(lvl)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                      c.state === "over"
                        ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/50"
                        : "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/50"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {LEVEL_MAP[lvl].short} · {c.sum}%
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Level cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {LEVEL_DEFS.map((lvl) => {
          const cov = levelCoverage[lvl.value];
          const isActive = selectedLevel === lvl.value;
          const visibleExams = yearExams.filter((e) =>
            examAppliesToLevel(e.class_level, lvl.value)
          );
          return (
            <LevelCard
              key={lvl.value}
              def={lvl}
              coverage={cov}
              isActive={isActive}
              isAllTab={lvl.value === "all"}
              exams={visibleExams}
              segmentColors={examSegmentColor}
              onClick={() => setSelectedLevel(lvl.value)}
            />
          );
        })}
      </div>

      {/* Selected level detail bar */}
      <div
        className={cn(
          "rounded-t-xl border-b-0 p-4 flex items-start justify-between gap-3 flex-wrap",
          levelHeaderBg(selectedDef.theme.color)
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              levelIconBg(selectedDef.theme.color)
            )}
          >
            <selectedDef.theme.icon
              className={cn("h-5 w-5", levelIconColor(selectedDef.theme.color))}
            />
          </div>
          <div>
            <h2 className="font-heading text-lg font-bold text-navy-900 dark:text-white leading-tight">
              {selectedDef.label}
              {selectedIsScoped && (
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                  {selectedDef.range}
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              {selectedDef.hint}
              {selectedIsScoped &&
                " · 'All Levels' exams contribute to this total too."}
            </p>
          </div>
        </div>
        {selectedIsScoped && (
          <div className="flex items-center gap-2">
            <CoverageChip status={tabCoverage} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAutoBalance}
              disabled={
                submitting ||
                yearExams.filter((e) => e.class_level === selectedLevel)
                  .length === 0
              }
              className="h-8 text-xs bg-white/80 dark:bg-gray-900/60"
            >
              <Scale className="h-3.5 w-3.5 mr-1.5" />
              Auto-balance
            </Button>
          </div>
        )}
      </div>

      {/* Exams table */}
      <div className="erp-table-container rounded-t-none border-t-0 p-6">
        {tabExams.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No exams for this level yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
              Click &quot;Add Exam Type&quot; and choose &quot;
              {selectedDef.label}&quot; to start building this scheme.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Applies To</TableHead>
                <TableHead>Max Marks</TableHead>
                <TableHead>Weightage</TableHead>
                <TableHead>Upper Header</TableHead>
                <TableHead>Sort</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabExams.map((et) => (
                <TableRow key={et.id}>
                  <TableCell>
                    <span
                      className={cn(
                        "block h-6 w-1.5 rounded-full",
                        examSegmentColor[et.id] ?? "bg-gray-300"
                      )}
                      aria-hidden
                    />
                  </TableCell>
                  <TableCell className="font-medium">{et.name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                      {KIND_LABELS[et.kind ?? "term_exam"]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <AppliesToPill level={et.class_level ?? "all"} />
                  </TableCell>
                  <TableCell>{et.max_marks}</TableCell>
                  <TableCell>
                    {et.weightage !== null ? (
                      <span className="font-semibold tabular-nums">
                        {et.weightage}%
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 max-w-[200px] truncate">
                    {et.upper_header ?? "—"}
                  </TableCell>
                  <TableCell>{et.sort_order}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(et)}
                        aria-label="Edit exam type"
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(et.id)}
                        aria-label="Delete exam type"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10">
                <ClipboardList className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <DialogTitle>
                  {editingId ? "Edit Exam Type" : "Add Exam Type"}
                </DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {editingId
                    ? "Update exam type details"
                    : "Define a new exam type"}
                </p>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Name</Label>
                <Input
                  className="h-9"
                  placeholder="e.g. Mid-Term, Final, Unit Test 1"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Academic Year</Label>
                <Select
                  value={formData.academic_year_id}
                  items={academicYears.map((ay) => ({
                    value: ay.id,
                    label: ay.name,
                  }))}
                  onValueChange={(val) =>
                    val && setFormData({ ...formData, academic_year_id: val })
                  }
                >
                  <SelectTrigger className="w-full h-9">
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYears.map((ay) => (
                      <SelectItem key={ay.id} value={ay.id} label={ay.name}>
                        {ay.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Applies to level</Label>
              <Select
                value={formData.class_level}
                items={LEVEL_DEFS.map((l) => ({
                  value: l.value,
                  label: l.label,
                }))}
                onValueChange={(val) =>
                  val &&
                  setFormData({
                    ...formData,
                    class_level: val as ExamClassLevel,
                  })
                }
              >
                <SelectTrigger className="w-full h-9">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_DEFS.map((l) => (
                    <SelectItem key={l.value} value={l.value} label={l.label}>
                      <div className="flex flex-col">
                        <span>
                          {l.label}
                          <span className="ml-1.5 text-[10px] text-gray-500">
                            {l.range}
                          </span>
                        </span>
                        <span className="text-[10px] text-gray-500">
                          {l.hint}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-gray-500 mt-1">
                Pick a level so the exam only appears for those classes. Choose
                &quot;All Levels&quot; for school-wide exams counted everywhere.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Kind</Label>
                <Select
                  value={formData.kind}
                  items={KIND_OPTIONS.map((k) => ({
                    value: k.value,
                    label: k.label,
                  }))}
                  onValueChange={(val) =>
                    val && setFormData({ ...formData, kind: val as ExamKind })
                  }
                >
                  <SelectTrigger className="w-full h-9">
                    <SelectValue placeholder="Select kind" />
                  </SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((k) => (
                      <SelectItem key={k.value} value={k.value} label={k.label}>
                        <div className="flex flex-col">
                          <span>{k.label}</span>
                          <span className="text-[10px] text-gray-500">
                            {k.hint}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Sort Order</Label>
                <Input
                  className="h-9"
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) =>
                    setFormData({ ...formData, sort_order: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Max Marks</Label>
                <Input
                  className="h-9"
                  type="number"
                  value={formData.max_marks}
                  onChange={(e) =>
                    setFormData({ ...formData, max_marks: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Weightage %</Label>
                <Input
                  className="h-9"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 50"
                  value={formData.weightage}
                  onChange={(e) =>
                    setFormData({ ...formData, weightage: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Upper Header</Label>
              <Input
                className="h-9"
                placeholder='e.g. "ANNUAL EXAMINATION 2025-26"'
                value={formData.upper_header}
                onChange={(e) =>
                  setFormData({ ...formData, upper_header: e.target.value })
                }
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LevelCard({
  def,
  coverage,
  isActive,
  isAllTab,
  exams,
  segmentColors,
  onClick,
}: {
  def: LevelDef;
  coverage: CoverageStatus;
  isActive: boolean;
  isAllTab: boolean;
  exams: ExamType[];
  segmentColors: Record<string, string>;
  onClick: () => void;
}) {
  const Icon = def.theme.icon;
  // On "All" tab the sum is meaningless as a balance metric — just show exam count.
  const showBalance = !isAllTab;

  const stateText = isAllTab
    ? null
    : coverage.state === "balanced"
      ? "Balanced"
      : coverage.state === "empty"
        ? "Empty"
        : coverage.state === "under"
          ? `${coverage.diff}% short`
          : `${coverage.diff}% over`;

  const bigNumber = isAllTab
    ? String(coverage.examCount)
    : coverage.state === "empty"
      ? "—"
      : `${coverage.sum}%`;

  const bigLabel = isAllTab ? "exams" : null;

  // Segment bar normalization: spread segments across max(sum, 100) so over-100
  // overflows visually without squeezing everything else.
  const denom =
    coverage.sum > 0 ? Math.max(100, coverage.sum) : 100;
  const ordered = [...exams].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative text-left rounded-xl border p-4 transition-all",
        "bg-white dark:bg-gray-950",
        "hover:shadow-md hover:-translate-y-0.5",
        isActive
          ? cn(
              "shadow-md -translate-y-0.5 border-transparent",
              levelActiveRing(def.theme.color),
              levelActiveBg(def.theme.color)
            )
          : "border-gray-200 dark:border-gray-800"
      )}
      aria-pressed={isActive}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            levelIconBg(def.theme.color)
          )}
        >
          <Icon className={cn("h-4.5 w-4.5", levelIconColor(def.theme.color))} />
        </div>
        {showBalance && <CoverageDot status={coverage} />}
      </div>

      <div className="mb-1">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {def.short}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
          {def.range}
        </p>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            showBalance ? stateColor(coverage.state) : "text-navy-900 dark:text-white"
          )}
        >
          {bigNumber}
        </span>
        {bigLabel && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {bigLabel}
          </span>
        )}
      </div>

      {/* Segment bar — each exam as a colored slice of the level bar */}
      <div className="mt-3 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800/80 overflow-hidden flex">
        {ordered.length === 0 ? (
          <span className="block w-full" aria-hidden />
        ) : (
          ordered.map((e) => {
            const w = ((e.weightage ?? 0) / denom) * 100;
            if (w <= 0) return null;
            return (
              <span
                key={e.id}
                title={`${e.name} · ${e.weightage ?? 0}%`}
                className={cn(
                  "block h-full",
                  segmentColors[e.id] ?? "bg-gray-400",
                  "transition-opacity",
                  isActive ? "opacity-100" : "opacity-90"
                )}
                style={{ width: `${w}%` }}
              />
            );
          })
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px]">
        <span className="text-gray-500 dark:text-gray-400">
          {coverage.examCount} exam{coverage.examCount === 1 ? "" : "s"}
        </span>
        {stateText && (
          <span className={cn("font-medium", stateColor(coverage.state))}>
            {stateText}
          </span>
        )}
      </div>
    </button>
  );
}

function CoverageDot({ status }: { status: CoverageStatus }) {
  if (status.state === "empty") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-700"
        aria-label="No exams"
      />
    );
  }
  if (status.state === "balanced") {
    return (
      <CheckCircle2
        className="h-4 w-4 text-emerald-500"
        aria-label="Balanced"
      />
    );
  }
  return (
    <AlertTriangle
      className={cn(
        "h-4 w-4",
        status.state === "over" ? "text-red-500" : "text-amber-500"
      )}
      aria-label={status.state === "over" ? "Over 100%" : "Under 100%"}
    />
  );
}

function CoverageChip({ status }: { status: CoverageStatus }) {
  if (status.state === "empty") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        No exams
      </span>
    );
  }
  if (status.state === "balanced") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Balanced · 100%
      </span>
    );
  }
  if (status.state === "under") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50">
        <AlertTriangle className="h-3.5 w-3.5" />
        {status.sum}% · {status.diff}% unallocated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900/50">
      <AlertTriangle className="h-3.5 w-3.5" />
      {status.sum}% · over by {status.diff}%
    </span>
  );
}

function AppliesToPill({ level }: { level: ExamClassLevel }) {
  const def = LEVEL_MAP[level];
  const Icon = def.theme.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium",
        level === "all"
          ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          : levelPillClass(def.theme.color)
      )}
    >
      <Icon className="h-3 w-3" />
      {def.short}
    </span>
  );
}

// Tailwind doesn't see dynamic class names, so these helpers return the exact
// static class strings that are safelisted by being written out here.
function levelIconBg(color: string): string {
  switch (color) {
    case "slate":
      return "bg-slate-100 dark:bg-slate-800";
    case "rose":
      return "bg-rose-100 dark:bg-rose-950/40";
    case "amber":
      return "bg-amber-100 dark:bg-amber-950/40";
    case "emerald":
      return "bg-emerald-100 dark:bg-emerald-950/40";
    case "sky":
      return "bg-sky-100 dark:bg-sky-950/40";
    case "violet":
      return "bg-violet-100 dark:bg-violet-950/40";
  }
  return "bg-gray-100";
}

function levelIconColor(color: string): string {
  switch (color) {
    case "slate":
      return "text-slate-600 dark:text-slate-300";
    case "rose":
      return "text-rose-600 dark:text-rose-300";
    case "amber":
      return "text-amber-600 dark:text-amber-300";
    case "emerald":
      return "text-emerald-600 dark:text-emerald-300";
    case "sky":
      return "text-sky-600 dark:text-sky-300";
    case "violet":
      return "text-violet-600 dark:text-violet-300";
  }
  return "text-gray-600";
}

function levelActiveRing(color: string): string {
  switch (color) {
    case "slate":
      return "ring-2 ring-slate-400 dark:ring-slate-500";
    case "rose":
      return "ring-2 ring-rose-400 dark:ring-rose-500";
    case "amber":
      return "ring-2 ring-amber-400 dark:ring-amber-500";
    case "emerald":
      return "ring-2 ring-emerald-400 dark:ring-emerald-500";
    case "sky":
      return "ring-2 ring-sky-400 dark:ring-sky-500";
    case "violet":
      return "ring-2 ring-violet-400 dark:ring-violet-500";
  }
  return "ring-2 ring-gray-400";
}

function levelActiveBg(color: string): string {
  switch (color) {
    case "slate":
      return "bg-slate-50/70 dark:bg-slate-900/40";
    case "rose":
      return "bg-rose-50/70 dark:bg-rose-950/20";
    case "amber":
      return "bg-amber-50/70 dark:bg-amber-950/20";
    case "emerald":
      return "bg-emerald-50/70 dark:bg-emerald-950/20";
    case "sky":
      return "bg-sky-50/70 dark:bg-sky-950/20";
    case "violet":
      return "bg-violet-50/70 dark:bg-violet-950/20";
  }
  return "bg-gray-50";
}

function levelHeaderBg(color: string): string {
  switch (color) {
    case "slate":
      return "bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-900/40 dark:to-slate-900/10 border border-slate-200 dark:border-slate-800";
    case "rose":
      return "bg-gradient-to-r from-rose-50 to-pink-50/50 dark:from-rose-950/30 dark:to-pink-950/10 border border-rose-200 dark:border-rose-900/40";
    case "amber":
      return "bg-gradient-to-r from-amber-50 to-orange-50/50 dark:from-amber-950/30 dark:to-orange-950/10 border border-amber-200 dark:border-amber-900/40";
    case "emerald":
      return "bg-gradient-to-r from-emerald-50 to-green-50/50 dark:from-emerald-950/30 dark:to-green-950/10 border border-emerald-200 dark:border-emerald-900/40";
    case "sky":
      return "bg-gradient-to-r from-sky-50 to-blue-50/50 dark:from-sky-950/30 dark:to-blue-950/10 border border-sky-200 dark:border-sky-900/40";
    case "violet":
      return "bg-gradient-to-r from-violet-50 to-purple-50/50 dark:from-violet-950/30 dark:to-purple-950/10 border border-violet-200 dark:border-violet-900/40";
  }
  return "bg-gray-50 border border-gray-200";
}

function levelPillClass(color: string): string {
  switch (color) {
    case "slate":
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    case "rose":
      return "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
    case "amber":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
    case "emerald":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "sky":
      return "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
    case "violet":
      return "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300";
  }
  return "bg-gray-100 text-gray-700";
}

function stateColor(state: CoverageStatus["state"]): string {
  switch (state) {
    case "balanced":
      return "text-emerald-600 dark:text-emerald-400";
    case "over":
      return "text-red-600 dark:text-red-400";
    case "under":
      return "text-amber-600 dark:text-amber-400";
    case "empty":
    default:
      return "text-gray-400 dark:text-gray-500";
  }
}
