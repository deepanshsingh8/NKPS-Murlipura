"use client";

import dynamic from "next/dynamic";
import { useMountOnceOpen } from "@nkps/shared/lib/hooks/use-mount-once-open";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { TableExportButton } from "@nkps/shared/components/ui/table-export-button";
import { AcademicSessionPicker } from "@nkps/shared/components/AcademicSessionPicker";
import { useAcademicSession } from "@nkps/shared/lib/hooks/use-academic-session";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  Loader2,
  BookOpen,
  Library,
  GraduationCap,
  Layers,
  Settings2,
  Check,
  Users,
  Filter,
  Sparkles,
  Upload,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { adminApi, fetchRowDependencies } from "@nkps/shared/lib/admin-api";
import { describeDependencies } from "@nkps/shared/lib/row-dependencies";
import { cn, formatClassName } from "@nkps/shared/lib/utils";
import { teacherLabel } from "@nkps/shared/lib/teacher-options";
// Loaded when it is first opened, not when the page is. Bulk upload is a
// once-a-session job on a screen people open every day, and the component
// is 807 lines of it.
const QuickSetupWizard = dynamic(() => import("@/components/QuickSetupWizard"));
// Loaded when it is first opened, not when the page is. Bulk upload is a
// once-a-session job on a screen people open every day, and the component
// is 533 lines of it.
const SubjectBulkUpload = dynamic(() =>
  import("@/components/SubjectBulkUpload").then((m) => m.SubjectBulkUpload)
);
import { ClassSubjectsDialog } from "@/components/ClassSubjectsDialog";
import { ClassBandPicker } from "@/components/ClassBandPicker";
import { WingApplyDialog } from "@/components/WingApplyDialog";
import type { Class, Subject, Teacher, Stream } from "@nkps/shared/types";

type Tab = "subjects" | "assignments" | "streams" | "teachers";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "subjects", label: "Subjects", icon: BookOpen },
  { id: "assignments", label: "Class Assignments", icon: Library },
  { id: "streams", label: "Streams", icon: GraduationCap },
  { id: "teachers", label: "Teacher Subjects", icon: Users },
];

// ── Row types for the consolidated assignments table ──
interface AssignmentRow {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string | null;
  class_name: string;
  class_section: string;
  class_sort: number;
  stream_name: string | null;
  subject_name: string;
  subject_code: string | null;
  teacher_name: string | null;
  student_count: number;
}

// ── One row of the Teachers tab: a teacher plus the subjects they can teach ──
interface TeacherSubjectRow {
  id: string;
  full_name: string;
  employee_id: string;
  is_active: boolean;
  subject_ids: string[];
  subject_names: string[];
}

// ── What else in the system points at a stream ──
interface StreamUsage {
  classes: number;
  subjects: number;
  fee_structures: number;
}

// ── Stream with its subject details ──
interface StreamWithSubjects extends Stream {
  subjects: {
    id: string;
    stream_subject_id: string;
    name: string;
    code: string | null;
    is_mandatory: boolean;
  }[];
}

