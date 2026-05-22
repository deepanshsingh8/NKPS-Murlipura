"use client";

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
  BookOpen,
  Library,
  GraduationCap,
  Settings2,
  Check,
  Users,
  Filter,
  Sparkles,
  Upload,
} from "lucide-react";
import { adminApi } from "@nkps/shared/lib/admin-api";
import { cn, formatClassName } from "@nkps/shared/lib/utils";
import QuickSetupWizard from "@/components/QuickSetupWizard";
import { SubjectBulkUpload } from "@/components/SubjectBulkUpload";
import type { Class, Subject, Teacher, Stream } from "@nkps/shared/types";

type Tab = "subjects" | "assignments" | "streams";

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
  const [tab, setTab] = useState<Tab>("subjects");

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
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [newClassId, setNewClassId] = useState("");
  const [newSubjectId, setNewSubjectId] = useState("");
  const [newTeacherId, setNewTeacherId] = useState("");
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
  const [streamsLoading, setStreamsLoading] = useState(true);
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [streamSubmitting, setStreamSubmitting] = useState(false);
  const [streamName, setStreamName] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [editingStream, setEditingStream] = useState<StreamWithSubjects | null>(null);
  const [editStreamDialogOpen, setEditStreamDialogOpen] = useState(false);
  const [editStreamName, setEditStreamName] = useState("");
  const [editStreamCode, setEditStreamCode] = useState("");
  // Manage stream subjects dialog
  const [manageStreamSubjectsOpen, setManageStreamSubjectsOpen] = useState(false);
  const [managingStream, setManagingStream] = useState<StreamWithSubjects | null>(null);
  const [selectedStreamSubjects, setSelectedStreamSubjects] = useState<
    Map<string, { checked: boolean; is_mandatory: boolean }>
  >(new Map());
  const [streamSubjectsSubmitting, setStreamSubjectsSubmitting] = useState(false);

  // ── Quick Setup & Bulk Upload state ──
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  // §6 Math Standard/Advanced review banner
  const [mathReviewCount, setMathReviewCount] = useState(0);

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
      return;
    }

    setSubjects((data as Subject[]) ?? []);
    setSubjectsLoading(false);
  }, [supabase]);

  // §6: Look for any plain "Mathematics" subject still linked to classes IX–XII.
  // We never auto-reassign; admin must split into Standard/Advanced manually.
  const fetchMathReviewState = useCallback(async () => {
    const { data: plainMath } = await supabase
      .from("subjects")
      .select("id")
      .ilike("name", "Mathematics")
      .limit(1)
      .maybeSingle();
    if (!plainMath?.id) {
      setMathReviewCount(0);
      return;
    }
    const { data: linked } = await supabase
      .from("class_subjects")
      .select("id, classes!inner(name)")
      .eq("subject_id", plainMath.id);
    const seniorLinked = (linked ?? []).filter((row) => {
      const classes = (row as unknown as { classes: { name: string } | { name: string }[] | null }).classes;
      const className = Array.isArray(classes) ? classes[0]?.name ?? "" : classes?.name ?? "";
      return ["IX", "X", "XI", "XII"].includes(className);
    });
    setMathReviewCount(seniorLinked.length);
  }, [supabase]);

  const fetchAssignmentsData = useCallback(async () => {
    const { data: currentYear } = await supabase
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .single();

    const yearId = currentYear?.id ?? "00000000-0000-0000-0000-000000000000";

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
      supabase
        .from("teachers")
        .select("*")
        .eq("is_active", true)
        .order("full_name"),
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
  }, [supabase]);

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

    // Fetch stream_subjects with subject details
    const { data: ssData } = await supabase
      .from("stream_subjects")
      .select("id, stream_id, subject_id, is_mandatory, subjects(name, code)");

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

    setStreams(enrichedStreams);
    setStreamsLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchSubjects();
    fetchAssignmentsData();
    fetchStreams();
    fetchMathReviewState();
  }, [fetchSubjects, fetchAssignmentsData, fetchStreams, fetchMathReviewState]);

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
      toast.error("Failed to update subject");
      return;
    }

    toast.success(
      subject.is_active ? "Subject deactivated" : "Subject activated"
    );
    await fetchSubjects();
    await fetchAssignmentsData();
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm("Delete this subject? This will also remove all class assignments for this subject.")) return;

    const result = await adminApi({
      action: "delete",
      table: "subjects",
      match: { column: "id", value: id },
    });

    if (!result.success) {
      toast.error("Failed to delete subject");
      return;
    }

    toast.success("Subject deleted");
    await fetchSubjects();
    await fetchAssignmentsData();
  };

  // ══════════════════════════════════════════════
  // Assignment Handlers
  // ══════════════════════════════════════════════

  const handleAssign = async () => {
    if (!newClassId || !newSubjectId) {
      toast.error("Please select a class and subject");
      return;
    }

    // Check for duplicate
    const existing = assignments.find(
      (a) => a.class_id === newClassId && a.subject_id === newSubjectId
    );
    if (existing) {
      toast.error("This subject is already assigned to this class");
      return;
    }

    setAssignSubmitting(true);
    const result = await adminApi({
      action: "insert",
      table: "class_subjects",
      data: {
        class_id: newClassId,
        subject_id: newSubjectId,
        teacher_id: newTeacherId || null,
      },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to assign subject");
    } else {
      toast.success("Subject assigned to class");
      setAssignDialogOpen(false);
      setNewClassId("");
      setNewSubjectId("");
      setNewTeacherId("");
      await fetchAssignmentsData();
    }
    setAssignSubmitting(false);
  };

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
      toast.error("Failed to remove");
      return;
    }

    toast.success("Subject removed from class");
    await fetchAssignmentsData();
  };

  const openEditTeacherDialog = (row: AssignmentRow) => {
    setEditTeacherRow(row);
    setEditTeacherValue(row.teacher_id || "none");
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

  const handleCreateStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!streamName.trim()) {
      toast.error("Stream name is required");
      return;
    }
    setStreamSubmitting(true);

    const result = await adminApi({
      action: "insert",
      table: "streams",
      data: {
        name: streamName.trim(),
        code: streamCode.trim() || null,
        is_active: true,
        sort_order: streams.length + 1,
      },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to create stream");
    } else {
      toast.success("Stream created");
      setStreamDialogOpen(false);
      setStreamName("");
      setStreamCode("");
      await fetchStreams();
    }
    setStreamSubmitting(false);
  };

  const openEditStreamDialog = (stream: StreamWithSubjects) => {
    setEditingStream(stream);
    setEditStreamName(stream.name);
    setEditStreamCode(stream.code || "");
    setEditStreamDialogOpen(true);
  };

  const handleEditStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStream) return;
    if (!editStreamName.trim()) {
      toast.error("Stream name is required");
      return;
    }
    setStreamSubmitting(true);

    const result = await adminApi({
      action: "update",
      table: "streams",
      data: {
        name: editStreamName.trim(),
        code: editStreamCode.trim() || null,
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
    if (
      !confirm(
        `Delete stream "${stream.name}"? Students with this stream will have their stream unset.`
      )
    )
      return;

    const result = await adminApi({
      action: "delete",
      table: "streams",
      match: { column: "id", value: stream.id },
    });

    if (!result.success) {
      toast.error("Failed to delete stream");
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
      toast.error("Failed to update stream");
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

  // Active subjects for assignment (exclude already-assigned to the selected class)
  const availableSubjectsForAssign = useMemo(() => {
    if (!newClassId) return activeSubjects;
    return activeSubjects.filter(
      (s) =>
        !assignments.some(
          (a) => a.class_id === newClassId && a.subject_id === s.id
        )
    );
  }, [activeSubjects, assignments, newClassId]);

  // ══════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-navy-900 flex items-center justify-center">
            <BookOpen className="h-4.5 w-4.5 text-gold-400" />
          </div>
          <div>
            <h1 className="erp-page-title">Subjects & Assignments</h1>
            <p className="erp-page-subtitle">
              Manage subjects, class assignments, and academic streams
            </p>
          </div>
        </div>
        {tab === "subjects" && (
          <div className="flex items-center gap-2">
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
              className="bg-navy-900 hover:bg-navy-800 text-white"
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
            <Button
              onClick={() => {
                setNewClassId("");
                setNewSubjectId("");
                setNewTeacherId("");
                setAssignDialogOpen(true);
              }}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Assign Subject
            </Button>
          </div>
        )}
        {tab === "streams" && (
          <Button
            onClick={() => {
              setStreamName("");
              setStreamCode("");
              setStreamDialogOpen(true);
            }}
            className="bg-navy-900 hover:bg-navy-800 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Stream
          </Button>
        )}
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-muted rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab("subjects")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
            tab === "subjects"
              ? "bg-white dark:bg-card text-navy-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
          )}
        >
          <BookOpen className="h-4 w-4" />
          Subjects
        </button>
        <button
          onClick={() => setTab("assignments")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
            tab === "assignments"
              ? "bg-white dark:bg-card text-navy-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
          )}
        >
          <Library className="h-4 w-4" />
          Class Assignments
        </button>
        <button
          onClick={() => setTab("streams")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
            tab === "streams"
              ? "bg-white dark:bg-card text-navy-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
          )}
        >
          <GraduationCap className="h-4 w-4" />
          Streams
        </button>
      </div>

      {/* ════════════════════════════════════════════════ */}
      {/* Subjects Tab                                    */}
      {/* ════════════════════════════════════════════════ */}
      {tab === "subjects" && (
        <div className="erp-table-container p-6">
          {/* §6 Math review banner */}
          {mathReviewCount > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Action needed:</strong> {mathReviewCount} class–subject link
              {mathReviewCount === 1 ? " is" : "s are"} still using the legacy{" "}
              <span className="font-mono">Mathematics</span> subject for class IX–XII.
              The CBSE structure now requires <em>Mathematics — Standard</em> or{" "}
              <em>Mathematics — Advanced</em>. Please review and reassign in the
              Assignments tab — these are not migrated automatically.
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Nickname</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjects
                  .filter((s) => {
                    if (categoryFilter === "all") return true;
                    if (categoryFilter === "uncategorized") return !s.category;
                    return s.category === categoryFilter;
                  })
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
                        <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                          Uncategorized
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          subject.is_elective
                            ? "bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400"
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
                          onClick={() => handleDeleteSubject(subject.id)}
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
              {/* Filters */}
              <div className="erp-table-container p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Filter className="h-4 w-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    Filters
                  </span>
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
                <div className="flex flex-col sm:flex-row gap-3">
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
              <div className="erp-table-container p-6">
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
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Class</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>Teacher</TableHead>
                          <TableHead className="text-center">
                            Students
                          </TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAssignments.map((row) => (
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
          ) : streams.length === 0 ? (
            <div className="erp-table-container p-6">
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <GraduationCap className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No streams defined yet</p>
                <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                  Streams are used for higher classes (XI/XII) to group subjects
                  by academic track
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {streams.map((stream) => (
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
                                : "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400"
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

          {/* Info box about streams */}
          <div className="rounded-xl border border-blue-200 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-950/10 p-4">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>How streams work:</strong> Streams (Science, Commerce,
              Humanities) apply to higher classes (XI & XII). When a student
              is enrolled in a higher class and assigned a stream, they
              automatically receive only the subjects mapped to that stream.
              Lower classes (I-X) don&apos;t use streams — students get all
              subjects assigned to their class.
            </p>
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
                <BookOpen className="h-5 w-5 text-indigo-600" />
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
            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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
                className="rounded border-gray-300 dark:border-gray-600 text-navy-900 focus:ring-navy-900"
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
                className="bg-navy-900 hover:bg-navy-800 text-white"
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
                <Pencil className="h-5 w-5 text-blue-600" />
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
            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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
                className="rounded border-gray-300 dark:border-gray-600 text-navy-900 focus:ring-navy-900"
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
                className="bg-navy-900 hover:bg-navy-800 text-white"
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

      {/* ── Assign Subject to Class Dialog ── */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10">
                <Library className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <DialogTitle>Assign Subject to Class</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Link a subject and teacher to a class
                </p>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Class</Label>
              <Select
                value={newClassId}
                items={classes.map((c) => ({ value: c.id, label: formatClassName(c) }))}
                onValueChange={(val) => {
                  if (val) {
                    setNewClassId(val);
                    setNewSubjectId("");
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a class..." />
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
              <Label className="text-xs font-medium">Subject</Label>
              <Select
                value={newSubjectId}
                items={availableSubjectsForAssign.map((s) => ({ value: s.id, label: s.name + (s.code ? ` (${s.code})` : "") }))}
                onValueChange={(val) => val && setNewSubjectId(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a subject..." />
                </SelectTrigger>
                <SelectContent>
                  {availableSubjectsForAssign.map((s) => (
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
              {newClassId && availableSubjectsForAssign.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  All active subjects are already assigned to this class
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Teacher (optional)</Label>
              <Select
                value={newTeacherId || "none"}
                items={[
                  { value: "none", label: "None" },
                  ...teachers.map((t) => ({ value: t.id, label: `${t.full_name} (${t.employee_id})` })),
                ]}
                onValueChange={(val) =>
                  setNewTeacherId(!val || val === "none" ? "" : val)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a teacher..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="None">
                    None
                  </SelectItem>
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id} label={`${t.full_name} (${t.employee_id})`}>
                      {t.full_name} ({t.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={assignSubmitting || !newClassId || !newSubjectId}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {assignSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Assign
            </Button>
          </DialogFooter>
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
                <Pencil className="h-5 w-5 text-blue-600" />
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
                items={[
                  { value: "none", label: "None" },
                  ...teachers.map((t) => ({ value: t.id, label: `${t.full_name} (${t.employee_id})` })),
                ]}
                onValueChange={(val) => val && setEditTeacherValue(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a teacher..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="None">
                    None
                  </SelectItem>
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id} label={`${t.full_name} (${t.employee_id})`}>
                      {t.full_name} ({t.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              className="bg-navy-900 hover:bg-navy-800 text-white"
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
                <GraduationCap className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <DialogTitle>Add New Stream</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Create an academic stream for higher classes
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreateStream} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
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
            </div>

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
                className="bg-navy-900 hover:bg-navy-800 text-white"
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
                <Pencil className="h-5 w-5 text-blue-600" />
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
            <div className="grid grid-cols-2 gap-3">
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
            </div>

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
                className="bg-navy-900 hover:bg-navy-800 text-white"
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

      {/* ── Manage Stream Subjects Dialog ── */}
      <Dialog
        open={manageStreamSubjectsOpen}
        onOpenChange={setManageStreamSubjectsOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                <Settings2 className="h-5 w-5 text-purple-600" />
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
                        className="rounded border-gray-300 dark:border-gray-600 text-navy-900 focus:ring-navy-900"
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
                            : "border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/30"
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
              className="bg-navy-900 hover:bg-navy-800 text-white"
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

      {/* ── Bulk Upload Assignments ── */}
      <SubjectBulkUpload
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        onSuccess={() => {
          fetchAssignmentsData();
          fetchSubjects();
        }}
      />
    </div>
  );
}