export default function AdminSubjectsPage() {
  const supabase = createClient();
  // Class Assignments is where the day-to-day work is; the catalogue is
  // reference material one tab away. Teachers asked to start from a class.
  const [tab, setTab] = useState<Tab>("assignments");

  // ── Subjects state ──
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [category, setCategory] = useState<"languages" | "academic" | "co_curricular" | "">("");
  const [isElective, setIsElective] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [deletingSubjectId, setDeletingSubjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editNickname, setEditNickname] = useState("");
  const [editCategory, setEditCategory] = useState<"languages" | "academic" | "co_curricular" | "">("");
  const [editIsElective, setEditIsElective] = useState(false);
  // §8 list filter
  const [categoryFilter, setCategoryFilter] = useState<"all" | "languages" | "academic" | "co_curricular" | "uncategorized">("all");

  // ── Assignments state ──
  const [classes, setClasses] = useState<Class[]>([]);
  const [activeSubjects, setActiveSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  // Filters
  const [filterClassId, setFilterClassId] = useState("");
  const [filterSubjectId, setFilterSubjectId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  // Edit teacher dialog
  const [editTeacherRow, setEditTeacherRow] = useState<AssignmentRow | null>(null);
  const [editTeacherDialogOpen, setEditTeacherDialogOpen] = useState(false);
  const [editTeacherValue, setEditTeacherValue] = useState("");
  const [editTeacherSubmitting, setEditTeacherSubmitting] = useState(false);

  // ── Streams state ──
  const [streams, setStreams] = useState<StreamWithSubjects[]>([]);
  const [streamUsage, setStreamUsage] = useState<Record<string, StreamUsage>>({});
  const [streamsLoading, setStreamsLoading] = useState(true);
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [streamSubmitting, setStreamSubmitting] = useState(false);
  const [streamName, setStreamName] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [streamSortOrder, setStreamSortOrder] = useState(0);
  const [editingStream, setEditingStream] = useState<StreamWithSubjects | null>(null);
  const [editStreamDialogOpen, setEditStreamDialogOpen] = useState(false);
  const [editStreamName, setEditStreamName] = useState("");
  const [editStreamCode, setEditStreamCode] = useState("");
  const [editStreamSortOrder, setEditStreamSortOrder] = useState(0);
  // ── Wings (migration 118) ──
  // A wing is a `streams` row with kind='wing': a band of classes carrying a
  // subject set, never attached to classes.stream_id.
  const [streamKind, setStreamKind] = useState<"stream" | "wing">("stream");
  const [streamClassNames, setStreamClassNames] = useState<string[]>([]);
  const [editStreamClassNames, setEditStreamClassNames] = useState<string[]>([]);
  const [applyWing, setApplyWing] = useState<StreamWithSubjects | null>(null);

  // Manage stream subjects dialog
  const [manageStreamSubjectsOpen, setManageStreamSubjectsOpen] = useState(false);
  const [managingStream, setManagingStream] = useState<StreamWithSubjects | null>(null);
  const [selectedStreamSubjects, setSelectedStreamSubjects] = useState<
    Map<string, { checked: boolean; is_mandatory: boolean }>
  >(new Map());
  const [streamSubjectsSubmitting, setStreamSubjectsSubmitting] = useState(false);

  // ── Manage-a-whole-class dialog ──
  const [classSubjectsOpen, setClassSubjectsOpen] = useState(false);
  const [manageClassId, setManageClassId] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Teachers tab (migration 117) ──
  // teacher_id → the subject ids they are qualified to teach.
  const [teacherSubjectMap, setTeacherSubjectMap] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [teacherSubjectsLoading, setTeacherSubjectsLoading] = useState(true);
  const [teacherFilterSubjectId, setTeacherFilterSubjectId] = useState("");
  const [showRetiredTeachers, setShowRetiredTeachers] = useState(false);
  const [manageTeacherSubjectsOpen, setManageTeacherSubjectsOpen] =
    useState(false);
  const [managingTeacher, setManagingTeacher] =
    useState<TeacherSubjectRow | null>(null);
  const [selectedTeacherSubjects, setSelectedTeacherSubjects] = useState<
    Set<string>
  >(new Set());
  const [teacherSubjectsSubmitting, setTeacherSubjectsSubmitting] =
    useState(false);

  // ── Quick Setup & Bulk Upload state ──
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const showQuickSetupWizard = useMountOnceOpen(quickSetupOpen);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const showSubjectBulkUpload = useMountOnceOpen(bulkUploadOpen);

  // §6 Math Standard/Basic review banner — names the classes still to reassign
  const [mathReviewClasses, setMathReviewClasses] = useState<string[]>([]);

  // ══════════════════════════════════════════════
  // Data Fetching
  // ══════════════════════════════════════════════

  const fetchSubjects = useCallback(async () => {
    const { data, error } = await supabase
      .from("subjects")
      .select("*")
      .order("name");

    if (error) {
      toast.error("Failed to fetch subjects");
      // Still clear the flag — leaving it set renders a spinner forever with
      // no way back except a reload.
      setSubjectsLoading(false);
      return;
    }

    setSubjects((data as Subject[]) ?? []);
    setSubjectsLoading(false);
  }, [supabase]);

  // §6: Look for the generic "Mathematics" subject still linked to Class X.
  //
  // Class X is the only place the split applies — that is where CBSE splits
  // Mathematics into Standard (041) and Basic (241) for the board exam. Class
  // IX teaches one common Mathematics, and in XI–XII the pair is Mathematics
  // (041) / Applied Mathematics (241), where plain "Mathematics" is the correct
  // name. Flagging IX–XII, as this once did, marks correct rows as broken and
  // leaves the banner permanently unclearable.
  //
  // We never auto-reassign; the admin picks Standard or Basic per class.
  const fetchMathReviewState = useCallback(async () => {
    const { data: plainMath } = await supabase
      .from("subjects")
      .select("id")
      .ilike("name", "Mathematics")
      .limit(1)
      .maybeSingle();
    if (!plainMath?.id) {
      setMathReviewClasses([]);
      return;
    }
    const { data: linked } = await supabase
      .from("class_subjects")
      .select("id, classes!inner(name, section)")
      .eq("subject_id", plainMath.id);
    const names = (linked ?? []).flatMap((row) => {
      const raw = (row as unknown as {
        classes: { name: string; section: string | null } | { name: string; section: string | null }[] | null;
      }).classes;
      const cls = Array.isArray(raw) ? raw[0] : raw;
      if (cls?.name !== "X") return [];
      return [cls.section ? `${cls.name}-${cls.section}` : cls.name];
    });
    setMathReviewClasses(names.sort());
  }, [supabase]);

  const session = useAcademicSession();
  const sessionId = session.sessionId;

  const fetchAssignmentsData = useCallback(async () => {
    // Classes and subject assignments are both year-scoped, so this follows
    // the session picker rather than being pinned to the is_current flag.
    let yearQuery = supabase.from("academic_years").select("id");
    yearQuery = sessionId
      ? yearQuery.eq("id", sessionId)
      : yearQuery.eq("is_current", true);
    const { data: currentYear } = await yearQuery.maybeSingle();

    const yearId = (currentYear?.id as string | undefined) ??
      "00000000-0000-0000-0000-000000000000";

    const [classesRes, subjectsRes, teachersRes] = await Promise.all([
      supabase
        .from("classes")
        .select("*, streams:stream_id(name)")
        .eq("academic_year_id", yearId)
        .order("sort_order"),
      supabase
        .from("subjects")
        .select("*")
        .eq("is_active", true)
        .order("name"),
      // Retired teachers included on purpose: an assignment saved before they
      // left still names them, and dropping them would render the Select blank
      // and let the next save clear the teacher. The option builders below
      // keep them unpickable. (migration 116)
      supabase.from("teachers").select("*").order("full_name"),
    ]);

    setClasses((classesRes.data as Class[]) ?? []);
    setActiveSubjects((subjectsRes.data as Subject[]) ?? []);
    setTeachers((teachersRes.data as Teacher[]) ?? []);

    // Fetch all class-subject assignments with joins
    const { data: csData } = await supabase
      .from("class_subjects")
      .select(
        "id, class_id, subject_id, teacher_id, classes(name, section, sort_order, streams:stream_id(name)), subjects(name, code), teachers:teacher_id(full_name, employee_id)"
      )
      .in(
        "class_id",
        (classesRes.data ?? []).map((c: Class) => c.id)
      );

    // Fetch student enrollment counts per class (students enrolled in each class)
    const { data: enrollmentData } = await supabase
      .from("student_enrollments")
      .select("class_id")
      .eq("status", "active")
      .eq("academic_year_id", yearId);

    const enrollmentCountMap: Record<string, number> = {};
    if (enrollmentData) {
      for (const row of enrollmentData) {
        enrollmentCountMap[row.class_id] = (enrollmentCountMap[row.class_id] ?? 0) + 1;
      }
    }

    const rows: AssignmentRow[] = (csData ?? []).map(
      (cs: Record<string, unknown>) => ({
        id: cs.id as string,
        class_id: cs.class_id as string,
        subject_id: cs.subject_id as string,
        teacher_id: cs.teacher_id as string | null,
        class_name: (cs.classes as { name: string } | null)?.name ?? "—",
        class_section: (cs.classes as { section: string } | null)?.section ?? "",
        class_sort: (cs.classes as { sort_order: number } | null)?.sort_order ?? 0,
        stream_name: (cs.classes as { streams?: { name: string } | null } | null)?.streams?.name ?? null,
        subject_name: (cs.subjects as { name: string } | null)?.name ?? "Unknown",
        subject_code: (cs.subjects as { code: string | null } | null)?.code ?? null,
        teacher_name: (cs.teachers as { full_name: string; employee_id: string } | null)?.full_name ?? null,
        student_count: enrollmentCountMap[cs.class_id as string] ?? 0,
      })
    );

    // Sort by class sort_order, then subject name
    rows.sort((a, b) => {
      if (a.class_sort !== b.class_sort) return a.class_sort - b.class_sort;
      return a.subject_name.localeCompare(b.subject_name);
    });

    setAssignments(rows);
    setAssignmentsLoading(false);
  }, [supabase, sessionId]);

  const fetchStreams = useCallback(async () => {
    const { data: streamsData, error } = await supabase
      .from("streams")
      .select("*")
      .order("sort_order");

    if (error) {
      toast.error("Failed to fetch streams");
      setStreamsLoading(false);
      return;
    }

    const streamsList = (streamsData as Stream[]) ?? [];

    // Stream subject links, plus everything else that points at a stream.
    // The stream FK is ON DELETE SET NULL, so deleting a stream that classes
    // or fee rows still reference would silently strand them — the counts have
    // to be on screen before the delete button is.
    const [{ data: ssData }, { data: classRows }, { data: feeRows }] =
      await Promise.all([
        supabase
          .from("stream_subjects")
          .select("id, stream_id, subject_id, is_mandatory, subjects(name, code)"),
        supabase.from("classes").select("stream_id"),
        supabase.from("fee_structures").select("stream_id"),
      ]);

    const streamSubjectMap: Record<string, StreamWithSubjects["subjects"]> = {};
    if (ssData) {
      for (const ss of ssData as Array<Record<string, unknown>>) {
        const streamId = ss.stream_id as string;
        if (!streamSubjectMap[streamId]) {
          streamSubjectMap[streamId] = [];
        }
        streamSubjectMap[streamId].push({
          id: ss.subject_id as string,
          stream_subject_id: ss.id as string,
          name: (ss.subjects as { name: string } | null)?.name ?? "Unknown",
          code: (ss.subjects as { code: string | null } | null)?.code ?? null,
          is_mandatory: ss.is_mandatory as boolean,
        });
      }
    }

    const enrichedStreams: StreamWithSubjects[] = streamsList.map((s) => ({
      ...s,
      subjects: streamSubjectMap[s.id] ?? [],
    }));

    const usage: Record<string, StreamUsage> = {};
    const bump = (id: string | null, key: keyof StreamUsage) => {
      if (!id) return;
      usage[id] ??= { classes: 0, subjects: 0, fee_structures: 0 };
      usage[id][key] += 1;
    };
    for (const c of (classRows ?? []) as Array<{ stream_id: string | null }>)
      bump(c.stream_id, "classes");
    for (const ss of (ssData ?? []) as unknown as Array<{ stream_id: string | null }>)
      bump(ss.stream_id, "subjects");
    for (const f of (feeRows ?? []) as Array<{ stream_id: string | null }>)
      bump(f.stream_id, "fee_structures");

    setStreams(enrichedStreams);
    setStreamUsage(usage);
    setStreamsLoading(false);
  }, [supabase]);

  // Which subjects each teacher is qualified to teach (migration 117). Only
  // the join rows are fetched — the teacher roster itself already arrives with
  // fetchAssignmentsData, and subject names come from `activeSubjects`.
  const fetchTeacherSubjects = useCallback(async () => {
    const { data, error } = await supabase
      .from("teacher_subjects")
      .select("teacher_id, subject_id");

    if (error) {
      // A deployment that has not run migration 117 yet should still be able
      // to use the other three tabs, so this is not a blocking failure.
      console.error("Failed to fetch teacher subjects:", error);
      setTeacherSubjectsLoading(false);
      return;
    }

    const map = new Map<string, Set<string>>();
    for (const row of data ?? []) {
      const set = map.get(row.teacher_id) ?? new Set<string>();
      set.add(row.subject_id);
      map.set(row.teacher_id, set);
    }
    setTeacherSubjectMap(map);
    setTeacherSubjectsLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchSubjects();
    fetchAssignmentsData();
    fetchStreams();
    fetchMathReviewState();
    fetchTeacherSubjects();
  }, [
    fetchSubjects,
    fetchAssignmentsData,
    fetchStreams,
    fetchMathReviewState,
    fetchTeacherSubjects,
  ]);

  // ══════════════════════════════════════════════
  // Subject CRUD
  // ══════════════════════════════════════════════

  const resetSubjectForm = () => {
    setName("");
    setCode("");
    setNickname("");
    setCategory("");
    setIsElective(false);
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Subject name is required");
      return;
    }
    if (!category) {
      toast.error("Category is required");
      return;
    }
    setSubmitting(true);

    const result = await adminApi({
      action: "insert",
      table: "subjects",
      data: {
        name: name.trim(),
        code: code.trim() || null,
        nickname: nickname.trim() || null,
        category,
        is_active: true,
        is_elective: isElective,
      },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to create subject");
    } else {
      toast.success("Subject created successfully");
      setSubjectDialogOpen(false);
      resetSubjectForm();
      await fetchSubjects();
      await fetchAssignmentsData();
    }

    setSubmitting(false);
  };

  const openEditDialog = (subject: Subject) => {
    setEditingSubject(subject);
    setEditName(subject.name);
    setEditCode(subject.code || "");
    setEditNickname(subject.nickname || "");
    setEditCategory(subject.category ?? "");
    setEditIsElective(subject.is_elective);
    setEditDialogOpen(true);
  };

  const handleEditSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubject) return;
    if (!editName.trim()) {
      toast.error("Subject name is required");
      return;
    }
    if (!editCategory) {
      toast.error("Category is required");
      return;
    }
    setSubmitting(true);

    const result = await adminApi({
      action: "update",
      table: "subjects",
      data: {
        name: editName.trim(),
        code: editCode.trim() || null,
        nickname: editNickname.trim() || null,
        category: editCategory,
        is_elective: editIsElective,
      },
      match: { column: "id", value: editingSubject.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to update subject");
    } else {
      toast.success("Subject updated successfully");
      setEditDialogOpen(false);
      setEditingSubject(null);
      await fetchSubjects();
      await fetchAssignmentsData();
    }

    setSubmitting(false);
  };

  const toggleActive = async (subject: Subject) => {
    const result = await adminApi({
      action: "update",
      table: "subjects",
      data: { is_active: !subject.is_active },
      match: { column: "id", value: subject.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to update subject");
      return;
    }

    toast.success(
      subject.is_active ? "Subject deactivated" : "Subject activated"
    );
    await fetchSubjects();
    await fetchAssignmentsData();
  };

  // Deleting a subject fans out through ten foreign keys, so the admin sees
  // what it costs before confirming rather than a bare failure afterwards.
  // The proxy enforces the same rule server-side — this is only the message.
  const handleDeleteSubject = async (subject: Subject) => {
    setDeletingSubjectId(subject.id);
    const deps = await fetchRowDependencies("subjects", subject.id);
    setDeletingSubjectId(null);

    if (deps && deps.blockingTotal > 0) {
      toast.error(
        `"${subject.name}" has ${describeDependencies(deps.blocking)} recorded against it. Deleting it would erase them — deactivate the subject instead.`,
        { duration: 10000 }
      );
      return;
    }

    const willRemove = deps ? describeDependencies(deps.cascade) : "";
    const consequence = willRemove
      ? `This also removes ${willRemove}.`
      : "This also removes its class assignments, stream links and timetable periods.";
    if (!confirm(`Delete the subject "${subject.name}"?\n\n${consequence}\n\nThis cannot be undone.`))
      return;

    setDeletingSubjectId(subject.id);
    const result = await adminApi({
      action: "delete",
      table: "subjects",
      match: { column: "id", value: subject.id },
    });
    setDeletingSubjectId(null);

    if (!result.success) {
      toast.error(result.error || "Failed to delete subject", { duration: 10000 });
      return;
    }

    toast.success("Subject deleted");
    await fetchSubjects();
    await fetchAssignmentsData();
    await fetchStreams();
  };

  // ══════════════════════════════════════════════
  // Assignment Handlers
  // ══════════════════════════════════════════════

  const handleRemoveAssignment = async (row: AssignmentRow) => {
    if (
      !confirm(
        `Remove ${row.subject_name} from ${formatClassName({ name: row.class_name, section: row.class_section, stream_name: row.stream_name })}? This will also remove all student-subject links.`
      )
    )
      return;

    const result = await adminApi({
      action: "delete",
      table: "class_subjects",
      match: { column: "id", value: row.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to remove the assignment");
      return;
    }

    toast.success("Subject removed from class");
    await fetchAssignmentsData();
  };

  const openEditTeacherDialog = (row: AssignmentRow) => {
    setEditTeacherRow(row);
    setEditTeacherValue(row.teacher_id || "none");
    setEditTeacherShowAll(false);
    setEditTeacherDialogOpen(true);
  };

  const handleUpdateTeacher = async () => {
    if (!editTeacherRow) return;
    setEditTeacherSubmitting(true);

    const teacherId = editTeacherValue === "none" ? null : editTeacherValue;

    const result = await adminApi({
      action: "update",
      table: "class_subjects",
      data: { teacher_id: teacherId },
      match: { column: "id", value: editTeacherRow.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to update teacher");
    } else {
      toast.success("Teacher updated");
      setEditTeacherDialogOpen(false);
      setEditTeacherRow(null);
      await fetchAssignmentsData();
    }
    setEditTeacherSubmitting(false);
  };


  // ── Header sort/filter accessors ──
  // Each mirrors what the matching cell renders.
  const subjectColumns = useMemo<TableColumns<Subject>>(
    () => ({
      name: { label: "Name", value: (s) => s.name, filter: "text" },
      code: { label: "Code", value: (s) => s.code || null, filter: "text" },
      nickname: {
        label: "Nickname",
        value: (s) => s.nickname || null,
        filter: "text",
      },
      category: {
        label: "Category",
        value: (s) =>
          s.category === "languages"
            ? "Languages"
            : s.category === "academic"
              ? "Academic"
              : s.category
                ? "Co-curricular"
                : "Uncategorized",
      },
      type: {
        label: "Type",
        value: (s) => (s.is_elective ? "Elective" : "Core"),
      },
      status: {
        label: "Status",
        value: (s) => (s.is_active ? "Active" : "Inactive"),
      },
    }),
    []
  );

  const assignmentColumns = useMemo<TableColumns<AssignmentRow>>(
    () => ({
      class: {
        label: "Class",
        value: (a) =>
          formatClassName({
            name: a.class_name,
            section: a.class_section,
            stream_name: a.stream_name,
          }),
        sortValue: (a) => a.class_sort,
      },
      subject: {
        label: "Subject",
        value: (a) => a.subject_name,
        filter: "text",
      },
      code: {
        label: "Code",
        value: (a) => a.subject_code,
        filter: "text",
      },
      teacher: {
        label: "Teacher",
        value: (a) => a.teacher_name,
        emptyLabel: "Not assigned",
      },
      students: {
        label: "Students",
        value: (a) => a.student_count,
        filter: "none",
      },
    }),
    []
  );

  // The category chips above the subjects table pre-filter the rows the
  // header controls then sort and narrow further.
  const categorySubjects = useMemo(
    () =>
      subjects.filter((s) => {
        if (categoryFilter === "all") return true;
        if (categoryFilter === "uncategorized") return !s.category;
        return s.category === categoryFilter;
      }),
    [subjects, categoryFilter]
  );

  const subjectTable = useTableControls({
    rows: categorySubjects,
    columns: subjectColumns,
  });

  // ── Filtered assignments ──
  const filteredAssignments = useMemo(() => {
    return assignments.filter((a) => {
      if (filterClassId && a.class_id !== filterClassId) return false;
      if (filterSubjectId && a.subject_id !== filterSubjectId) return false;
      if (filterTeacherId) {
        if (filterTeacherId === "unassigned") {
          if (a.teacher_id !== null) return false;
        } else {
          if (a.teacher_id !== filterTeacherId) return false;
        }
      }
      return true;
    });
  }, [assignments, filterClassId, filterSubjectId, filterTeacherId]);


  const assignmentTable = useTableControls({
    rows: filteredAssignments,
    columns: assignmentColumns,
  });

  // Unique subjects appearing in assignments (for filter dropdown)
  const subjectsInAssignments = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const a of assignments) {
      if (!seen.has(a.subject_id)) {
        seen.set(a.subject_id, { id: a.subject_id, name: a.subject_name });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [assignments]);

  // Unique teachers in assignments (for filter dropdown)
  const teachersInAssignments = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const a of assignments) {
      if (a.teacher_id && a.teacher_name && !seen.has(a.teacher_id)) {
        seen.set(a.teacher_id, { id: a.teacher_id, name: a.teacher_name });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [assignments]);

  const hasActiveFilters = filterClassId || filterSubjectId || filterTeacherId;

  // ══════════════════════════════════════════════
  // Stream CRUD
  // ══════════════════════════════════════════════

  // Two streams sharing a name make every stream dropdown ambiguous, and the
  // historical importers match on name — a duplicate would silently split one
  // stream's data across two rows.
  const duplicateStream = (name: string, ignoreId?: string) =>
    streams.find(
      (s) =>
        s.id !== ignoreId && s.name.trim().toLowerCase() === name.toLowerCase()
    );

  const handleCreateStream = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = streamName.trim();
    if (!name) {
      toast.error("Stream name is required");
      return;
    }
    const clash = duplicateStream(name);
    if (clash) {
      toast.error(`A stream named "${clash.name}" already exists`);
      return;
    }
    setStreamSubmitting(true);

    const result = await adminApi({
      action: "insert",
      table: "streams",
      data: {
        name,
        code: streamCode.trim() || null,
        is_active: true,
        sort_order: Number(streamSortOrder) || 0,
        kind: streamKind,
        // A stream's band is always empty — it reaches classes through
        // classes.stream_id instead. (migration 118)
        class_names: streamKind === "wing" ? streamClassNames : [],
      },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to create stream");
    } else {
      toast.success("Stream created");
      setStreamDialogOpen(false);
      setStreamName("");
      setStreamCode("");
      setStreamSortOrder(0);
      await fetchStreams();
    }
    setStreamSubmitting(false);
  };

  const openEditStreamDialog = (stream: StreamWithSubjects) => {
    setEditingStream(stream);
    setEditStreamName(stream.name);
    setEditStreamCode(stream.code || "");
    setEditStreamSortOrder(stream.sort_order ?? 0);
    setEditStreamClassNames(stream.class_names ?? []);
    setEditStreamDialogOpen(true);
  };

  const handleEditStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStream) return;
    const name = editStreamName.trim();
    if (!name) {
      toast.error("Stream name is required");
      return;
    }
    const clash = duplicateStream(name, editingStream.id);
    if (clash) {
      toast.error(`A stream named "${clash.name}" already exists`);
      return;
    }
    setStreamSubmitting(true);

    const result = await adminApi({
      action: "update",
      table: "streams",
      data: {
        name,
        code: editStreamCode.trim() || null,
        sort_order: Number(editStreamSortOrder) || 0,
        // kind is not editable: a stream that became a wing would keep any
        // classes and fee rows already pointing at it, which is the leak the
        // discriminator exists to prevent. Delete and recreate instead.
        ...(editingStream.kind === "wing"
          ? { class_names: editStreamClassNames }
          : {}),
      },
      match: { column: "id", value: editingStream.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to update stream");
    } else {
      toast.success("Stream updated");
      setEditStreamDialogOpen(false);
      setEditingStream(null);
      await fetchStreams();
    }
    setStreamSubmitting(false);
  };

  const handleDeleteStream = async (stream: StreamWithSubjects) => {
    // The FKs into streams are ON DELETE SET NULL, so this never fails loudly
    // — it just blanks the stream on every class, enrolment and fee row that
    // used it. Check first and say so.
    const deps = await fetchRowDependencies("streams", stream.id);
    if (deps && deps.blockingTotal > 0) {
      toast.error(
        `"${stream.name}" is still used by ${describeDependencies(deps.blocking)}. Deactivate it instead — deleting would strand those records.`,
        { duration: 10000 }
      );
      return;
    }

    const willRemove = deps ? describeDependencies(deps.cascade) : "";
    if (
      !confirm(
        `Delete the stream "${stream.name}"?${willRemove ? `\n\nThis also removes ${willRemove}.` : ""}\n\nThis cannot be undone.`
      )
    )
      return;

    const result = await adminApi({
      action: "delete",
      table: "streams",
      match: { column: "id", value: stream.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to delete stream", { duration: 10000 });
      return;
    }

    toast.success("Stream deleted");
    await fetchStreams();
  };

  const toggleStreamActive = async (stream: StreamWithSubjects) => {
    const result = await adminApi({
      action: "update",
      table: "streams",
      data: { is_active: !stream.is_active },
      match: { column: "id", value: stream.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to update stream");
      return;
    }

    toast.success(stream.is_active ? "Stream deactivated" : "Stream activated");
    await fetchStreams();
  };

  // ── Manage stream subjects ──

  const openManageStreamSubjects = (stream: StreamWithSubjects) => {
    setManagingStream(stream);
    const map = new Map<string, { checked: boolean; is_mandatory: boolean }>();
    // Pre-populate with existing stream subjects
    for (const ss of stream.subjects) {
      map.set(ss.id, { checked: true, is_mandatory: ss.is_mandatory });
    }
    setSelectedStreamSubjects(map);
    setManageStreamSubjectsOpen(true);
  };

  const toggleStreamSubject = (subjectId: string) => {
    setSelectedStreamSubjects((prev) => {
      const next = new Map(prev);
      const existing = next.get(subjectId);
      if (existing) {
        next.delete(subjectId);
      } else {
        next.set(subjectId, { checked: true, is_mandatory: true });
      }
      return next;
    });
  };

  const toggleStreamSubjectMandatory = (subjectId: string) => {
    setSelectedStreamSubjects((prev) => {
      const next = new Map(prev);
      const existing = next.get(subjectId);
      if (existing) {
        next.set(subjectId, {
          ...existing,
          is_mandatory: !existing.is_mandatory,
        });
      }
      return next;
    });
  };

  const handleSaveStreamSubjects = async () => {
    if (!managingStream) return;
    setStreamSubjectsSubmitting(true);

    const currentSubjectIds = new Set(
      managingStream.subjects.map((s) => s.id)
    );
    const newSubjectIds = new Set(selectedStreamSubjects.keys());

    // Subjects to add
    const toAdd = [...newSubjectIds].filter((id) => !currentSubjectIds.has(id));
    // Subjects to remove
    const toRemove = [...currentSubjectIds].filter(
      (id) => !newSubjectIds.has(id)
    );
    // Subjects to update (mandatory flag changed)
    const toUpdate = [...newSubjectIds].filter((id) => {
      if (!currentSubjectIds.has(id)) return false;
      const existing = managingStream.subjects.find((s) => s.id === id);
      const updated = selectedStreamSubjects.get(id);
      return existing && updated && existing.is_mandatory !== updated.is_mandatory;
    });

    let hasError = false;

    // Add new stream-subject links (write both is_mandatory and §4 requirement_type)
    for (const subjectId of toAdd) {
      const entry = selectedStreamSubjects.get(subjectId);
      const isMandatory = entry?.is_mandatory ?? true;
      const result = await adminApi({
        action: "insert",
        table: "stream_subjects",
        data: {
          stream_id: managingStream.id,
          subject_id: subjectId,
          is_mandatory: isMandatory,
          requirement_type: isMandatory ? "compulsory" : "elective",
        },
      });
      if (!result.success) {
        hasError = true;
        toast.error(`Failed to add subject`);
      }
    }

    // Remove stream-subject links
    for (const subjectId of toRemove) {
      const streamSubject = managingStream.subjects.find(
        (s) => s.id === subjectId
      );
      if (streamSubject) {
        const result = await adminApi({
          action: "delete",
          table: "stream_subjects",
          match: { column: "id", value: streamSubject.stream_subject_id },
        });
        if (!result.success) {
          hasError = true;
          toast.error(`Failed to remove subject`);
        }
      }
    }

    // Update requirement type (mirrored to is_mandatory for back-compat)
    for (const subjectId of toUpdate) {
      const streamSubject = managingStream.subjects.find(
        (s) => s.id === subjectId
      );
      const updated = selectedStreamSubjects.get(subjectId);
      if (streamSubject && updated) {
        const result = await adminApi({
          action: "update",
          table: "stream_subjects",
          data: {
            is_mandatory: updated.is_mandatory,
            requirement_type: updated.is_mandatory ? "compulsory" : "elective",
          },
          match: { column: "id", value: streamSubject.stream_subject_id },
        });
        if (!result.success) {
          hasError = true;
          toast.error(`Failed to update subject`);
        }
      }
    }

    if (!hasError) {
      toast.success("Stream subjects updated");
    }

    setManageStreamSubjectsOpen(false);
    setManagingStream(null);
    await fetchStreams();
    setStreamSubjectsSubmitting(false);
  };

  // Only active teachers are pickable, but a dialog editing an existing
  // assignment must still show whoever it already names — otherwise the Select
  // renders blank and saving silently clears the teacher. (migration 116)
  const activeTeachers = useMemo(
    () => teachers.filter((t) => t.is_active),
    [teachers]
  );
  // Changing the teacher on a Maths row should surface the maths teachers
  // first, exactly as the class dialog does. An ordering, not a filter: the
  // rest stay one click away behind "Show all", or are listed outright when
  // nobody is mapped to the subject yet. (migration 117)
  const [editTeacherShowAll, setEditTeacherShowAll] = useState(false);

  const editTeacherSplit = useMemo(() => {
    const subjectId = editTeacherRow?.subject_id ?? "";
    const qualified: Teacher[] = [];
    const others: Teacher[] = [];
    for (const t of activeTeachers) {
      if (subjectId && teacherSubjectMap.get(t.id)?.has(subjectId))
        qualified.push(t);
      else others.push(t);
    }
    const currentId = editTeacherValue === "none" ? "" : editTeacherValue;
    const retained =
      currentId && !activeTeachers.some((t) => t.id === currentId)
        ? teachers.find((t) => t.id === currentId)
        : undefined;
    return { qualified, others, retained };
  }, [
    activeTeachers,
    teachers,
    teacherSubjectMap,
    editTeacherRow,
    editTeacherValue,
  ]);

  const editTeacherShowOthers =
    editTeacherShowAll || editTeacherSplit.qualified.length === 0;

  const editTeacherChoices = useMemo(() => {
    const { qualified, others, retained } = editTeacherSplit;
    return [
      ...qualified.map((t) => ({ value: t.id, label: teacherLabel(t) })),
      ...(editTeacherShowOthers
        ? others.map((t) => ({ value: t.id, label: teacherLabel(t) }))
        : []),
      ...(retained
        ? [{ value: retained.id, label: `${teacherLabel(retained)} — inactive` }]
        : []),
    ];
  }, [editTeacherSplit, editTeacherShowOthers]);

  // ── Streams vs wings ──
  // One table, two meanings (migration 118). Rows written before the migration
  // have kind defaulted to 'stream', so the absence of the column reads as a
  // stream — which is what it was.
  const academicStreams = useMemo(
    () => streams.filter((s) => s.kind !== "wing"),
    [streams]
  );
  const wings = useMemo(
    () => streams.filter((s) => s.kind === "wing"),
    [streams]
  );

  // How many sections each class name has this year, so the band picker can
  // show "VI · 3 sections" and flag a band that would apply to nothing.
  const sectionCountsByClassName = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of classes) m.set(c.name, (m.get(c.name) ?? 0) + 1);
    return m;
  }, [classes]);

  // ── Class-first view: what each class has, for the "manage by class" panel ──
  const assignmentsByClass = useMemo(() => {
    const m = new Map<
      string,
      { subject_count: number; unassigned: number }
    >();
    for (const c of classes) m.set(c.id, { subject_count: 0, unassigned: 0 });
    for (const a of assignments) {
      const entry = m.get(a.class_id);
      if (!entry) continue;
      entry.subject_count++;
      if (!a.teacher_id) entry.unassigned++;
    }
    return m;
  }, [classes, assignments]);

  // What the managed class currently has, in the shape the dialog wants.
  const manageClassAssignments = useMemo(
    () =>
      assignments
        .filter((a) => a.class_id === manageClassId)
        .map((a) => ({
          id: a.id,
          subject_id: a.subject_id,
          teacher_id: a.teacher_id,
        })),
    [assignments, manageClassId]
  );

  const manageClassLabel = useMemo(() => {
    const c = classes.find((c) => c.id === manageClassId);
    return c ? formatClassName(c) : "";
  }, [classes, manageClassId]);

  const openClassSubjects = (classId: string) => {
    setManageClassId(classId);
    setClassSubjectsOpen(true);
  };

  // ══════════════════════════════════════════════
  // Teachers tab — who can teach what (migration 117)
  // ══════════════════════════════════════════════

  const subjectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of activeSubjects) m.set(s.id, s.name);
    return m;
  }, [activeSubjects]);

  const teacherSubjectRows = useMemo<TeacherSubjectRow[]>(() => {
    return teachers
      .filter((t) => showRetiredTeachers || t.is_active)
      .filter((t) => {
        if (!teacherFilterSubjectId) return true;
        if (teacherFilterSubjectId === "none") {
          return (teacherSubjectMap.get(t.id)?.size ?? 0) === 0;
        }
        return teacherSubjectMap.get(t.id)?.has(teacherFilterSubjectId) ?? false;
      })
      .map((t) => {
        const ids = [...(teacherSubjectMap.get(t.id) ?? [])];
        // A subject the teacher is linked to but which has since been
        // deactivated has no name in `activeSubjects`. Keep the id out of the
        // display rather than rendering "undefined"; unticking it is still
        // possible from the dialog, which lists active subjects only.
        const names = ids
          .map((id) => subjectNameById.get(id))
          .filter((n): n is string => !!n)
          .sort((a, b) => a.localeCompare(b));
        return {
          id: t.id,
          full_name: t.full_name,
          employee_id: t.employee_id,
          is_active: t.is_active,
          subject_ids: ids,
          subject_names: names,
        };
      });
  }, [
    teachers,
    teacherSubjectMap,
    subjectNameById,
    teacherFilterSubjectId,
    showRetiredTeachers,
  ]);

  const teacherColumns = useMemo<TableColumns<TeacherSubjectRow>>(
    () => ({
      teacher: { label: "Teacher", value: (t) => t.full_name, filter: "text" },
      employee_id: {
        label: "Employee ID",
        value: (t) => t.employee_id,
        filter: "text",
      },
      subjects: {
        label: "Subjects",
        value: (t) => t.subject_names.join(", ") || null,
        emptyLabel: "None yet",
        filter: "none",
      },
      count: {
        label: "Count",
        value: (t) => t.subject_names.length,
        filter: "none",
      },
    }),
    []
  );

  const teacherTable = useTableControls({
    rows: teacherSubjectRows,
    columns: teacherColumns,
  });

  const openManageTeacherSubjects = (row: TeacherSubjectRow) => {
    setManagingTeacher(row);
    setSelectedTeacherSubjects(new Set(row.subject_ids));
    setManageTeacherSubjectsOpen(true);
  };

  const toggleTeacherSubject = (subjectId: string) => {
    setSelectedTeacherSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  };

  // Diff-and-save, mirroring handleSaveStreamSubjects. Rows are only added or
  // removed — there is nothing else on the join row to update.
  const handleSaveTeacherSubjects = async () => {
    if (!managingTeacher) return;
    setTeacherSubjectsSubmitting(true);

    const before = new Set(managingTeacher.subject_ids);
    const after = selectedTeacherSubjects;
    const toAdd = [...after].filter((id) => !before.has(id));
    const toRemove = [...before].filter((id) => !after.has(id));

    let hasError = false;

    for (const subjectId of toAdd) {
      const result = await adminApi({
        action: "insert",
        table: "teacher_subjects",
        data: { teacher_id: managingTeacher.id, subject_id: subjectId },
      });
      if (!result.success) {
        hasError = true;
        toast.error(
          `Failed to add ${subjectNameById.get(subjectId) ?? "subject"}`
        );
      }
    }

    // adminApi matches on a single column, so a delete is scoped by looking
    // the join row up first — the pair is unique, so this is exact.
    for (const subjectId of toRemove) {
      const { data: joinRow } = await supabase
        .from("teacher_subjects")
        .select("id")
        .eq("teacher_id", managingTeacher.id)
        .eq("subject_id", subjectId)
        .maybeSingle();
      if (!joinRow) continue;
      const result = await adminApi({
        action: "delete",
        table: "teacher_subjects",
        match: { column: "id", value: joinRow.id },
      });
      if (!result.success) {
        hasError = true;
        toast.error(
          `Failed to remove ${subjectNameById.get(subjectId) ?? "subject"}`
        );
      }
    }

    if (!hasError) toast.success("Teacher subjects updated");

    setManageTeacherSubjectsOpen(false);
    setManagingTeacher(null);
    await fetchTeacherSubjects();
    setTeacherSubjectsSubmitting(false);
  };

  // ══════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="erp-page-bar">
        <div className="flex items-center gap-3">
          <div className="erp-page-icon">
            <BookOpen className="h-4.5 w-4.5 text-gold-400" />
          </div>
          <div>
            <h1 className="erp-page-title">Subjects &amp; Assignments</h1>
            <p className="erp-page-subtitle">
              Manage subjects, class assignments, and academic streams
            </p>
          </div>
        </div>
        {/* Class assignments and streams are year-scoped; the subject
            catalogue and the teacher-subject mapping are not. An allow-list
            rather than `tab !== "subjects"`, so adding a tab does not silently
            give it a year picker it has no use for. */}
        {(tab === "assignments" || tab === "streams") && (
          <AcademicSessionPicker state={session} />
        )}
        {tab === "subjects" && (
          <div className="erp-page-actions">
            <Button
              variant="outline"
              onClick={() => setQuickSetupOpen(true)}
              className="border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Quick Setup
            </Button>
            <Button
              onClick={() => {
                resetSubjectForm();
                setSubjectDialogOpen(true);
              }}
              className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Subject
            </Button>
          </div>
        )}
        {tab === "assignments" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkUploadOpen(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Excel
            </Button>
          </div>
        )}
        {tab === "streams" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStreamKind("wing");
                setStreamName("");
                setStreamCode("");
                setStreamClassNames([]);
                setStreamSortOrder(
                  streams.length
                    ? Math.max(...streams.map((s) => s.sort_order ?? 0)) + 1
                    : 0
                );
                setStreamDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Wing
            </Button>
            <Button
              onClick={() => {
                setStreamKind("stream");
                setStreamName("");
                setStreamCode("");
                setStreamClassNames([]);
                setStreamSortOrder(
                  streams.length
                    ? Math.max(...streams.map((s) => s.sort_order ?? 0)) + 1
                    : 0
                );
                setStreamDialogOpen(true);
              }}
              className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Stream
            </Button>
          </div>
        )}
      </div>

      {/* Tab toggle.
          This was four hand-written buttons in a `w-fit` strip with the
          scrollbar hidden. Four tabs need about 600px; a phone has 375, so
          Teacher Subjects sat off the right edge with nothing to say it was
          there — the page appeared to have three tabs. A 2×2 grid below `sm`
          shows all four at once. */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 sm:flex sm:w-fit sm:items-center dark:bg-muted"> {/* mobile-layout-ok: 2x2 below sm, a row above — four short tab labels */}
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={cn(
              "flex min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 sm:justify-start sm:px-4",
              tab === id
                ? "bg-white dark:bg-card text-navy-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════ */}
      {/* Subjects Tab                                    */}
      {/* ════════════════════════════════════════════════ */}
      {tab === "subjects" && (
        <div className="erp-table-container p-4 sm:p-6">
          {/* §6 Math review banner */}
          {mathReviewClasses.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-300">
              <strong>Action needed:</strong> {mathReviewClasses.join(", ")}{" "}
              {mathReviewClasses.length === 1 ? "is" : "are"} still carrying the
              generic <span className="font-mono">Mathematics</span> subject. From
              Class X, CBSE splits it into Standard (041) and Basic (241) for the
              board exam — reassign each class to the variant it offers, in the
              Class Assignments tab. These are not migrated automatically.
            </div>
          )}

          {/* §8 category filter */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-gray-500">Filter by category:</span>
            {(["all","languages","academic","co_curricular","uncategorized"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  categoryFilter === c
                    ? "bg-navy-900 text-white"
                    : "bg-gray-100 dark:bg-muted text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-muted/70"
                }`}
              >
                {c === "all" ? "All" :
                 c === "languages" ? "Languages" :
                 c === "academic" ? "Academic" :
                 c === "co_curricular" ? "Co-curricular" :
                 "Uncategorized"}
              </button>
            ))}
          </div>
          {subjectsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
            </div>
          ) : subjects.length === 0 ? (
            <p className="text-center py-12 text-gray-500 dark:text-gray-400">
              No subjects found. Add one to get started.
            </p>
          ) : (
            <>
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
              <TableFilterSummary
                ctl={subjectTable}
                total={categorySubjects.length}
                shown={subjectTable.rows.length}
                className="mb-0 mr-auto"
            />
              <TableExportButton
                ctl={subjectTable}
                filename="subjects"
                title="Subjects"
                featureKey="subjects"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortFilterHead ctl={subjectTable} col="name" />
                  <SortFilterHead ctl={subjectTable} col="code" />
                  <SortFilterHead ctl={subjectTable} col="nickname" />
                  <SortFilterHead ctl={subjectTable} col="category" />
                  <SortFilterHead ctl={subjectTable} col="type" />
                  <SortFilterHead ctl={subjectTable} col="status" />
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjectTable.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-gray-500 dark:text-gray-400">
                      No subjects match the column filters.
                    </TableCell>
                  </TableRow>
                )}
                {subjectTable.rows
                  .map((subject) => (
                  <TableRow key={subject.id}>
                    <TableCell className="font-medium">
                      {subject.name}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {subject.code || "—"}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {subject.nickname || "—"}
                    </TableCell>
                    <TableCell>
                      {subject.category ? (
                        <Badge variant="secondary" className="bg-gray-100 dark:bg-muted text-gray-700 dark:text-gray-300">
                          {subject.category === "languages" ? "Languages" :
                           subject.category === "academic" ? "Academic" :
                           "Co-curricular"}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
                          Uncategorized
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          subject.is_elective
                            ? "bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400" // color-ok: Elective vs Core is a two-way category, not a status — collapsing purple into blue makes the two chips identical
                            : "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400"
                        }
                      >
                        {subject.is_elective ? "Elective" : "Core"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          subject.is_active
                            ? "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                            : "bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400"
                        }
                      >
                        {subject.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEditDialog(subject)}
                          aria-label="Edit subject"
                          className="text-gray-500 hover:text-navy-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-muted"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleActive(subject)}
                        >
                          {subject.is_active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDeleteSubject(subject)}
                          disabled={deletingSubjectId === subject.id}
                          aria-label="Delete subject"
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
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════ */}
      {/* Assignments Tab (Unified Filterable Table)      */}
      {/* ════════════════════════════════════════════════ */}
      {tab === "assignments" && (
        <div className="space-y-4">
          {assignmentsLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
            </div>
          ) : (
            <>
              {/* ── Manage by class ──
                  The class-first entry point. Assigning subjects one dialog at
                  a time meant eleven saves to set up one class; pick a class
                  here and set its whole list in one pass. */}
              <div className="erp-table-container p-5">
                <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-sm font-semibold text-navy-900 dark:text-white">
                      Manage by class
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Pick a class to tick all of its subjects and set their
                      teachers in one go. Amber means a subject has nobody
                      teaching it.
                    </p>
                  </div>
                </div>

                {classes.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                    No classes in this academic year yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"> {/* mobile-layout-ok: class chips, one short label each */}
                    {classes.map((c) => {
                      const summary = assignmentsByClass.get(c.id);
                      const count = summary?.subject_count ?? 0;
                      const unassigned = summary?.unassigned ?? 0;
                      return (
                        <button
                          key={c.id}
                          onClick={() => openClassSubjects(c.id)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left transition-colors",
                            count === 0
                              ? "border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 hover:bg-gray-50 dark:hover:bg-muted"
                              : "border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted"
                          )}
                        >
                          <div className="text-sm font-medium text-navy-900 dark:text-white">
                            {formatClassName(c)}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {count === 0 ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                No subjects yet
                              </span>
                            ) : (
                              <>
                                {count} subject{count === 1 ? "" : "s"}
                                {unassigned > 0 && (
                                  <span className="text-amber-600 dark:text-amber-400">
                                    {" "}
                                    · {unassigned} without a teacher
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Filters.
                  Open, this panel is the third of four stacked boxes before
                  any data appears — on a phone the table itself started a
                  couple of screens down. It now opens on demand, and stays
                  open on its own whenever a filter is set, so an active
                  filter can never be hidden from the person it is confusing. */}
              <div className="erp-table-container p-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((o) => !o)}
                    aria-expanded={Boolean(filtersOpen || hasActiveFilters)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300"
                  >
                    <Filter className="h-4 w-4 text-gray-400" />
                    Filters
                    {hasActiveFilters && (
                      <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
                        {[filterClassId, filterSubjectId, filterTeacherId].filter(Boolean).length}
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-gray-400 transition-transform",
                        (filtersOpen || hasActiveFilters) && "rotate-180"
                      )}
                    />
                  </button>
                  {hasActiveFilters && (
                    <button
                      onClick={() => {
                        setFilterClassId("");
                        setFilterSubjectId("");
                        setFilterTeacherId("");
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline ml-2"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div
                  className={cn(
                    "mt-3 flex-col gap-3 sm:flex-row",
                    filtersOpen || hasActiveFilters ? "flex" : "hidden"
                  )}
                >
                  <div className="w-full sm:w-52">
                    <Select
                      value={filterClassId || "all"}
                      items={[
                        { value: "all", label: "All Classes" },
                        ...classes.map((c) => ({ value: c.id, label: formatClassName(c) })),
                      ]}
                      onValueChange={(val) =>
                        setFilterClassId(!val || val === "all" ? "" : val)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Classes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" label="All Classes">
                          All Classes
                        </SelectItem>
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
                  <div className="w-full sm:w-52">
                    <Select
                      value={filterSubjectId || "all"}
                      items={[
                        { value: "all", label: "All Subjects" },
                        ...subjectsInAssignments.map((s) => ({ value: s.id, label: s.name })),
                      ]}
                      onValueChange={(val) =>
                        setFilterSubjectId(!val || val === "all" ? "" : val)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Subjects" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" label="All Subjects">
                          All Subjects
                        </SelectItem>
                        {subjectsInAssignments.map((s) => (
                          <SelectItem key={s.id} value={s.id} label={s.name}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-full sm:w-52">
                    <Select
                      value={filterTeacherId || "all"}
                      items={[
                        { value: "all", label: "All Teachers" },
                        { value: "unassigned", label: "Unassigned" },
                        ...teachersInAssignments.map((t) => ({ value: t.id, label: t.name })),
                      ]}
                      onValueChange={(val) =>
                        setFilterTeacherId(!val || val === "all" ? "" : val)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Teachers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" label="All Teachers">
                          All Teachers
                        </SelectItem>
                        <SelectItem value="unassigned" label="Unassigned">
                          Unassigned
                        </SelectItem>
                        {teachersInAssignments.map((t) => (
                          <SelectItem key={t.id} value={t.id} label={t.name}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center ml-auto">
                    <Badge
                      variant="secondary"
                      className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
                    >
                      {filteredAssignments.length} assignment
                      {filteredAssignments.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </div>
              </div>


              {/* Table */}
              <div className="erp-table-container p-4 sm:p-6">
                {filteredAssignments.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                    <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">
                      {assignments.length === 0
                        ? "No subjects assigned to any class yet"
                        : "No assignments match the current filters"}
                    </p>
                    <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                      {assignments.length === 0
                        ? 'Click "Assign Subject" to get started'
                        : "Try adjusting your filters"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <>
                    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                      <TableFilterSummary
                        ctl={assignmentTable}
                        total={filteredAssignments.length}
                        shown={assignmentTable.rows.length}
                        className="mb-0 mr-auto"
            />
                      <TableExportButton
                        ctl={assignmentTable}
                        filename="subject-assignments"
                        title="Subject Assignments"
                        featureKey="subjects"
                      />
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortFilterHead ctl={assignmentTable} col="class" />
                          <SortFilterHead ctl={assignmentTable} col="subject" />
                          <SortFilterHead ctl={assignmentTable} col="code" />
                          <SortFilterHead ctl={assignmentTable} col="teacher" />
                          <SortFilterHead ctl={assignmentTable} col="students" align="center" />
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignmentTable.rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="py-10 text-center text-gray-500 dark:text-gray-400">
                              No rows match the column filters.
                            </TableCell>
                          </TableRow>
                        )}
                        {assignmentTable.rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className="bg-navy-100 dark:bg-navy-900/30 text-navy-800 dark:text-navy-200 font-medium"
                              >
                                {formatClassName({ name: row.class_name, section: row.class_section, stream_name: row.stream_name })}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">
                              {row.subject_name}
                            </TableCell>
                            <TableCell className="text-gray-500 dark:text-gray-400">
                              {row.subject_code ?? "—"}
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => openEditTeacherDialog(row)}
                                className="flex items-center gap-1.5 text-sm hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                              >
                                {row.teacher_name ?? (
                                  <span className="text-gray-400 dark:text-gray-500 italic">
                                    Not assigned
                                  </span>
                                )}
                                <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "text-xs",
                                  row.student_count > 0
                                    ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                                    : "bg-gray-100 dark:bg-muted text-gray-400 dark:text-gray-500"
                                )}
                              >
                                <Users className="h-3 w-3 mr-1" />
                                {row.student_count}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleRemoveAssignment(row)}
                                aria-label="Remove assignment"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════ */}
      {/* Streams Tab                                     */}
      {/* ════════════════════════════════════════════════ */}
      {tab === "streams" && (
        <div className="space-y-4">
          {streamsLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
            </div>
          ) : (
            // Streams and wings are the same table with different meanings
            // (migration 118), so they render as two labelled sections rather
            // than one undifferentiated grid.
            [
              {
                key: "stream" as const,
                title: "Academic streams",
                blurb:
                  "Science, Commerce, Humanities — attached to a class in XI/XII, and read by fee resolution.",
                rows: academicStreams,
                empty: "No streams defined yet.",
              },
              {
                key: "wing" as const,
                title: "Wings",
                blurb:
                  "A band of classes that share a subject set. Apply one and every section in the band gets its subjects.",
                rows: wings,
                empty:
                  "No wings yet. A wing saves setting the same subjects on nine classes by hand.",
              },
            ].map((section) => (
            <div key={section.key} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-navy-900 dark:text-white">
                  {section.title}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {section.blurb}
                </p>
              </div>
              {section.rows.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                  {section.empty}
                </p>
              ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {section.rows.map((stream) => (
                <div
                  key={stream.id}
                  className="erp-table-container p-5 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-navy-900 dark:text-white">
                        {stream.name}
                      </h3>
                      {stream.code && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Code: {stream.code}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge
                        variant="secondary"
                        className={
                          stream.is_active
                            ? "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                            : "bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400"
                        }
                      >
                        {stream.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        Subjects ({stream.subjects.length})
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openManageStreamSubjects(stream)}
                        className="h-7 text-xs gap-1"
                      >
                        <Settings2 className="h-3 w-3" />
                        Manage
                      </Button>
                    </div>
                    {stream.subjects.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                        No subjects assigned
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {stream.subjects.map((s) => (
                          <Badge
                            key={s.id}
                            variant="secondary"
                            className={cn(
                              "text-xs",
                              s.is_mandatory
                                ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400"
                                : "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400" // color-ok: Elective vs Core is a two-way category, not a status — collapsing purple into blue makes the two chips identical
                            )}
                          >
                            {s.name}
                            {!s.is_mandatory && (
                              <span className="ml-1 opacity-60">
                                (elective)
                              </span>
                            )}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-gray-100 dark:border-border text-xs text-gray-500 dark:text-gray-400">
                    {stream.kind === "wing" ? (
                      // A wing is never attached to a class or a fee row, so
                      // those counts would always read zero. Its band is the
                      // useful thing to show. (migration 118)
                      (stream.class_names ?? []).length === 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          No classes selected
                        </span>
                      ) : (
                        <span>
                          Classes {(stream.class_names ?? []).join(", ")}
                        </span>
                      )
                    ) : (
                      <>
                        <span>
                          {streamUsage[stream.id]?.classes ?? 0} class
                          {(streamUsage[stream.id]?.classes ?? 0) === 1 ? "" : "es"}
                        </span>
                        <span>
                          {streamUsage[stream.id]?.fee_structures ?? 0} fee row
                          {(streamUsage[stream.id]?.fee_structures ?? 0) === 1 ? "" : "s"}
                        </span>
                      </>
                    )}
                    <span className="ml-auto">Order {stream.sort_order ?? 0}</span>
                  </div>

                  {stream.kind === "wing" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setApplyWing(stream)}
                      disabled={
                        (stream.class_names ?? []).length === 0 ||
                        stream.subjects.length === 0
                      }
                      className="w-full text-xs"
                    >
                      <Layers className="h-3.5 w-3.5 mr-1.5" />
                      Apply subjects to classes
                    </Button>
                  )}

                  <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-border">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditStreamDialog(stream)}
                      aria-label="Edit stream"
                      className="text-gray-500 hover:text-navy-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-muted"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleStreamActive(stream)}
                      className="text-xs"
                    >
                      {stream.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDeleteStream(stream)}
                      aria-label="Delete stream"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
              )}
            </div>
            ))
          )}

          {/* Info box about streams */}
          <div className="rounded-xl border border-blue-200 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-950/10 p-4">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Streams</strong> (Science, Commerce, Humanities) apply to
              XI &amp; XII. A student enrolled in a higher class and assigned a
              stream receives only that stream&apos;s subjects, and fee
              structures can be priced per stream. Lower classes don&apos;t use
              them.
            </p>
            <p className="mt-2 text-sm text-blue-800 dark:text-blue-300">
              <strong>Wings</strong> are a shortcut, not a stream. A wing names
              a band of classes — Middle Wing is VI, VII and VIII — and holds
              the subjects they all study. Applying it gives every section in
              the band those subjects in one go, instead of setting up nine
              classes by hand. Wings are never attached to a class or a fee
              row, so they never appear in a stream dropdown.
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════ */}
      {/* Teacher Subjects Tab                            */}
      {/* ════════════════════════════════════════════════ */}
      {tab === "teachers" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/20 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
            Which subjects each teacher is qualified to teach. This is what lets
            the Class Assignments tab put the right teachers at the top of the
            list — pick Mathematics for a class and its maths teachers come
            first. Assigning a teacher to a subject anywhere in the ERP adds it
            here automatically; removing the assignment does not take it away.
          </div>

          {/* Filters */}
          <div className="erp-table-container p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <Filter className="h-4 w-4" />
                <span className="text-xs font-medium">Filter</span>
              </div>
              <div className="w-full sm:w-64">
                <Label className="text-xs font-medium">Teaches subject</Label>
                <Select
                  value={teacherFilterSubjectId || "all"}
                  items={[
                    { value: "all", label: "Any subject" },
                    { value: "none", label: "No subjects yet" },
                    ...activeSubjects.map((s) => ({
                      value: s.id,
                      label: s.name,
                    })),
                  ]}
                  onValueChange={(val) =>
                    setTeacherFilterSubjectId(!val || val === "all" ? "" : val)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" label="Any subject">
                      Any subject
                    </SelectItem>
                    <SelectItem value="none" label="No subjects yet">
                      No subjects yet
                    </SelectItem>
                    {activeSubjects.map((s) => (
                      <SelectItem key={s.id} value={s.id} label={s.name}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={showRetiredTeachers}
                  onChange={(e) => setShowRetiredTeachers(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600 text-navy-900 dark:text-white focus:ring-navy-900"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Include retired teachers
                </span>
              </label>
              <div className="flex items-center ml-auto pb-2">
                <Badge
                  variant="secondary"
                  className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
                >
                  {teacherSubjectRows.length} teacher
                  {teacherSubjectRows.length === 1 ? "" : "s"}
                </Badge>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="erp-table-container p-6">
            {teacherSubjectsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : teacherSubjectRows.length === 0 ? (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">
                  {teacherFilterSubjectId
                    ? "No teachers match this filter"
                    : "No teachers yet"}
                </p>
                <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                  {teacherFilterSubjectId
                    ? "Try a different subject, or clear the filter"
                    : "Add teaching staff on People → Staff first"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                  <TableFilterSummary
                    ctl={teacherTable}
                    total={teacherSubjectRows.length}
                    shown={teacherTable.rows.length}
                    className="mb-0 mr-auto"
                  />
                  <TableExportButton
                    ctl={teacherTable}
                    filename="teacher-subjects"
                    title="Teacher Subjects"
                    featureKey="subjects"
                  />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortFilterHead ctl={teacherTable} col="teacher" />
                      <SortFilterHead ctl={teacherTable} col="employee_id" />
                      <SortFilterHead ctl={teacherTable} col="subjects" />
                      <SortFilterHead
                        ctl={teacherTable}
                        col="count"
                        align="center"
                      />
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teacherTable.rows.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-10 text-center text-gray-500 dark:text-gray-400"
                        >
                          No rows match the column filters.
                        </TableCell>
                      </TableRow>
                    )}
                    {teacherTable.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.full_name}
                          {!row.is_active && (
                            <Badge
                              variant="secondary"
                              className="ml-2 text-xs bg-gray-100 dark:bg-muted text-gray-500"
                            >
                              Retired
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                          {row.employee_id}
                        </TableCell>
                        <TableCell>
                          {row.subject_names.length === 0 ? (
                            <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                              None yet
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {row.subject_names.map((n) => (
                                <Badge
                                  key={n}
                                  variant="secondary"
                                  className="text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400"
                                >
                                  {n}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {row.subject_names.length}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openManageTeacherSubjects(row)}
                            className="h-7 text-xs gap-1"
                          >
                            <Settings2 className="h-3 w-3" />
                            Manage
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════ */}
      {/* Dialogs                                         */}
      {/* ════════════════════════════════════════════════ */}

      {/* ── Add Subject Dialog ── */}
      <Dialog open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
                <BookOpen className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <DialogTitle>Add New Subject</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Create a new subject for the curriculum
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreateSubject} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="subjectName" className="text-xs font-medium">
                  Subject Name
                </Label>
                <Input
                  id="subjectName"
                  className="h-9"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. English Core"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="subjectCode" className="text-xs font-medium">
                  Subject Code
                </Label>
                <Input
                  id="subjectCode"
                  className="h-9"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="CBSE numeric (e.g. 301)"
                />
                <p className="text-[10px] text-gray-500">Mandatory for classes 9–12. Used in marksheets and reports.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="subjectNickname" className="text-xs font-medium">
                  Nickname (optional)
                </Label>
                <Input
                  id="subjectNickname"
                  className="h-9"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Eng Core"
                  maxLength={20}
                />
                <p className="text-[10px] text-gray-500">Short label for compact views like the timetable.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="subjectCategory" className="text-xs font-medium">
                  Category <span className="text-red-500">*</span>
                </Label>
                <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                  <SelectTrigger id="subjectCategory" className="h-9">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="languages">Languages</SelectItem>
                    <SelectItem value="academic">Academic Subjects</SelectItem>
                    <SelectItem value="co_curricular">Co-curricular Subjects</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isElective}
                onChange={(e) => setIsElective(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-navy-900 dark:text-white focus:ring-navy-900"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Elective subject
              </span>
            </label>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSubjectDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
              >
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Subject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Subject Dialog ── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Pencil className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <DialogTitle>Edit Subject</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Update subject details
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleEditSubject} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label
                  htmlFor="editSubjectName"
                  className="text-xs font-medium"
                >
                  Subject Name
                </Label>
                <Input
                  id="editSubjectName"
                  className="h-9"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. English Core"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="editSubjectCode"
                  className="text-xs font-medium"
                >
                  Subject Code
                </Label>
                <Input
                  id="editSubjectCode"
                  className="h-9"
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  placeholder="CBSE numeric (e.g. 301)"
                />
                <p className="text-[10px] text-gray-500">Mandatory for classes 9–12.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="editSubjectNickname" className="text-xs font-medium">
                  Nickname (optional)
                </Label>
                <Input
                  id="editSubjectNickname"
                  className="h-9"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  placeholder="e.g. Eng Core"
                  maxLength={20}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="editSubjectCategory" className="text-xs font-medium">
                  Category <span className="text-red-500">*</span>
                </Label>
                <Select value={editCategory} onValueChange={(v) => setEditCategory(v as typeof editCategory)}>
                  <SelectTrigger id="editSubjectCategory" className="h-9">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="languages">Languages</SelectItem>
                    <SelectItem value="academic">Academic Subjects</SelectItem>
                    <SelectItem value="co_curricular">Co-curricular Subjects</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editIsElective}
                onChange={(e) => setEditIsElective(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-navy-900 dark:text-white focus:ring-navy-900"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Elective subject
              </span>
            </label>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
              >
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


      {/* ── Edit Teacher Dialog ── */}
      <Dialog
        open={editTeacherDialogOpen}
        onOpenChange={setEditTeacherDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Pencil className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <DialogTitle>Change Teacher</DialogTitle>
                {editTeacherRow && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {editTeacherRow.subject_name} in{" "}
                    {formatClassName({ name: editTeacherRow.class_name, section: editTeacherRow.class_section, stream_name: editTeacherRow.stream_name })}
                  </p>
                )}
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Teacher</Label>
              <Select
                value={editTeacherValue}
                items={[{ value: "none", label: "None" }, ...editTeacherChoices]}
                onValueChange={(val) => val && setEditTeacherValue(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a teacher..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="None">
                    None
                  </SelectItem>
                  {editTeacherSplit.qualified.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>
                        Teaches {editTeacherRow?.subject_name}
                      </SelectLabel>
                      {editTeacherSplit.qualified.map((t) => (
                        <SelectItem
                          key={t.id}
                          value={t.id}
                          label={teacherLabel(t)}
                        >
                          {teacherLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {editTeacherShowOthers &&
                    editTeacherSplit.others.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>
                          {editTeacherSplit.qualified.length > 0
                            ? "All other teachers"
                            : "All teachers"}
                        </SelectLabel>
                        {editTeacherSplit.others.map((t) => (
                          <SelectItem
                            key={t.id}
                            value={t.id}
                            label={teacherLabel(t)}
                          >
                            {teacherLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  {editTeacherSplit.retained && (
                    <SelectItem
                      value={editTeacherSplit.retained.id}
                      label={`${teacherLabel(editTeacherSplit.retained)} — inactive`}
                    >
                      {teacherLabel(editTeacherSplit.retained)} — inactive
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {editTeacherSplit.qualified.length > 0 &&
                !editTeacherShowOthers && (
                  <button
                    type="button"
                    onClick={() => setEditTeacherShowAll(true)}
                    className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Show all teachers
                  </button>
                )}
              {editTeacherSplit.qualified.length === 0 && (
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Nobody is mapped to {editTeacherRow?.subject_name} yet — all
                  teachers listed. Set this up on the Teacher Subjects tab.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTeacherDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateTeacher}
              disabled={editTeacherSubmitting}
              className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
            >
              {editTeacherSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Update Teacher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Stream Dialog ── */}
      <Dialog open={streamDialogOpen} onOpenChange={setStreamDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <GraduationCap className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <DialogTitle>
                  {streamKind === "wing" ? "Add New Wing" : "Add New Stream"}
                </DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {streamKind === "wing"
                    ? "A band of classes that share a subject set"
                    : "Create an academic stream for higher classes"}
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreateStream} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="streamName" className="text-xs font-medium">
                  Stream Name
                </Label>
                <Input
                  id="streamName"
                  className="h-9"
                  value={streamName}
                  onChange={(e) => setStreamName(e.target.value)}
                  placeholder="e.g. Science"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="streamCode" className="text-xs font-medium">
                  Code (optional)
                </Label>
                <Input
                  id="streamCode"
                  className="h-9"
                  value={streamCode}
                  onChange={(e) => setStreamCode(e.target.value)}
                  placeholder="e.g. SCI"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="streamSortOrder" className="text-xs font-medium">
                  Sort Order
                </Label>
                <Input
                  id="streamSortOrder"
                  type="number"
                  className="h-9"
                  value={streamSortOrder}
                  onChange={(e) => setStreamSortOrder(Number(e.target.value))}
                />
                <p className="text-[11px] text-gray-400">
                  Controls the order streams appear in dropdowns.
                </p>
              </div>
            </div>

            {streamKind === "wing" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Classes in this wing</Label>
                <ClassBandPicker
                  value={streamClassNames}
                  onChange={setStreamClassNames}
                  sectionCounts={sectionCountsByClassName}
                />
                <p className="text-[11px] text-gray-400">
                  Every section of these classes gets the wing&apos;s subjects
                  when you apply it.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStreamDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={streamSubmitting}
                className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
              >
                {streamSubmitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Stream
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Stream Dialog ── */}
      <Dialog
        open={editStreamDialogOpen}
        onOpenChange={setEditStreamDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Pencil className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <DialogTitle>Edit Stream</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Update stream details
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleEditStream} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label
                  htmlFor="editStreamName"
                  className="text-xs font-medium"
                >
                  Stream Name
                </Label>
                <Input
                  id="editStreamName"
                  className="h-9"
                  value={editStreamName}
                  onChange={(e) => setEditStreamName(e.target.value)}
                  placeholder="e.g. Science"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="editStreamCode"
                  className="text-xs font-medium"
                >
                  Code (optional)
                </Label>
                <Input
                  id="editStreamCode"
                  className="h-9"
                  value={editStreamCode}
                  onChange={(e) => setEditStreamCode(e.target.value)}
                  placeholder="e.g. SCI"
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="editStreamSortOrder"
                  className="text-xs font-medium"
                >
                  Sort Order
                </Label>
                <Input
                  id="editStreamSortOrder"
                  type="number"
                  className="h-9"
                  value={editStreamSortOrder}
                  onChange={(e) => setEditStreamSortOrder(Number(e.target.value))}
                />
                <p className="text-[11px] text-gray-400">
                  Controls the order streams appear in dropdowns.
                </p>
              </div>
            </div>

            {editingStream?.kind === "wing" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Classes in this wing</Label>
                <ClassBandPicker
                  value={editStreamClassNames}
                  onChange={setEditStreamClassNames}
                  sectionCounts={sectionCountsByClassName}
                />
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditStreamDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={streamSubmitting}
                className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
              >
                {streamSubmitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Manage Teacher Subjects Dialog ── */}
      <Dialog
        open={manageTeacherSubjectsOpen}
        onOpenChange={setManageTeacherSubjectsOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <DialogTitle>
                  Subjects — {managingTeacher?.full_name}
                </DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  What this teacher is qualified to teach
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-80 overflow-y-auto space-y-1 py-2">
            {activeSubjects.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                No active subjects found. Create subjects first.
              </p>
            ) : (
              activeSubjects.map((subject) => {
                const isSelected = selectedTeacherSubjects.has(subject.id);

                return (
                  <div
                    key={subject.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 rounded-lg transition-colors",
                      isSelected
                        ? "bg-blue-50 dark:bg-blue-950/20"
                        : "hover:bg-gray-50 dark:hover:bg-muted"
                    )}
                  >
                    <label className="flex items-center gap-3 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTeacherSubject(subject.id)}
                        className="rounded border-gray-300 dark:border-gray-600 text-navy-900 dark:text-white focus:ring-navy-900"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {subject.name}
                        </span>
                        {subject.code && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-1.5">
                            ({subject.code})
                          </span>
                        )}
                      </div>
                    </label>
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setManageTeacherSubjectsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveTeacherSubjects}
              disabled={teacherSubjectsSubmitting}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {teacherSubjectsSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              <Check className="h-4 w-4 mr-1" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Manage Stream Subjects Dialog ── */}
      <Dialog
        open={manageStreamSubjectsOpen}
        onOpenChange={setManageStreamSubjectsOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                <Settings2 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <DialogTitle>
                  Manage Subjects — {managingStream?.name}
                </DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Select which subjects belong to this stream
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-80 overflow-y-auto space-y-1 py-2">
            {activeSubjects.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                No active subjects found. Create subjects first.
              </p>
            ) : (
              activeSubjects.map((subject) => {
                const entry = selectedStreamSubjects.get(subject.id);
                const isSelected = !!entry;

                return (
                  <div
                    key={subject.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 rounded-lg transition-colors",
                      isSelected
                        ? "bg-blue-50 dark:bg-blue-950/20"
                        : "hover:bg-gray-50 dark:hover:bg-muted"
                    )}
                  >
                    <label className="flex items-center gap-3 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleStreamSubject(subject.id)}
                        className="rounded border-gray-300 dark:border-gray-600 text-navy-900 dark:text-white focus:ring-navy-900"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {subject.name}
                        </span>
                        {subject.code && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-1.5">
                            ({subject.code})
                          </span>
                        )}
                      </div>
                    </label>
                    {isSelected && (
                      <button
                        type="button"
                        onClick={() =>
                          toggleStreamSubjectMandatory(subject.id)
                        }
                        title="Click to toggle Compulsory / Elective for this stream"
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-full border transition-colors",
                          entry?.is_mandatory
                            ? "border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/30"
                            : "border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/30" // color-ok: Elective vs Core is a two-way category, not a status — collapsing purple into blue makes the two chips identical
                        )}
                      >
                        {entry?.is_mandatory ? "Compulsory" : "Elective"}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setManageStreamSubjectsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveStreamSubjects}
              disabled={streamSubjectsSubmitting}
              className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
            >
              {streamSubjectsSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              <Check className="h-4 w-4 mr-1" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Quick Setup Wizard ── */}
      {showQuickSetupWizard && (
      <QuickSetupWizard
        open={quickSetupOpen}
        onOpenChange={setQuickSetupOpen}
        existingSubjects={subjects}
        existingClasses={classes}
        existingAssignments={assignments}
        onSuccess={() => {
          fetchSubjects();
          fetchAssignmentsData();
        }}
      />
      )}

      {/* ── Bulk Upload Assignments ── */}
      {manageClassId && (
        <ClassSubjectsDialog
          open={classSubjectsOpen}
          onOpenChange={setClassSubjectsOpen}
          classId={manageClassId}
          classLabel={manageClassLabel}
          subjects={activeSubjects}
          teachers={teachers}
          teacherSubjectMap={teacherSubjectMap}
          assignments={manageClassAssignments}
          onSaved={() => {
            fetchAssignmentsData();
            fetchTeacherSubjects();
          }}
        />
      )}

      {applyWing && (
        <WingApplyDialog
          open={applyWing !== null}
          onOpenChange={(open) => !open && setApplyWing(null)}
          wingId={applyWing.id}
          wingName={applyWing.name}
          academicYearId={sessionId ?? undefined}
          onApplied={() => {
            fetchAssignmentsData();
            fetchStreams();
          }}
        />
      )}

      {showSubjectBulkUpload && (
      <SubjectBulkUpload
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        onSuccess={() => {
          fetchAssignmentsData();
          fetchSubjects();
        }}
      />
      )}
    </div>
  );
}
